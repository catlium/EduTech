// Material Intelligence (Phase A) — server-side enhancement jobs.
//
// Coordinator-owned like OCR (MATERIAL_PROCESS): MATERIAL_ENHANCE jobs are
// inserted by enqueue sites (OCR finalize, correction reapply, TEXT create/
// update, manual re-enhance) and adopted by a sweep — never published to
// RabbitMQ. The enhancement itself is deterministic text processing, so it
// belongs in the API, not a worker.

import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import {
  chapters,
  jobs,
  materialEnhancementSegmentMappings,
  materialEnhancementSegments,
  materialEnhancements,
  materials,
  ocrChunks,
  ocrPageCorrections,
  subjects,
  syllabi,
  topics,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';
import type {
  MaterialEnhancementPayload,
  MaterialResolvedSegment,
  MaterialSegmentMapping,
} from '@catlium/contracts';
import { pagesWithText } from '../ocr/ocr-coordinator.util.js';
import type { ChunkLike, CorrectionLike } from '../ocr/ocr-coordinator.util.js';
import { enhanceMaterial, sourceFingerprint } from './enhancer.js';
import type { EnhancePage, SyllabusTarget } from './enhancer.js';

const SWEEP_INTERVAL_MS = Number(process.env['WORKER_SWEEP_INTERVAL_MS'] ?? '15000') || 15000;
// A processing enhancement job older than this is considered orphaned (the API
// died mid-sweep). processJob is seconds-fast and idempotent, so reclaiming it
// is safe — without this, a ghost `processing` row would block every future
// enqueue for the material (the dedup guard treats processing as active).
const ENHANCE_LEASE_MS = 60_000;

export type EnhancementTrigger = 'OCR_COMPLETE' | 'CORRECTION' | 'TEXT_SOURCE' | 'MANUAL';

type M = typeof materialEnhancementSegmentMappings.$inferSelect;

const ZERO_SEGMENTS = { total: 0, relevant: 0, uncertain: 0, irrelevant: 0, unmapped: 0 };

function payloadOf(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

function materialIdOf(payload: unknown): string | undefined {
  return payloadOf(payload)?.['materialId'] as string | undefined;
}

@Injectable()
export class MaterialEnhancementService implements OnApplicationBootstrap, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobsService: JobsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── Enqueue (system triggers + manual) ─────────────────────────────────

  /** Guard + queue a MATERIAL_ENHANCE job. Idempotent: an already-active job
   *  for the material is reused instead of stacking duplicates (the sweep's
   *  fingerprint check makes this safe). Returns the job. */
  async requestEnhancement(
    instituteId: string,
    materialId: string,
    trigger: EnhancementTrigger,
    userId?: string,
  ): Promise<Job> {
    const [material] = await this.db
      .select({ processingStatus: materials.processingStatus })
      .from(materials)
      .where(
        and(
          eq(materials.id, materialId),
          eq(materials.instituteId, instituteId),
          isNull(materials.deletedAt),
        ),
      )
      .limit(1);
    if (!material) {
      throw new NotFoundException('Material not found');
    }
    if (material.processingStatus !== 'READY') {
      throw new BadRequestException(
        `Material cannot be enhanced while ${material.processingStatus}`,
      );
    }

    const [existing] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, 'MATERIAL_ENHANCE'),
          eq(jobs.instituteId, instituteId),
          sql`${jobs.status} IN ('queued', 'processing')`,
          sql`${jobs.payload}->>'materialId' = ${materialId}`,
        ),
      )
      .limit(1);
    if (existing) {
      return this.jobsService.getJob(existing.id, instituteId);
    }

    return this.jobsService.insertJob(instituteId, 'MATERIAL_ENHANCE', {
      materialId,
      trigger,
      ...(userId ? { userId } : {}),
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  async getLatest(instituteId: string, materialId: string) {
    const material = await this.assertMaterialScoped(instituteId, materialId);
    const latest = await this.latestOf(materialId);
    return {
      material: {
        id: material.id,
        title: material.title,
        revision: material.revision,
        subjectId: material.subjectId,
      },
      enhancement: latest ? await this.toResponse(latest) : null,
    };
  }

  async listVersions(instituteId: string, materialId: string) {
    await this.assertMaterialScoped(instituteId, materialId);
    const rows = await this.db
      .select()
      .from(materialEnhancements)
      .where(eq(materialEnhancements.materialId, materialId))
      .orderBy(desc(materialEnhancements.version));

    const ids = rows.map((r) => r.id);
    const segmentCounts = new Map<string, typeof ZERO_SEGMENTS>();
    if (ids.length) {
      const segmentsOf = await this.db
        .select({
          enhancementId: materialEnhancementSegments.enhancementId,
          level: materialEnhancementSegments.level,
        })
        .from(materialEnhancementSegments)
        .where(inArray(materialEnhancementSegments.enhancementId, ids));
      for (const s of segmentsOf) {
        const counts = segmentCounts.get(s.enhancementId) ?? { ...ZERO_SEGMENTS };
        counts.total += 1;
        const level =
          s.level === 'relevant' || s.level === 'uncertain' || s.level === 'irrelevant'
            ? s.level
            : 'unmapped';
        counts[level] += 1;
        segmentCounts.set(s.enhancementId, counts);
      }
    }

    return rows.map((r) => ({
      version: r.version,
      trigger: r.trigger,
      sourceRevision: r.sourceRevision,
      findings: (r.payload as MaterialEnhancementPayload).summary.findings,
      segments: segmentCounts.get(r.id) ?? { ...ZERO_SEGMENTS },
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** The downstream "give me the segments relevant to Subject → Chapter →
   *  Topic" read. Defaults to the latest enhancement; filters on personality
   *  (mapping) and/or relevance level. Unit mappings filter by syllabusId
   *  (+ optional unitTitle). */
  async listSegments(
    instituteId: string,
    materialId: string,
    filter: {
      version?: number;
      entityType?: string;
      entityId?: string;
      unitTitle?: string;
      level?: string;
    } = {},
  ) {
    await this.assertMaterialScoped(instituteId, materialId);
    const latest = await this.latestOf(materialId, filter.version);
    if (!latest) {
      return { materialId, version: filter.version ?? 0, segments: [] };
    }
    const resolved = await this.segmentsOf(latest.id);

    const byEntity = (m: MaterialSegmentMapping): boolean => {
      switch (filter.entityType) {
        case 'subject':
          return filter.entityId === (m.subjectId ?? undefined);
        case 'chapter':
          return filter.entityId === (m.chapterId ?? undefined);
        case 'topic':
          return filter.entityId === (m.topicId ?? undefined);
        case 'unit':
          return (
            filter.entityId === (m.syllabusId ?? undefined) &&
            (filter.unitTitle == null || filter.unitTitle === m.unitTitle)
          );
        default:
          return true;
      }
    };

    const segments = resolved.filter(({ segment, mappings }) => {
      if (filter.entityType && !mappings.some(byEntity)) return false;
      if (filter.level && segment.level !== filter.level) return false;
      return true;
    });

    return { materialId, version: latest.version, segments };
  }

  // ── Sweep (adopt queued MATERIAL_ENHANCE jobs) ─────────────────────────

  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - ENHANCE_LEASE_MS);
    const adoptable = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, 'MATERIAL_ENHANCE'),
          or(
            eq(jobs.status, 'queued'),
            // `ponytail: fixed 60s lease; per-job leases only if multi-replica
            // sweeps ever run concurrently.` Re-processing is safe because the
            // fingerprint check is idempotent.
            and(eq(jobs.status, 'processing'), lt(jobs.startedAt, cutoff)),
          ),
        ),
      );
    for (const job of adoptable) {
      try {
        await this.processJob(job.id, job.instituteId, job.payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Enhancement failed';
        await this.jobsService.updateJobStatus(job.id, 'failed', undefined, { message });
      }
    }
  }

  private async processJob(
    jobId: string,
    instituteId: string,
    payload: unknown,
  ): Promise<void> {
    const materialId = materialIdOf(payload);
    if (!materialId) {
      await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
        message: 'MATERIAL_ENHANCE job is missing the materialId payload',
      });
      return;
    }

    await this.jobsService.updateJobStatus(jobId, 'processing');

    const [material] = await this.db
      .select()
      .from(materials)
      .where(
        and(eq(materials.id, materialId), eq(materials.instituteId, instituteId), isNull(materials.deletedAt)),
      )
      .limit(1);
    if (!material || material.processingStatus !== 'READY') {
      await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
        message: material ? `Material cannot be enhanced while ${material.processingStatus}` : 'Material not found',
      });
      return;
    }

    const pages = await this.sourcePages(instituteId, materialId, material.sourceType, material.textContent);
    const fingerprint = sourceFingerprint(pages);

    const [latest] = await this.db
      .select()
      .from(materialEnhancements)
      .where(eq(materialEnhancements.materialId, materialId))
      .orderBy(desc(materialEnhancements.version))
      .limit(1);

    // Idempotency: same raw (fingerprint) + same material revision → no-op.
    if (
      latest &&
      latest.sourceRevision === material.revision &&
      latest.sourceTextHash === fingerprint
    ) {
      await this.jobsService.updateJobStatus(jobId, 'completed', {
        status: 'unchanged',
        version: latest.version,
      });
      return;
    }

    const targets = await this.syllabusTargets(instituteId, material.subjectId);
    const { payload: enhanced, segments, mappings } = enhanceMaterial(pages, targets);

    const version = (latest?.version ?? 0) + 1;
    const trigger = (payloadOf(payload)?.['trigger'] as string | undefined) ?? 'MANUAL';
    const createdBy =
      typeof payloadOf(payload)?.['userId'] === 'string'
        ? (payloadOf(payload)?.['userId'] as string)
        : null;

    await this.db.transaction(async (tx) => {
      const [enhancement] = await tx
        .insert(materialEnhancements)
        .values({
          materialId,
          version,
          trigger,
          sourceRevision: material.revision,
          sourceTextHash: fingerprint,
          payload: enhanced as unknown as Record<string, unknown>,
          createdBy,
        })
        .returning();

      // Logical segments + normalized syllabus associations land in the SAME
      // transaction as the version row — the derivation is atomic.
      const segmentIds: string[] = [];
      for (const [i, s] of segments.entries()) {
        const [row] = await tx
          .insert(materialEnhancementSegments)
          .values({
            enhancementId: enhancement!.id,
            segmentNo: i + 1,
            kind: s.kind,
            level: s.level,
            title: s.title,
            preview: s.preview.slice(0, 500),
            startPage: s.startPage,
            endPage: s.endPage,
            blockIds: s.blockIds,
          })
          .returning();
        segmentIds.push(row!.id);
      }
      if (mappings.length) {
        await tx.insert(materialEnhancementSegmentMappings).values(
          mappings.map((m) => ({
            segmentId: segmentIds[m.segmentIndex]!,
            type: m.type,
            level: m.level,
            confidence: String(m.confidence),
            reason: m.reason.slice(0, 255),
            syllabusId: m.syllabusId,
            subjectId: m.subjectId,
            chapterId: m.chapterId,
            chapterName: m.chapterName,
            topicId: m.topicId,
            topicName: m.topicName,
            unitTitle: m.unitTitle,
          })),
        );
      }
    });

    await this.jobsService.updateJobStatus(jobId, 'completed', {
      status: 'enhanced',
      version,
    });
  }

  /** Enhancement input per page. TEXT materials are a single synthetic page
   *  (source null); OCR materials carry per-page provenance + corrections. */
  private async sourcePages(
    instituteId: string,
    materialId: string,
    sourceType: string,
    textContent: string | null,
  ): Promise<EnhancePage[]> {
    if (sourceType !== 'UPLOAD') {
      return [{ page: 1, source: null, text: textContent ?? '' }];
    }
    const chunks = await this.ocrChunksOf(instituteId, materialId);
    if (!chunks.length) {
      throw new Error('No OCR chunks found — cannot enhance');
    }
    const corrections = await this.correctionsFor(materialId);
    const pageCount = this.documentPagesOf(chunks);
    if (pageCount === null) {
      throw new Error('OCR document pages unknown — cannot enhance');
    }
    return pagesWithText(chunks, corrections, pageCount);
  }

  private async ocrChunksOf(instituteId: string, materialId: string): Promise<ChunkLike[]> {
    const job = await this.jobsService.latestMaterialJob(instituteId, materialId);
    if (!job) return [];
    const rows = await this.db
      .select()
      .from(ocrChunks)
      .where(eq(ocrChunks.jobId, job.id))
      .orderBy(ocrChunks.chunkIndex);
    return rows.map((c) => ({
      chunkIndex: c.chunkIndex,
      startPage: c.startPage,
      endPage: c.endPage,
      status: c.status,
      result: (c.result as Record<string, unknown> | null) ?? null,
    }));
  }

  private async correctionsFor(materialId: string): Promise<Map<number, CorrectionLike>> {
    const rows = await this.db
      .select()
      .from(ocrPageCorrections)
      .where(and(eq(ocrPageCorrections.sourceType, 'MATERIAL'), eq(ocrPageCorrections.sourceId, materialId)));
    return new Map(
      rows.map((r) => [
        r.page,
        {
          correctedText: r.correctedText,
          correctedBy: r.correctedBy,
          correctedAt: r.correctedAt.toISOString(),
        },
      ]),
    );
  }

  private documentPagesOf(chunks: ChunkLike[]): number | null {
    let documentPages: number | null = null;
    for (const c of chunks) {
      const result = c.result ?? {};
      const reported =
        typeof result['totalPages'] === 'number' ? (result['totalPages'] as number) : null;
      if (reported && (!documentPages || reported > documentPages)) documentPages = reported;
    }
    return documentPages;
  }

  /** The syllabus context to judge segment relevance against. Prefers the
   *  subject's confirmed Chapters/Topics (authoritative); falls back to the
   *  latest syllabus Context-units; empty when the subject is missing. Nothing
   *  is invented — a segment only maps where keyword overlap exists. */
  async syllabusTargets(
    instituteId: string,
    subjectId: string | null,
  ): Promise<SyllabusTarget[]> {
    if (!subjectId) return [];
    const [subject] = await this.db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), isNull(subjects.deletedAt)))
      .limit(1);
    if (!subject) return [];

    const [syllabus] = await this.db
      .select({ id: syllabi.id, context: syllabi.context })
      .from(syllabi)
      .where(
        and(
          eq(syllabi.instituteId, instituteId),
          eq(syllabi.subjectId, subjectId),
          isNull(syllabi.deletedAt),
        ),
      )
      .orderBy(desc(sql`CASE WHEN ${syllabi.status} = 'CONFIRMED' THEN 1 ELSE 0 END`), desc(syllabi.version))
      .limit(1);

    const base = {
      syllabusId: syllabus?.id ?? null,
      subjectId: subject.id,
      chapterId: null as string | null,
      chapterName: null as string | null,
      topicId: null as string | null,
      topicName: null as string | null,
      unitTitle: null as string | null,
    };

    const targets: SyllabusTarget[] = [];
    const chapterRows = await this.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.subjectId, subjectId),
          eq(chapters.status, 'active'),
          isNull(chapters.deletedAt),
        ),
      )
      .orderBy(asc(chapters.sortOrder));

    if (chapterRows.length > 0) {
      targets.push({ ...base, type: 'subject', title: subject.name });
      for (const c of chapterRows) {
        targets.push({
          ...base,
          type: 'chapter',
          title: c.name,
          chapterId: c.id,
          chapterName: c.name,
        });
      }
      const chapterNameById = new Map(chapterRows.map((c) => [c.id, c.name]));
      const topicRows = await this.db
        .select()
        .from(topics)
        .where(
          and(
            inArray(
              topics.chapterId,
              chapterRows.map((c) => c.id),
            ),
            eq(topics.status, 'active'),
            isNull(topics.deletedAt),
          ),
        )
        .orderBy(asc(topics.sortOrder));
      for (const t of topicRows) {
        targets.push({
          ...base,
          type: 'topic',
          title: t.name,
          chapterId: t.chapterId,
          chapterName: chapterNameById.get(t.chapterId) ?? null,
          topicId: t.id,
          topicName: t.name,
        });
      }
    } else if (syllabus) {
      const context = syllabus.context as { units?: Array<{ title: string }> } | null;
      for (const u of context?.units ?? []) {
        if (typeof u.title === 'string' && u.title.trim().length > 0) {
          targets.push({ ...base, type: 'unit', title: u.title, unitTitle: u.title });
        }
      }
    }
    return targets;
  }

  private async latestOf(materialId: string, version?: number) {
    const where = version
      ? and(
          eq(materialEnhancements.materialId, materialId),
          eq(materialEnhancements.version, version),
        )
      : eq(materialEnhancements.materialId, materialId);
    const rows = await this.db
      .select()
      .from(materialEnhancements)
      .where(where)
      .orderBy(desc(materialEnhancements.version))
      .limit(1);
    return rows[0] ?? null;
  }

  private async segmentsOf(enhancementId: string): Promise<MaterialResolvedSegment[]> {
    const rows = await this.db
      .select()
      .from(materialEnhancementSegments)
      .where(eq(materialEnhancementSegments.enhancementId, enhancementId))
      .orderBy(asc(materialEnhancementSegments.segmentNo));
    if (!rows.length) return [];

    const mappings = await this.db
      .select()
      .from(materialEnhancementSegmentMappings)
      .where(inArray(materialEnhancementSegmentMappings.segmentId, rows.map((r) => r.id)))
      .orderBy(asc(materialEnhancementSegmentMappings.createdAt));
    const bySegment = new Map<string, MaterialSegmentMapping[]>();
    for (const m of mappings) {
      const list = bySegment.get(m.segmentId) ?? [];
      list.push(this.mappingOf(m));
      bySegment.set(m.segmentId, list);
    }

    return rows.map((r) => ({
      segment: {
        segmentNo: r.segmentNo,
        kind: r.kind,
        level: r.level,
        title: r.title,
        preview: r.preview ?? '',
        startPage: r.startPage,
        endPage: r.endPage,
        blockIds: r.blockIds,
      },
      mappings: bySegment.get(r.id) ?? [],
    }));
  }

  private async assertMaterialScoped(instituteId: string, materialId: string) {
    const [material] = await this.db
      .select()
      .from(materials)
      .where(
        and(
          eq(materials.id, materialId),
          eq(materials.instituteId, instituteId),
          isNull(materials.deletedAt),
        ),
      )
      .limit(1);
    if (!material) {
      throw new NotFoundException('Material not found');
    }
    return material;
  }

  private async toResponse(row: typeof materialEnhancements.$inferSelect) {
    return {
      id: row.id,
      materialId: row.materialId,
      version: row.version,
      trigger: row.trigger,
      sourceRevision: row.sourceRevision,
      sourceTextHash: row.sourceTextHash,
      payload: row.payload as MaterialEnhancementPayload,
      segments: await this.segmentsOf(row.id),
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mappingOf(m: M): MaterialSegmentMapping {
    return {
      type: m.type,
      level: m.level,
      confidence: Number(m.confidence),
      reason: m.reason,
      syllabusId: m.syllabusId,
      subjectId: m.subjectId,
      chapterId: m.chapterId,
      chapterName: m.chapterName,
      topicId: m.topicId,
      topicName: m.topicName,
      unitTitle: m.unitTitle,
    };
  }
}