// Paper Pattern Extraction (Phase B) — coordinator-owned job service.
//
// Mirrors MaterialEnhancementService: MATERIAL_PATTERN_EXTRACT jobs are
// inserted by the API (POST /paper-patterns/extract-from-material), adopted by
// a sweep, and never published to RabbitMQ. The extraction itself is
// deterministic (pattern-extractor.ts), so it belongs in the API, not a worker.
//
// Idempotency: the enqueue reuses an active job for the same material; a
// completed extraction for the same material+revision returns the existing
// pattern (no duplicates). A material revision change frees re-extraction.

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '@catlium/database';
import { jobs, materialEnhancements, materials, paperPatterns, subjects } from '@catlium/database';
import { type MaterialEnhancedBlock, type PatternExtractionMeta } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';
import { extractPaperPattern, type ExtractionBlock } from './pattern-extractor.js';
import { PaperPatternsService } from './paper-patterns.service.js';

const SWEEP_INTERVAL_MS = Number(process.env['WORKER_SWEEP_INTERVAL_MS'] ?? '15000') || 15000;
// `ponytail: fixed 60s lease; per-job leases only if multi-replica sweeps ever
// run concurrently.` Processing is seconds-fast and the material+revision
// reuse check makes reprocessing a no-op, so reclaiming an orphaned row is safe.
const EXTRACTION_LEASE_MS = 60_000;

const TYPE = 'MATERIAL_PATTERN_EXTRACT';

