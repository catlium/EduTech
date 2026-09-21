// Paper Pattern Extraction — coordinator-owned job service (generic).
//
// Mirrors the pre-amendment MATERIAL_PATTERN_EXTRACT flow but treats the
// source as a pure INPUT: any uploaded PDF/image (OCR'd via the OCR service)
// or pasted text feeds the same deterministic extractor (pattern-extractor.ts)
// and becomes a reviewable PaperPattern. No Material is involved, no Material →
// Paper Pattern ownership exists, and nothing is published to RabbitMQ — the
// API sweep adopts queued PATTERN_EXTRACT jobs (15s interval, 60s lease).
//
// Idempotency is keyed on the source SHA-256: re-enqueuing the same text or
// file returns the existing completed pattern instead of a duplicate.

import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '@catlium/database';
import { jobs, paperPatterns } from '@catlium/database';
import type { PatternExtractionMeta } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';
import { AcademicScopeService } from '../authorization/academic-scope.service.js';
import { extractPaperPattern, type ExtractionBlock } from './pattern-extractor.js';
import { PaperPatternsService } from './paper-patterns.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../materials/storage/storage-provider.interface.js';
import { MAX_FILE_SIZE } from '../materials/materials.constants.js';

const SWEEP_INTERVAL_MS = Number(process.env['WORKER_SWEEP_INTERVAL_MS'] ?? '15000') || 15000;
// `ponytail: fixed 60s lease; per-job leases only if multi-replica sweeps ever
// run concurrently.` Processing is seconds-fast and the source-hash reuse
// check makes reprocessing a no-op, so reclaiming an orphaned row is safe.
const EXTRACTION_LEASE_MS = 60_000;

// The OCR service is a separate FastAPI deployment (internal, x-internal-api-key).
const OCR_SERVICE_URL = process.env['OCR_SERVICE_URL'] ?? 'http://ocr:8000';
const OCR_INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? '';

// The OCR engine accepts PDF + png/jpeg/webp images (not gif). Text never goes
// through OCR — it is pasted via the text endpoint.
const OCR_FILE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

const TYPE = 'PATTERN_EXTRACT';

