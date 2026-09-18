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
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import {
  jobs,
  materialEnhancements,
  materials,
  ocrChunks,
  ocrPageCorrections,
  syllabi,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';
import type { MaterialAlignment, MaterialEnhancementPayload } from '@catlium/contracts';
import { pagesWithText } from '../ocr/ocr-coordinator.util.js';
import type { ChunkLike, CorrectionLike } from '../ocr/ocr-coordinator.util.js';
import { enhanceMaterial, sourceFingerprint } from './enhancer.js';
import type { EnhancePage } from './enhancer.js';

const SWEEP_INTERVAL_MS = Number(process.env['WORKER_SWEEP_INTERVAL_MS'] ?? '15000') || 15000;

export type EnhancementTrigger = 'OCR_COMPLETE' | 'CORRECTION' | 'TEXT_SOURCE' | 'MANUAL';

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
    const [latest] = await this.db
      .select()
      .from(materialEnhancements)
      .where(eq(materialEnhancements.materialId, materialId))
      .orderBy(desc(materialEnhancements.version))
      .limit(1);
    return {
      material: {
        id: material.id,
        title: material.title,
        revision: material.revision,
        subjectId: material.subjectId,
      },
      enhancement: latest ? this.toResponse(latest) : null,
    };
  }

  async listVersions(instituteId: string, materialId: string) {
    await this.assertMaterialScoped(instituteId, materialId);
    const rows = await this.db
      .select()
      .from(materialEnhancements)
      .where(eq(materialEnhancements.materialId, materialId))
      .orderBy(desc(materialEnhancements.version));
    return rows.map((r) => ({
      version: r.version,
      trigger: r.trigger,
      sourceRevision: r.sourceRevision,
      findings: (r.payload as MaterialEnhancementPayload).summary.findings,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ── Sweep (adopt queued MATERIAL_ENHANCE jobs) ─────────────────────────

  async sweep(): Promise<void> {
    const queued = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, 'MATERIAL_ENHANCE'), eq(jobs.status, 'queued')));
    for (const job of queued) {
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
      .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)))
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

    const targets = await this.alignmentTargets(instituteId, material.subjectId);
    const { payload: enhanced, alignment } = enhanceMaterial(pages, targets);

    const version = (latest?.version ?? 0) + 1;
    const trigger = (payloadOf(payload)?.['trigger'] as string | undefined) ?? 'MANUAL';
    const createdBy =
      typeof payloadOf(payload)?.['userId'] === 'string'
        ? (payloadOf(payload)?.['userId'] as string)
        : null;

    await this.db.transaction(async (tx) => {
      await tx.insert(materialEnhancements).values({
        materialId,
        version,
        trigger,
        sourceRevision: material.revision,
        sourceTextHash: fingerprint,
        payload: enhanced as unknown as Record<string, unknown>,
        alignment: (alignment as unknown as Record<string, unknown>[]) ?? null,
        createdBy,
      });
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

  /** Confirmed syllabus units for the material's subject — the alignment
   *  targets (never invented; empty when the subject/context is missing). */
  private async alignmentTargets(
    instituteId: string,
    subjectId: string | null,
  ): Promise<Array<{ syllabusId: string; unitTitle: string }>> {
    if (!subjectId) return [];
    const [syllabus] = await this.db
      .select({ id: syllabi.id, context: syllabi.context })
      .from(syllabi)
      .where(
        and(
          eq(syllabi.instituteId, instituteId),
          eq(syllabi.subjectId, subjectId),
          eq(syllabi.status, 'CONFIRMED'),
          isNull(syllabi.deletedAt),
        ),
      )
      .orderBy(desc(syllabi.version))
      .limit(1);
    if (!syllabus) return [];
    const context = syllabus.context as { units?: Array<{ title: string }> } | null;
    return (context?.units ?? [])
      .filter((u) => typeof u.title === 'string' && u.title.trim().length > 0)
      .map((u) => ({ syllabusId: syllabus.id, unitTitle: u.title }));
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

  private toResponse(row: typeof materialEnhancements.$inferSelect) {
    return {
      id: row.id,
      materialId: row.materialId,
      version: row.version,
      trigger: row.trigger,
      sourceRevision: row.sourceRevision,
      sourceTextHash: row.sourceTextHash,
      payload: row.payload as MaterialEnhancementPayload,
      alignment: (row.alignment as unknown as MaterialAlignment[]) ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}