@Injectable()
export class PaperPatternExtractionService implements OnApplicationBootstrap, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobsService: JobsService,
    private readonly patterns: PaperPatternsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── Enqueue ──────────────────────────────────────────────────────

  /** Guard + queue extraction for a READY material. Idempotent: an active job
   *  for the material is reused; an already-completed extraction for the same
   *  material+revision returns the existing pattern directly (COMPLETED). */
  async requestExtraction(
    instituteId: string,
    materialId: string,
    userId?: string,
  ): Promise<{
    jobId: string;
    status: 'QUEUED' | 'COMPLETED';
    reused: boolean;
    patternId?: string;
  }> {
    const material = await this.assertMaterial(instituteId, materialId);

    // Reuse: an identical completed extraction already exists for this
    // material+revision — never silently create a duplicate pattern.
    const [existing] = await this.db
      .select({ id: paperPatterns.id })
      .from(paperPatterns)
      .where(
        and(
          eq(paperPatterns.instituteId, instituteId),
          eq(paperPatterns.sourceType, 'PREVIOUS_YEAR_PAPER'),
          sql`${paperPatterns.extraction}->>'materialId' = ${materialId}`,
          sql`${paperPatterns.extraction}->>'materialRevision' = ${String(material.revision)}`,
        ),
      )
      .limit(1);
    if (existing) {
      const latest = await this.latestJobFor(materialId);
      return {
        jobId: latest?.id ?? existing.id,
        status: 'COMPLETED',
        reused: true,
        patternId: existing.id,
      };
    }

    // Reuse: an active (queued/processing) job is already draining this material.
    const [active] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          eq(jobs.instituteId, instituteId),
          sql`${jobs.status} IN ('queued', 'processing')`,
          sql`${jobs.payload}->>'materialId' = ${materialId}`,
        ),
      )
      .limit(1);
    if (active) {
      return { jobId: active.id, status: 'QUEUED', reused: true };
    }

    const job = await this.jobsService.insertJob(instituteId, TYPE, {
      materialId,
      ...(userId ? { userId } : {}),
    });
    return { jobId: job.id, status: 'QUEUED', reused: false };
  }

  /** Status read for the polling flow. */
  async getExtraction(instituteId: string, jobId: string): Promise<Job> {
    return this.jobsService.getJob(jobId, instituteId);
  }

  // ── Sweep (adopt queued MATERIAL_PATTERN_EXTRACT jobs) ─────────────

  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - EXTRACTION_LEASE_MS);
    const adoptable = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          or(
            eq(jobs.status, 'queued'),
            and(eq(jobs.status, 'processing'), lt(jobs.startedAt, cutoff)),
          ),
        ),
      );
    for (const job of adoptable) {
      try {
        await this.processJob(job.id, job.instituteId, job.payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Extraction failed';
        await this.jobsService.updateJobStatus(job.id, 'failed', undefined, { message });
      }
    }
  }

  private async processJob(jobId: string, instituteId: string, payload: unknown): Promise<void> {
    const materialId = payloadOf(payload)?.['materialId'];
    if (typeof materialId !== 'string') {
      await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
        message: 'MATERIAL_PATTERN_EXTRACT job is missing the materialId payload',
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
        message: material
          ? `Material cannot be extracted while ${material.processingStatus}`
          : 'Material not found',
      });
      return;
    }

    const { blocks, source } = await this.extractionBlocks(
      materialId,
      material.revision,
      material.textContent,
    );

    const { structure, issues, provenance, durationMinutesSource, totalMarksSource } =
      extractPaperPattern(blocks);

    if (structure === null) {
      await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
        message: 'No structured exam pattern could be extracted from the material',
        issues,
      });
      return;
    }

    // A re-swept job must not stack a duplicate pattern for the same revision.
    const [existingPattern] = await this.db
      .select({ id: paperPatterns.id })
      .from(paperPatterns)
      .where(
        and(
          eq(paperPatterns.instituteId, instituteId),
          eq(paperPatterns.sourceType, 'PREVIOUS_YEAR_PAPER'),
          sql`${paperPatterns.extraction}->>'materialId' = ${materialId}`,
          sql`${paperPatterns.extraction}->>'materialRevision' = ${String(material.revision)}`,
        ),
      )
      .limit(1);
    if (existingPattern) {
      await this.jobsService.updateJobStatus(jobId, 'completed', {
        status: 'extracted',
        patternId: existingPattern.id,
        totalMarks: structure.totalMarks,
        durationMinutes: structure.durationMinutes,
        sectionCount: 0,
        ruleCount: 0,
        issueCount: issues.length,
      });
      return;
    }

    const subjectId = await this.liveSubjectId(instituteId, material.subjectId);
    const extractionMeta: PatternExtractionMeta = {
      extractor: 'v1',
      materialId,
      materialRevision: material.revision,
      source,
      totalMarksSource,
      durationMinutesSource,
      issues,
      provenance,
    };

    const patternId = (
      await this.patterns.createPattern(instituteId, userIdOf(payload) ?? material.createdBy, {
        title: material.title,
        subjectId: subjectId ?? undefined,
        description: `Extracted from "${material.title}"`,
        structure,
        sourceType: 'PREVIOUS_YEAR_PAPER',
        sourceMaterialId: materialId,
        status: 'REVIEW',
        extraction: extractionMeta,
      })
    ).id;

    const ruleCount = structure.sections.reduce((n, s) => n + s.questionTypes.length, 0);
    await this.jobsService.updateJobStatus(jobId, 'completed', {
      status: 'extracted',
      patternId,
      totalMarks: structure.totalMarks,
      durationMinutes: structure.durationMinutes,
      sectionCount: structure.sections.length,
      ruleCount,
      issueCount: issues.length,
    });
  }

  // ── Source resolution ─────────────────────────────────────────────

  /** Prefer the freshest enhancement (full-document blocks, page+block
   *  provenance preserved — syllabus relevance never drops sections). Falls
   *  back to the raw text as one synthetic block when no fresh enhancement
   *  exists. */
  private async extractionBlocks(
    materialId: string,
    materialRevision: number,
    textContent: string | null,
  ): Promise<{ blocks: ExtractionBlock[]; source: 'ENHANCEMENT' | 'TEXT' }> {
    const [latest] = await this.db
      .select()
      .from(materialEnhancements)
      .where(eq(materialEnhancements.materialId, materialId))
      .orderBy(desc(materialEnhancements.version))
      .limit(1);

    const payload = latest?.payload as { sections?: MaterialEnhancedBlock[] } | null;
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    if (latest && latest.sourceRevision === materialRevision && sections.length > 0) {
      return {
        blocks: sections.map((b) => ({ id: b.id, kind: b.kind, content: b.content, page: b.page })),
        source: 'ENHANCEMENT',
      };
    }
    if (!textContent) {
      throw new Error('Material has no processable text or enhancement to extract from');
    }
    return {
      blocks: [{ id: 'raw', kind: 'other', content: textContent, page: 1 }],
      source: 'TEXT',
    };
  }

  /** The live (non-deleted) subject of a material, or null — a soft-deleted
   *  subject must not force the extracted pattern onto a dead scope. */
  private async liveSubjectId(
    instituteId: string,
    subjectId: string | null,
  ): Promise<string | null> {
    if (!subjectId) return null;
    const [row] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(
        and(
          eq(subjects.id, subjectId),
          eq(subjects.instituteId, instituteId),
          isNull(subjects.deletedAt),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  private async assertMaterial(instituteId: string, materialId: string) {
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
    if (!material) throw new NotFoundException('Material not found');
    if (material.processingStatus !== 'READY') {
      throw new BadRequestException(
        `Material cannot be extracted while ${material.processingStatus}`,
      );
    }
    return material;
  }

  private async latestJobFor(materialId: string): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, TYPE), sql`${jobs.payload}->>'materialId' = ${materialId}`))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return row ? this.jobsService.getJob(row.id, row.instituteId) : null;
  }
}

function payloadOf(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

function userIdOf(payload: unknown): string | undefined {
  const v = payloadOf(payload)?.['userId'];
  return typeof v === 'string' ? v : undefined;
}
