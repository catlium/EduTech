import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, asc, eq, inArray, lt, or } from 'drizzle-orm';

import { jobs, materials, ocrChunks, ocrPageCorrections, ocrWorkers } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';
import { STORAGE_PROVIDER } from '../materials/storage/storage-provider.interface.js';
import type { StorageProvider } from '../materials/storage/storage-provider.interface.js';
import { validateChunkPages, isCompleteCoverage, derivePageDetails, aggregatePagesText } from './ocr-coordinator.util.js';
import type { ChunkLike, CorrectionLike } from './ocr-coordinator.util.js';
import type {
  OCRProgress,
  OcrChunkStatus,
  OcrPageDetail,
  OcrPageListResponse,
  WorkerChunkFail,
  WorkerChunkResult,
  WorkerClaimResponse,
} from '@catlium/contracts';

// Coordinator config defaults. All server-side lease/chunk sizing knobs live
// here (the worker only reports totalPages; it never decides chunk ranges).
const CHUNK_SIZE = Number(process.env['WORKER_OCR_CHUNK_SIZE'] ?? '10') || 10;
const LEASE_MS = (Number(process.env['WORKER_OCR_LEASE_SECONDS'] ?? '300') || 300) * 1000;
const MAX_ATTEMPTS = 3;
const SWEEP_INTERVAL_MS = Number(process.env['WORKER_SWEEP_INTERVAL_MS'] ?? '15000') || 15000;

const ACTIVE_JOB_STATUSES = ['processing'] as const;

type ChunkRow = typeof ocrChunks.$inferSelect;

function materialIdOf(payload: unknown): string | undefined {
  if (typeof payload === 'object' && payload !== null) {
    return (payload as Record<string, unknown>)['materialId'] as string | undefined;
  }
  return undefined;
}

@Injectable()
export class OcrCoordinatorService implements OnApplicationBootstrap, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobsService: JobsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onApplicationBootstrap(): void {
    // `ponytail: plain setInterval; a distributed lock needed only if multiple
    // API replicas sweep in production.` Design §13 covers the upgrade path.
    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── Enqueue (called from MaterialsService after insertJob) ─────────────