@Injectable()
export class PaperPatternExtractionService implements OnApplicationBootstrap, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobsService: JobsService,
    private readonly patterns: PaperPatternsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly scope: AcademicScopeService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── Enqueue ──────────────────────────────────────────────────────

  /** Guard + queue extraction from pasted text. Idempotent: an active job is
   *  reused; an already-completed extraction for the same text (its SHA-256)
   *  returns the existing pattern directly (COMPLETED). */
  async requestTextExtraction(
    instituteId: string,
    text: string,
    userId?: string,
    membershipId?: string,
  ): Promise<ExtractionEnqueueResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Text to extract from cannot be empty');
    }
    const sourceHash = sha256(trimmed);
    return this.enqueue(instituteId, sourceHash, {
      kind: 'text',
      text: trimmed,
      sourceHash,
      ...(userId ? { userId } : {}),
      ...(membershipId ? { membershipId } : {}),
    });
  }

  /** Guard + queue extraction from an uploaded PDF/image. The file is stored so
   *  the sweep can pass it to the OCR service; storage is transient and removed
   *  after processing. Idempotent on the file's SHA-256. */
  async requestFileExtraction(
    instituteId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
    },
    userId?: string,
    membershipId?: string,
  ): Promise<ExtractionEnqueueResult> {
    if (file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(`File exceeds the ${MAX_FILE_SIZE / (1024 * 1024)} MB limit`);
    }
    const mimeType = file.mimetype.toLowerCase();
    if (!OCR_FILE_TYPES.has(mimeType)) {
      throw new BadRequestException(
        'Paper pattern extraction supports PDF or PNG/JPEG/WebP images — paste the paper text for other sources',
      );
    }
    const sourceHash = sha256(file.buffer);
    const storageKey = `pattern-extraction/${instituteId}/${createHash('sha256').update(sourceHash).digest('hex').slice(0, 12)}/source.${extOf(mimeType)}`;
    const reused = await this.reuseFor(instituteId, sourceHash);
    if (reused) return reused;
    await this.storage.save({ key: storageKey, data: file.buffer });
    try {
      return await this.enqueue(instituteId, sourceHash, {
        kind: 'file',
        storageKey,
        mimeType,
        fileName: file.originalname.slice(0, 255) || 'source',
        sourceHash,
        ...(userId ? { userId } : {}),
        ...(membershipId ? { membershipId } : {}),
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Status read for the polling flow. Pattern runs own their source submission
   *  — only the requesting user or an institute admin may poll it (§18.7). */
  async getExtraction(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
  ): Promise<Job> {
    const job = await this.jobsService.getJob(jobId, instituteId);
    const scope = await this.scope.resolveScope(instituteId, membershipId);
    const owner = typeof job.payload?.['userId'] === 'string' ? job.payload['userId'] : undefined;
    if (scope.kind !== 'whole-institute' && owner !== undefined && owner !== userId) {
      throw new NotFoundException('Paper pattern extraction run not found');
    }
    return job;
  }

  // ── Sweep (adopt queued PATTERN_EXTRACT jobs) ────────────────────

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
    await this.jobsService.updateJobStatus(jobId, 'processing');

    const jobPayload = payloadOf(payload);
    const sourceHash =
      typeof jobPayload?.['sourceHash'] === 'string' ? jobPayload['sourceHash'] : undefined;
    const userId = typeof jobPayload?.['userId'] === 'string' ? jobPayload['userId'] : undefined;
    const membershipId =
      typeof jobPayload?.['membershipId'] === 'string' ? jobPayload['membershipId'] : undefined;
    if (!sourceHash) {
      await this.fail(jobId, 'PATTERN_EXTRACT job is missing the sourceHash payload');
      return;
    }
    if (!userId || !membershipId) {
      await this.fail(jobId, 'PATTERN_EXTRACT job is missing the requesting user');
      return;
    }
    if (!jobPayload) {
      await this.fail(jobId, 'PATTERN_EXTRACT job has an empty payload');
      return;
    }

    let blocks: ExtractionBlock[];
    let source: 'TEXT' | 'OCR';
    let fileName: string | undefined;
    let pageCount: number | undefined;

    if (jobPayload['kind'] === 'text') {
      const text = jobPayload['text'];
      if (typeof text !== 'string' || !text.trim()) {
        await this.fail(jobId, 'PATTERN_EXTRACT text job has no text');
        return;
      }
      blocks = [{ id: 'text', kind: 'other', content: text, page: 1 }];
      source = 'TEXT';
    } else if (jobPayload['kind'] === 'file') {
      const storageKey = jobPayload['storageKey'];
      const mimeType = jobPayload['mimeType'];
      if (typeof storageKey !== 'string' || typeof mimeType !== 'string') {
        await this.fail(jobId, 'PATTERN_EXTRACT file job is missing the storage payload');
        return;
      }
      let data: Buffer;
      try {
        data = await this.storage.read(storageKey);
      } catch {
        await this.fail(jobId, 'Uploaded source file was not found — re-upload it');
        return;
      }
      // The OCR call is the heavy step; it runs here in the API-side sweep, not
      // in the request handler, so the uploader just polls. `ponytail: sync OCR
      // call in the coordinator sweep; route the sweep through a RabbitMQ worker
      // (or the distributed ocr-worker claim flow) if extraction volume grows.`
      const pages = await this.ocrPages(data, mimeType);
      blocks = pages.map((p) => ({
        id: `page-${p.page}`,
        kind: 'other',
        content: p.text,
        page: p.page,
      }));
      source = 'OCR';
      fileName = typeof jobPayload['fileName'] === 'string' ? jobPayload['fileName'] : undefined;
      pageCount = pages.length;
      await this.storage.delete(storageKey).catch(() => undefined);
    } else {
      await this.fail(jobId, 'PATTERN_EXTRACT job has an unknown kind');
      return;
    }

    const { structure, issues, provenance, durationMinutesSource, totalMarksSource } =
      extractPaperPattern(blocks);

    if (structure === null) {
      await this.fail(
        jobId,
        'No structured exam pattern could be extracted from the source',
        issues,
      );
      return;
    }

    // A re-swept job must not stack a duplicate pattern for the same source:
    // if a completed pattern already exists, reference it and stop.
    if (await this.existingPatternFor(instituteId, sourceHash)) {
      const existing = await this.existingPatternFor(instituteId, sourceHash);
      await this.jobsService.updateJobStatus(jobId, 'completed', {
        status: 'extracted',
        patternId: existing?.id,
        totalMarks: structure.totalMarks,
        durationMinutes: structure.durationMinutes,
        sectionCount: 0,
        ruleCount: 0,
        issueCount: issues.length,
      });
      return;
    }

    const extractionMeta: PatternExtractionMeta = {
      extractor: 'v1',
      source,
      sourceHash,
      ...(fileName ? { fileName } : {}),
      ...(pageCount !== undefined ? { pageCount } : {}),
      totalMarksSource,
      durationMinutesSource,
      issues,
      provenance,
    };

    // Resource-first: the pattern was created at enqueue (REVIEW, structure
    // null). Fill that placeholder in place. If it is gone (deleted while the
    // job was queued), create a fresh pattern so a job never resolves to
    // nothing.
    const patternId =
      typeof jobPayload['patternId'] === 'string' ? jobPayload['patternId'] : undefined;
    const placeholder = patternId
      ? await this.patterns.getPattern(instituteId, membershipId, userId!, patternId).catch(() => null)
      : null;

    let resolvedPatternId: string;
    if (placeholder && placeholder.structure === null) {
      await this.db
        .update(paperPatterns)
        .set({ structure, extraction: extractionMeta, updatedAt: new Date() })
        .where(and(eq(paperPatterns.id, placeholder.id), eq(paperPatterns.instituteId, instituteId)));
      resolvedPatternId = placeholder.id;
    } else {
      resolvedPatternId = (
        await this.patterns.createPattern(instituteId, membershipId, userId!, {
          title: titleFrom(fileName),
          description:
            source === 'OCR'
              ? `Extracted from "${fileName ?? 'uploaded source'}"`
              : 'Extracted from pasted text',
          structure,
          sourceType: 'PREVIOUS_YEAR_PAPER',
          status: 'REVIEW',
          extraction: extractionMeta,
        })
      ).id;
    }

    const ruleCount = structure.sections.reduce((n, s) => n + s.questionTypes.length, 0);
    await this.jobsService.updateJobStatus(jobId, 'completed', {
      status: 'extracted',
      patternId: resolvedPatternId,
      totalMarks: structure.totalMarks,
      durationMinutes: structure.durationMinutes,
      sectionCount: structure.sections.length,
      ruleCount,
      issueCount: issues.length,
    });
  }

  // ── Source resolution ─────────────────────────────────────────────

  /** Call the OCR service's per-page extraction endpoint. The result keeps real
   *  page numbers so PDF provenance survives into the extraction meta. */
  private async ocrPages(
    data: Buffer,
    mimeType: string,
  ): Promise<Array<{ page: number; text: string; source: string }>> {
    const form = new FormData();
    form.append('file', new Blob([data], { type: mimeType }), 'source');
    const response = await fetch(`${OCR_SERVICE_URL}/extract/pages`, {
      method: 'POST',
      body: form,
      ...(OCR_INTERNAL_API_KEY ? { headers: { 'x-internal-api-key': OCR_INTERNAL_API_KEY } } : {}),
    });
    if (!response.ok) {
      let detail = `OCR failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { detail?: unknown };
        if (body?.detail) detail = String(body.detail);
      } catch {
        // keep the status-based message
      }
      throw new Error(detail);
    }
    const body = (await response.json()) as {
      pages?: Array<{ page: number; text: string; source: string }>;
    };
    const pages = Array.isArray(body?.pages) ? body.pages : [];
    if (pages.length === 0 || pages.every((p) => !p.text)) {
      throw new Error('No text could be extracted from the source');
    }
    return pages;
  }

  private async fail(jobId: string, message: string, issues?: unknown[]): Promise<void> {
    await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
      message,
      ...(issues && issues.length > 0 ? { issues } : {}),
    });
  }

  private async enqueue(
    instituteId: string,
    sourceHash: string,
    payload: Record<string, unknown>,
  ): Promise<ExtractionEnqueueResult> {
    // Reuse an active (QUEUED/processing) or already completed run before
    // ever creating another resource — the source hash is the idempotency key.
    const reused = await this.reuseFor(instituteId, sourceHash);
    if (reused) {
      await this.dropStoredSource(payload);
      return reused;
    }

    // Resource-first: create the REVIEW placeholder pattern NOW — the sweep
    // fills its structure in place, so the teacher lands on a real pattern
    // page (with live progress) the moment the request returns.
    const source: 'TEXT' | 'OCR' = payload['kind'] === 'file' ? 'OCR' : 'TEXT';
    const fileName = typeof payload['fileName'] === 'string' ? payload['fileName'] : undefined;
    const userId = typeof payload['userId'] === 'string' ? payload['userId'] : undefined;
    const membershipId = typeof payload['membershipId'] === 'string' ? payload['membershipId'] : undefined;
    const extraction: PatternExtractionMeta = {
      extractor: 'v1',
      source,
      sourceHash,
      ...(fileName ? { fileName } : {}),
      totalMarksSource: 'UNKNOWN',
      durationMinutesSource: 'UNKNOWN',
      issues: [],
      provenance: [],
    };
    const pattern = await this.patterns.createPattern(
      instituteId,
      membershipId ?? '',
      userId ?? '',
      {
        title: titleFrom(fileName),
        description:
          source === 'OCR'
            ? `Extracting from "${fileName ?? 'uploaded source'}"…`
            : 'Extracted from pasted text',
        sourceType: 'PREVIOUS_YEAR_PAPER',
        status: 'REVIEW',
        extraction,
      },
    );

    const job = await this.jobsService.insertJob(instituteId, TYPE, {
      ...payload,
      patternId: pattern.id,
    });
    return { jobId: job.id, status: 'QUEUED', reused: false, patternId: pattern.id };
  }

  /** Reuse the QUEUED/processing run (or the completed extraction) that
   *  already exists for a source → never a duplicate resource. */
  private async reuseFor(
    instituteId: string,
    sourceHash: string,
  ): Promise<ExtractionEnqueueResult | null> {
    const active = await this.activeJobFor(instituteId, sourceHash);
    if (active) {
      return { jobId: active.id, status: 'QUEUED', reused: true, patternId: active.patternId };
    }
    const existing = await this.existingPatternFor(instituteId, sourceHash);
    if (existing) {
      const latest = await this.latestJobFor(instituteId, sourceHash);
      return {
        jobId: latest?.id ?? '',
        status: 'COMPLETED',
        reused: true,
        patternId: existing.id,
      };
    }
    return null;
  }

  /** Drop the transient source file when a reuse makes the just-saved copy
   *  redundant (best-effort — the sweep clean-up is the reliable path). */
  private async dropStoredSource(payload: Record<string, unknown>): Promise<void> {
    const storageKey = payload['storageKey'];
    if (typeof storageKey === 'string') {
      await this.storage.delete(storageKey).catch(() => undefined);
    }
  }

  /** A completed extraction for the source exists — keyed on the extraction
   *  meta's sourceHash AND a real structure (the resource-first placeholder
   *  carries the same hash but null structure until the sweep fills it). */
  private async existingPatternFor(
    instituteId: string,
    sourceHash: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await this.db
      .select({ id: paperPatterns.id })
      .from(paperPatterns)
      .where(
        and(
          eq(paperPatterns.instituteId, instituteId),
          eq(paperPatterns.sourceType, 'PREVIOUS_YEAR_PAPER'),
          isNotNull(paperPatterns.structure),
          sql`${paperPatterns.extraction}->>'sourceHash' = ${sourceHash}`,
        ),
      )
      .limit(1);
    return row;
  }

  private async activeJobFor(
    instituteId: string,
    sourceHash: string,
  ): Promise<{ id: string; patternId: string } | undefined> {
    const [row] = await this.db
      .select({ id: jobs.id, patternId: sql<string>`${jobs.payload}->>'patternId'` })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          eq(jobs.instituteId, instituteId),
          sql`${jobs.status} IN ('queued', 'processing')`,
          sql`${jobs.payload}->>'sourceHash' = ${sourceHash}`,
          sql`${jobs.payload}->>'patternId' IS NOT NULL`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return row?.id && row.patternId ? { id: row.id, patternId: row.patternId } : undefined;
  }

  private async latestJobFor(
    instituteId: string,
    sourceHash: string,
  ): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          eq(jobs.instituteId, instituteId),
          sql`${jobs.payload}->>'sourceHash' = ${sourceHash}`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return row ? this.jobsService.getJob(row.id, row.instituteId) : null;
  }
}

export interface ExtractionEnqueueResult {
  jobId: string;
  status: 'QUEUED' | 'COMPLETED';
  reused: boolean;
  patternId: string;
}

function payloadOf(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function extOf(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

function titleFrom(fileName: string | undefined): string {
  if (!fileName) return 'Extracted Paper Pattern';
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return (base || 'Extracted Paper Pattern').slice(0, 255);
}