  /** Server-side enqueue: chunk 1 (pages 1..chunkSize), job → processing,
   *  material → PROCESSING. No RabbitMQ publish for OCR job types. */
  async enqueueJob(job: Job, materialId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(ocrChunks).values({
        jobId: job.id,
        instituteId: job.instituteId,
        sourceType: 'MATERIAL',
        sourceId: materialId,
        chunkIndex: 1,
        startPage: 1,
        endPage: CHUNK_SIZE,
      });
      await tx
        .update(materials)
        .set({ processingStatus: 'PROCESSING', updatedAt: new Date() })
        .where(eq(materials.id, materialId));
    });
    await this.jobsService.updateJobStatus(job.id, 'processing');
    await this.writeProgressForJob(job.id);
  }

  // ── Worker-facing ──────────────────────────────────────────────────────

  async heartbeat(workerId: string, status: 'idle' | 'processing'): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [worker] = await tx
        .select()
        .from(ocrWorkers)
        .where(eq(ocrWorkers.id, workerId))
        .for('update')
        .limit(1);

      if (!worker) return;

      await tx
        .update(ocrWorkers)
        .set({ lastHeartbeatAt: now, lastSeenAt: now })
        .where(eq(ocrWorkers.id, workerId));

      if (status === 'processing' && worker.currentChunkId) {
        await tx
          .update(ocrChunks)
          .set({
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
            updatedAt: now,
          })
          .where(and(eq(ocrChunks.id, worker.currentChunkId), eq(ocrChunks.claimedBy, workerId)));
      }
    });
  }

  async claim(workerId: string): Promise<WorkerClaimResponse> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);

    const row = await this.db.transaction(async (tx) => {
      const [claim] = await tx
        .select()
        .from(ocrChunks)
        .innerJoin(jobs, eq(ocrChunks.jobId, jobs.id))
        .where(
          and(
            inArray(jobs.status, ACTIVE_JOB_STATUSES),
            or(
              eq(ocrChunks.status, 'pending'),
              and(eq(ocrChunks.status, 'claimed'), lt(ocrChunks.leaseExpiresAt, now)),
            ),
          ),
        )
        .orderBy(asc(ocrChunks.chunkIndex), asc(ocrChunks.startPage))
        .limit(1)
        .for('update', { skipLocked: true });

      if (!claim) return null;

      const chunk = claim.ocr_chunks;

      await tx
        .update(ocrChunks)
        .set({
          status: 'claimed',
          claimedBy: workerId,
          leaseExpiresAt,
          attempts: chunk.attempts + 1,
          updatedAt: now,
        })
        .where(eq(ocrChunks.id, chunk.id));

      await tx
        .update(ocrWorkers)
        .set({ currentChunkId: chunk.id, lastSeenAt: now })
        .where(eq(ocrWorkers.id, workerId));

      return chunk;
    });

    if (!row) {
      return { chunk: null };
    }

    return {
      chunk: {
        id: row.id,
        index: row.chunkIndex,
        startPage: row.startPage,
        endPage: row.endPage,
        pageCount: row.endPage - row.startPage + 1,
        sourceType: row.sourceType as 'MATERIAL' | 'SYLLABUS',
        sourceId: row.sourceId,
      },
    };
  }

  /** Streamable source bytes for a held chunk (sourceId via StorageProvider). */
  async getSource(
    workerId: string,
    chunkId: string,
  ): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
    const chunk = await this.assertHeld(workerId, chunkId);

    let storageKey: string | null = null;
    let mimeType = 'application/octet-stream';
    let fileName = 'source';

    if (chunk.sourceType === 'MATERIAL') {
      const [material] = await this.db
        .select()
        .from(materials)
        .where(eq(materials.id, chunk.sourceId))
        .limit(1);
      if (!material) {
        throw new Error('Source material not found');
      }
      storageKey = material.storageKey;
      mimeType = material.mimeType ?? 'application/octet-stream';
      fileName = material.fileName ?? 'source';
    }

    if (!storageKey) {
      throw new Error('Source has no stored file');
    }

    const data = await this.storage.read(storageKey);
    return { data, mimeType, fileName };
  }

  async submitResult(
    workerId: string,
    chunkId: string,
    result: WorkerChunkResult,
  ): Promise<void> {
    const chunk = await this.assertHeld(workerId, chunkId);
    validateChunkPages(result.pages.map((p) => p.page), chunk.startPage, chunk.endPage);

    await this.db.transaction(async (tx) => {
      await tx
        .update(ocrChunks)
        .set({
          status: 'submitted',
          claimedBy: null,
          leaseExpiresAt: null,
          result: result as Record<string, unknown>,
          documentPages: result.totalPages ?? chunk.documentPages,
          updatedAt: new Date(),
        })
        .where(eq(ocrChunks.id, chunkId));
      await tx
        .update(ocrWorkers)
        .set({ currentChunkId: null, lastSeenAt: new Date() })
        .where(eq(ocrWorkers.id, workerId));
    });

    if (result.totalPages) {
      await this.materializeRemainingChunks(chunk.jobId, result.totalPages);
    }
    await this.writeProgressForJob(chunk.jobId);
  }

  async failChunk(workerId: string, chunkId: string, input: WorkerChunkFail): Promise<void> {
    const chunk = await this.assertHeld(workerId, chunkId);
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const terminal = input.permanent === true || chunk.attempts >= MAX_ATTEMPTS;
      await tx
        .update(ocrChunks)
        .set({
          status: terminal ? 'failed' : 'pending',
          claimedBy: null,
          leaseExpiresAt: null,
          error: { message: input.error, permanent: input.permanent === true },
          updatedAt: now,
        })
        .where(eq(ocrChunks.id, chunkId));
      await tx
        .update(ocrWorkers)
        .set({ currentChunkId: null, lastSeenAt: now })
        .where(eq(ocrWorkers.id, workerId));
    });

    await this.writeProgressForJob(chunk.jobId);
  }

  // ── Sweep ──────────────────────────────────────────────────────────────

  /** Reclaim expired/disabled chunks, retry retryable failed chunks, flourish
   *  cancelled jobs, finalize READY/FAILED, and write chunk-aggregate progress
   *  for every active OCR job. Idempotent (status-guarded updates). */
  async sweep(): Promise<void> {
    const now = new Date();

    // Reclaim claimed-but-expired chunks, and force-expire chunks held by a
    // disabled worker (its lease never got renewed).
    await this.db.transaction(async (tx) => {
      const expired = await tx
        .select({ id: ocrChunks.id })
        .from(ocrChunks)
        .innerJoin(ocrWorkers, eq(ocrChunks.claimedBy, ocrWorkers.id))
        .where(
          and(
            eq(ocrChunks.status, 'claimed'),
            or(lt(ocrChunks.leaseExpiresAt, now), eq(ocrWorkers.enabled, false)),
          ),
        )
        .for('update', { skipLocked: true });

      for (const chunk of expired) {
        await tx
          .update(ocrChunks)
          .set({ status: 'pending', claimedBy: null, leaseExpiresAt: null, updatedAt: now })
          .where(eq(ocrChunks.id, chunk.id));
        await tx
          .update(ocrWorkers)
          .set({ currentChunkId: null })
          .where(eq(ocrWorkers.currentChunkId, chunk.id));
      }
    });

    // Retry retryable failed chunks (recovery: a failed chunk should always
    // have been routed to pending by failChunk; this covers edge/legacy rows).
    await this.db
      .update(ocrChunks)
      .set({ status: 'pending', error: null, updatedAt: now })
      .where(and(eq(ocrChunks.status, 'failed'), lt(ocrChunks.attempts, MAX_ATTEMPTS)));

    await this.settleActiveJobs();
  }

  private async settleActiveJobs(): Promise<void> {
    const activeRows = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, 'MATERIAL_PROCESS'),
          inArray(jobs.status, ['processing', 'cancelling']),
        ),
      );

    for (const job of activeRows) {
      const chunks = await this.db
        .select()
        .from(ocrChunks)
        .where(eq(ocrChunks.jobId, job.id))
        .orderBy(asc(ocrChunks.chunkIndex));

      const materialId = materialIdOf(job.payload);
      if (!materialId || !chunks.length) {
        await this.writeProgressForJob(job.id);
        continue;
      }

      if (job.status === 'cancelling') {
        await this.cancelJobChunks(job.id, materialId);
        continue;
      }

      const terminalFailed = chunks.find((c) => c.status === 'failed');
      if (terminalFailed) {
        await this.finalizeFailed(job.id, materialId, (terminalFailed.error ?? null) as Record<string, unknown> | null);
        continue;
      }

      const allSubmitted = chunks.every((c) => c.status === 'submitted');
      if (allSubmitted) {
        await this.finalizeReady(job.id, materialId, chunks);
        continue;
      }

      await this.writeProgressForJob(job.id);
    }
  }

  private async cancelJobChunks(jobId: string, materialId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(ocrChunks)
        .set({ status: 'cancelled', claimedBy: null, leaseExpiresAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(ocrChunks.jobId, jobId),
            inArray(ocrChunks.status, ['pending', 'claimed', 'failed']),
          ),
        );
      await tx
        .update(materials)
        .set({ processingStatus: 'QUEUED', progress: null, updatedAt: new Date() })
        .where(eq(materials.id, materialId));
    });
    await this.jobsService.updateJobStatus(jobId, 'cancelled');
  }

  private async finalizeFailed(
    jobId: string,
    materialId: string,
    error: Record<string, unknown> | null,
  ): Promise<void> {
    const message =
      error && typeof error['message'] === 'string' ? error['message'] : 'OCR failed';
    await this.db.transaction(async (tx) => {
      await tx
        .update(materials)
        .set({ processingStatus: 'FAILED', progress: null, updatedAt: new Date() })
        .where(eq(materials.id, materialId));
    });
    await this.jobsService.updateJobStatus(jobId, 'failed', undefined, { message });
  }

  /** READY only after all chunks submitted + contiguous 1..N coverage. */
  private async finalizeReady(
    jobId: string,
    materialId: string,
    chunks: ChunkRow[],
  ): Promise<void> {
    const documentPages = this.documentPagesOf(chunks);
    if (documentPages === null) {
      void this.writeProgressForJob(jobId);
      return;
    }

    const covered = this.coveredPages(chunks);

    // `ponytail: coverage = every page 1..N reported exactly once (no overlap,
    // no gap). Document always starts at page 1 per the engine contract.`
    if (!isCompleteCoverage([...covered], documentPages)) {
      void this.writeProgressForJob(jobId);
      return;
    }

    const text = await this.aggregateMaterialText(materialId, chunks);

    await this.db.transaction(async (tx) => {
      // Persist text BEFORE READY (crash-safe reuse on retry, as the old
      // update_material_text/ready semantics did).
      await tx
        .update(materials)
        .set({ textContent: text, processingStatus: 'READY', progress: null, updatedAt: new Date() })
        .where(eq(materials.id, materialId));
    });
    await this.jobsService.updateJobStatus(jobId, 'completed', {
      textLength: text.length,
      pages: documentPages,
    });
  }

  // ── Admin-facing page inspection / correction ─────────────────────────

  public async listMaterialPages(instituteId: string, materialId: string): Promise<OcrPageListResponse> {
    await this.assertMaterialScoped(instituteId, materialId);
    const job = await this.jobsService.latestMaterialJob(instituteId, materialId);
    if (!job || job.type !== 'MATERIAL_PROCESS') {
      return { documentPages: null, chunks: [], pages: [] };
    }

    const chunks = await this.db
      .select()
      .from(ocrChunks)
      .where(eq(ocrChunks.jobId, job.id))
      .orderBy(asc(ocrChunks.chunkIndex));
    const corrections = await this.correctionsFor(materialId);

    const documentPages = this.documentPagesOf(chunks);
    const pageCount = documentPages ?? Math.max(0, ...chunks.map((c) => c.endPage));

    return {
      documentPages,
      chunks: chunks.map((c) => this.chunkSummaryOf(c)),
      pages: derivePageDetails(
        chunks.map((c) => this.chunkLikeOf(c)),
        pageCount,
        corrections,
      ),
    };
  }

  /** Upsert a manual correction for one page. Survives re-runs (keyed by
   *  material+page, not chunk). When the material is already READY the
   *  aggregate `textContent` is recomputed with the correction applied so
   *  downstream AI never reads stale uncorrected text. */
  public async saveCorrection(
    instituteId: string,
    materialId: string,
    page: number,
    text: string,
    correctedBy: string,
  ): Promise<OcrPageDetail> {
    const material = await this.assertMaterialScoped(instituteId, materialId);
    const chunks = await this.chunksOfLatestJob(instituteId, materialId);

    const chunk = chunks.find((c) => c.startPage <= page && page <= c.endPage);
    const pageIsExtracted = this.hasPageEntry(chunk, page);
    if (!pageIsExtracted) {
      throw new BadRequestException('Page has no extracted text yet; correct it after OCR completes');
    }

    await this.db
      .insert(ocrPageCorrections)
      .values({
        sourceType: 'MATERIAL',
        sourceId: materialId,
        page,
        correctedText: text,
        correctedBy,
        correctedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [ocrPageCorrections.sourceType, ocrPageCorrections.sourceId, ocrPageCorrections.page],
        set: {
          correctedText: text,
          correctedBy,
          correctedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    if (material.processingStatus === 'READY') {
      await this.reapplyAggregate(material, chunks);
    }

    const corrections = await this.correctionsFor(materialId);
    return this.pageDetailOf(chunks, corrections, page);
  }

  /** Remove a correction; the page falls back to its original OCR output and
   *  the aggregate `textContent` is recomputed (bumped only if it changed). */
  public async clearCorrection(instituteId: string, materialId: string, page: number): Promise<OcrPageDetail> {
    const material = await this.assertMaterialScoped(instituteId, materialId);
    const [deleted] = await this.db
      .delete(ocrPageCorrections)
      .where(
        and(
          eq(ocrPageCorrections.sourceType, 'MATERIAL'),
          eq(ocrPageCorrections.sourceId, materialId),
          eq(ocrPageCorrections.page, page),
        ),
      )
      .returning();
    if (!deleted) {
      throw new NotFoundException('No correction exists for this page');
    }

    const chunks = await this.chunksOfLatestJob(instituteId, materialId);
    if (material.processingStatus === 'READY') {
      await this.reapplyAggregate(material, chunks);
    }
    return this.pageDetailOf(chunks, await this.correctionsFor(materialId), page);
  }

  private async reapplyAggregate(
    material: { id: string; textContent: string | null; revision: number },
    chunks: ChunkRow[],
  ): Promise<void> {
    if (!chunks.length) return;
    const text = await this.aggregateMaterialText(material.id, chunks);
    if (text !== material.textContent) {
      await this.db
        .update(materials)
        .set({ textContent: text, revision: material.revision + 1, updatedAt: new Date() })
        .where(eq(materials.id, material.id));
    }
  }

  private async assertMaterialScoped(instituteId: string, materialId: string) {
    const [material] = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .limit(1);
    if (!material) {
      throw new NotFoundException('Material not found');
    }
    return material;
  }

  private async chunksOfLatestJob(instituteId: string, materialId: string): Promise<ChunkRow[]> {
    const job = await this.jobsService.latestMaterialJob(instituteId, materialId);
    if (!job) return [];
    return this.db.select().from(ocrChunks).where(eq(ocrChunks.jobId, job.id));
  }

  private async correctionsFor(materialId: string): Promise<Map<number, CorrectionLike>> {
    const rows = await this.db
      .select()
      .from(ocrPageCorrections)
      .where(
        and(
          eq(ocrPageCorrections.sourceType, 'MATERIAL'),
          eq(ocrPageCorrections.sourceId, materialId),
        ),
      );
    return new Map(
      rows.map((r) => [
        r.page,
        { correctedText: r.correctedText, correctedBy: r.correctedBy, correctedAt: r.correctedAt.toISOString() },
      ]),
    );
  }

  private chunkLikeOf(chunk: ChunkRow): ChunkLike {
    return {
      chunkIndex: chunk.chunkIndex,
      startPage: chunk.startPage,
      endPage: chunk.endPage,
      status: chunk.status,
      result: this.resultOf(chunk),
    };
  }

  private hasPageEntry(chunk: ChunkRow | undefined, page: number): boolean {
    if (!chunk || chunk.status !== 'submitted') return false;
    const pages = (chunk.result as Record<string, unknown> | null)?.['pages'];
    return (
      Array.isArray(pages) &&
      (pages as Array<Record<string, unknown>>).some(
        (p) => p['page'] === page && typeof p['text'] === 'string' && (p['text'] as string).length > 0,
      )
    );
  }

  private pageDetailOf(
    chunks: ChunkRow[],
    corrections: Map<number, CorrectionLike>,
    page: number,
  ): OcrPageDetail {
    const rows = derivePageDetails(
      chunks.map((c) => this.chunkLikeOf(c)),
      page,
      corrections,
    );
    return rows[rows.length - 1]!;
  }

  private chunkSummaryOf(chunk: ChunkRow) {
    const error = chunk.error;
    return {
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      startPage: chunk.startPage,
      endPage: chunk.endPage,
      status: chunk.status as OcrChunkStatus,
      attempts: chunk.attempts,
      claimedBy: chunk.claimedBy,
      error: error && typeof (error as { message?: unknown })['message'] === 'string'
        ? ((error as { message: string }).message)
        : null,
      createdAt: chunk.createdAt.toISOString(),
      updatedAt: chunk.updatedAt.toISOString(),
    };
  }

  /** Full-document text with corrections applied (pure — see util). */
  private async aggregateMaterialText(materialId: string, chunks: ChunkRow[]): Promise<string> {
    const corrections = await this.correctionsFor(materialId);
    const correctionsByPage = new Map<number, string>(
      [...corrections.entries()].map(([page, c]) => [page, c.correctedText]),
    );
    return aggregatePagesText(
      chunks.map((c) => this.chunkLikeOf(c)),
      correctionsByPage,
    );
  }

  // ── Progress ───────────────────────────────────────────────────────────

  /** Chunk-aggregate progress write for a job's material. */
  private async writeProgressForJob(jobId: string): Promise<void> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return;

    const chunks = await this.db
      .select()
      .from(ocrChunks)
      .where(eq(ocrChunks.jobId, jobId));

    const materialId = materialIdOf(job.payload);
    if (!materialId) return;

    const documentPages = this.documentPagesOf(chunks);
    const submitted = chunks.filter((c) => c.status === 'submitted');

    const pagesProcessed = submitted.reduce(
      (acc, c) => acc + this.pagesOf(c).length,
      0,
    );
    const pagesTotal = documentPages ?? Math.max(0, ...chunks.map((c) => c.endPage));

    const progress: OCRProgress = {
      chunksCompleted: submitted.length,
      chunksTotal: chunks.length,
      pagesProcessed,
      pagesTotal,
      percent: pagesTotal ? Math.min(100, Math.round((pagesProcessed / pagesTotal) * 100)) : 0,
      activeChunks: chunks.filter((c) => c.status === 'claimed').length,
      failedChunks: chunks.filter((c) => c.status === 'failed').length,
      retryingChunks: chunks.filter((c) => c.status === 'pending' && c.attempts > 0).length,
    };

    await this.db
      .update(materials)
      .set({ progress: progress as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(materials.id, materialId));
  }

  /** Materialize chunks 2..ceil(totalPages/chunkSize) once totalPages is known. */
  private async materializeRemainingChunks(jobId: string, totalPages: number): Promise<void> {
    const needed = Math.ceil(totalPages / CHUNK_SIZE);
    const existing = await this.db
      .select({ chunkIndex: ocrChunks.chunkIndex })
      .from(ocrChunks)
      .where(eq(ocrChunks.jobId, jobId));
    const existingIndexes = new Set(existing.map((e) => e.chunkIndex));

    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return;
    const materialId = materialIdOf(job.payload);
    if (!materialId) return;

    // `ponytail: build values inline; a typed "new row" cast keeps drizzle from
    // widening the union. Only the missing indexes are inserted.`
    const values: Array<{
      jobId: string;
      instituteId: string;
      sourceType: string;
      sourceId: string;
      chunkIndex: number;
      startPage: number;
      endPage: number;
      documentPages: number;
    }> = [];

    for (let index = 1; index <= needed; index++) {
      if (existingIndexes.has(index)) continue;
      const startPage = (index - 1) * CHUNK_SIZE + 1;
      const endPage = Math.min(index * CHUNK_SIZE, totalPages);
      if (startPage > totalPages) continue;
      values.push({
        jobId,
        instituteId: job.instituteId,
        sourceType: 'MATERIAL',
        sourceId: materialId,
        chunkIndex: index,
        startPage,
        endPage,
        documentPages: totalPages,
      });
    }

    if (values.length) {
      await this.db.insert(ocrChunks).values(values);
    }
  }

  // ── Validation / helpers ───────────────────────────────────────────────

  private async assertHeld(workerId: string, chunkId: string): Promise<ChunkRow> {
    const [chunk] = await this.db
      .select()
      .from(ocrChunks)
      .where(eq(ocrChunks.id, chunkId))
      .limit(1);
    if (!chunk) {
      throw new Error('Chunk not found');
    }
    if (chunk.claimedBy !== workerId || chunk.status !== 'claimed') {
      throw new Error('Chunk is not held by this worker');
    }
    return chunk;
  }

  private resultOf(chunk: ChunkRow): Record<string, unknown> {
    return (chunk.result as Record<string, unknown> | null) ?? {};
  }

  private pagesOf(chunk: ChunkRow): Array<{ page: number }> {
    const pages = this.resultOf(chunk)['pages'];
    return Array.isArray(pages) ? (pages as Array<{ page: number }>) : [];
  }

  private documentPagesOf(chunks: ChunkRow[]): number | null {
    let documentPages: number | null = null;
    for (const c of chunks) {
      const reported = typeof this.resultOf(c)['totalPages'] === 'number'
        ? (this.resultOf(c)['totalPages'] as number)
        : c.documentPages;
      if (reported && (!documentPages || reported > documentPages)) {
        documentPages = reported;
      }
    }
    return documentPages;
  }

  private coveredPages(chunks: ChunkRow[]): Set<number> {
    const covered = new Set<number>();
    for (const c of chunks) {
      for (const p of this.pagesOf(c)) {
        covered.add(p.page);
      }
    }
    return covered;
  }
}