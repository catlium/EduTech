// Question Paper extraction (Phase 49) — coordinator-owned jobs.
//
// Resource-first: an uploaded PDF/image (OCR'd via the OCR service) or pasted
// text creates the Question Paper immediately, then a QP_EXTRACT job extracts
// questions with the same deterministic extractor as Phase 47 and links them
// into the paper. The questions themselves are stored in `questions` as
// status=REVIEW + source=EXTRACTED (provenance->>'jobId' scopes the review
// run), so the existing Question Bank review flow accepts or fixes them, while
// the paper already shows them via question_paper_questions.
//
// Idempotency is keyed on the source SHA-256 (same key the pattern extraction
// service uses): re-enqueuing the same source returns the existing run/paper.

import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { Database } from '@catlium/database';
import { jobs, questionPapers, questionPaperQuestions, questions } from '@catlium/database';
import type { QuestionExtractionIssue, QuestionExtractionProvenance } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';
import { AcademicScopeService } from '../authorization/academic-scope.service.js';
import { extractPaperPattern } from '../paper-patterns/pattern-extractor.js';
import {
  extractQuestions,
  type DetectedQuestion,
  type ExtractionSourceBlock,
} from '../question-extraction/question-extractor.js';
import { QuestionTypesService } from '../questions/question-types.service.js';
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

const TYPE = 'QP_EXTRACT';

@Injectable()
export class QuestionPaperExtractionService implements OnApplicationBootstrap, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobsService: JobsService,
    private readonly types: QuestionTypesService,
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

  /** Guard + queue extraction from pasted paper text. Idempotent: an active
   *  job is reused; an already-completed run for the same text (its SHA-256)
   *  returns the existing run directly (COMPLETED). With `paperId` the
   *  questions are linked into that paper; without it the extraction fills the
   *  Question Bank (REVIEW candidates only, no paper). */
  async requestTextExtraction(
    instituteId: string,
    text: string,
    userId: string,
    paperId?: string,
  ): Promise<ExtractionEnqueueResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Text to extract from cannot be empty');
    }
    const sourceHash = sha256(trimmed);
    return this.enqueue(instituteId, sourceHash, userId, {
      kind: 'text',
      text: trimmed,
      sourceHash,
    }, paperId);
  }

  /** Guard + queue extraction from an uploaded paper file. The file is stored
   *  so the sweep can pass it to the OCR service; storage is transient and
   *  removed after processing. Idempotent on the file's SHA-256. With `paperId`
   *  questions are linked into that paper; without it they fill the Question
   *  Bank. */
  async requestFileExtraction(
    instituteId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
    },
    userId: string,
    paperId?: string,
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
        'Question paper extraction supports PDF or PNG/JPEG/WebP images — paste the paper text for other sources',
      );
    }
    const sourceHash = sha256(file.buffer);
    const storageKey = `qp-extraction/${instituteId}/${createHash('sha256').update(sourceHash).digest('hex').slice(0, 12)}/source.${extOf(mimeType)}`;
    const reused = await this.reuseFor(instituteId, sourceHash, paperId);
    if (reused) return reused;
    await this.storage.save({ key: storageKey, data: file.buffer });
    try {
      return await this.enqueue(instituteId, sourceHash, userId, {
        kind: 'file',
        storageKey,
        mimeType,
        fileName: file.originalname.slice(0, 255) || 'source',
        sourceHash,
      }, paperId);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Status read for the polling flow. QP runs own their source submission —
   *  only the requesting user or an institute admin may poll it (§18.7). */
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
      throw new NotFoundException('Question paper extraction run not found');
    }
    return job;
  }

  // ── Sweep (adopt queued QP_EXTRACT jobs) ─────────────────────────

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
    const jobPayload = payloadOf(payload);
    const sourceHash =
      typeof jobPayload?.['sourceHash'] === 'string' ? jobPayload['sourceHash'] : undefined;
    const userId = typeof jobPayload?.['userId'] === 'string' ? jobPayload['userId'] : undefined;
    const paperId =
      typeof jobPayload?.['paperId'] === 'string' ? jobPayload['paperId'] : undefined;
    if (!jobPayload) {
      await this.fail(jobId, 'QP_EXTRACT job has an empty payload');
      return;
    }
    if (!sourceHash) {
      await this.fail(jobId, 'QP_EXTRACT job is missing the sourceHash payload');
      return;
    }
    if (!userId) {
      await this.fail(jobId, 'QP_EXTRACT job is missing the requesting user');
      return;
    }

    await this.jobsService.updateJobStatus(jobId, 'processing');

    let blocks: ExtractionSourceBlock[];
    let source: 'TEXT' | 'OCR';

    if (jobPayload['kind'] === 'text') {
      const text = jobPayload['text'];
      if (typeof text !== 'string' || !text.trim()) {
        await this.fail(jobId, 'QP_EXTRACT text job has no text');
        return;
      }
      blocks = [{ id: 'raw', kind: 'other', content: text, page: 1 }];
      source = 'TEXT';
    } else if (jobPayload['kind'] === 'file') {
      const storageKey = jobPayload['storageKey'];
      const mimeType = jobPayload['mimeType'];
      if (typeof storageKey !== 'string' || typeof mimeType !== 'string') {
        await this.fail(jobId, 'QP_EXTRACT file job is missing the storage payload');
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
      // if question-paper volume grows.`
      const pages = await this.ocrPages(data, mimeType);
      blocks = pages.map((p) => ({
        id: `page-${p.page}`,
        kind: 'other',
        content: p.text,
        page: p.page,
      }));
      source = 'OCR';
      await this.storage.delete(storageKey).catch(() => undefined);
    } else {
      await this.fail(jobId, 'QP_EXTRACT job has an unknown kind');
      return;
    }

    // Best-effort paper info from the same deterministic header/rule parsing
    // the pattern extractor uses — never fatal if the source has no totals.
    let paperTotals: { durationMinutes: number | null; totalMarks: number | null } = {
      durationMinutes: null,
      totalMarks: null,
    };
    try {
      const pattern = extractPaperPattern(blocks);
      paperTotals = {
        durationMinutes: pattern.structure?.durationMinutes ?? null,
        totalMarks: pattern.structure?.totalMarks ?? null,
      };
    } catch {
      // keep defaults
    }

    const { questions: detected } = extractQuestions(blocks);

    // A re-swept job must not stack duplicate candidates or links for the same
    // run. Only REVIEW/EXTRACTED rows of THIS job are purged (the same guard
    // the material extraction uses), never accepted questions or manual links.
    const stale = await this.db
      .select({ id: questions.id })
      .from(questions)
      .where(
        and(
          eq(questions.instituteId, instituteId),
          eq(questions.status, 'REVIEW'),
          eq(questions.source, 'EXTRACTED'),
          sql`${questions.provenance}->>'jobId' = ${jobId}`,
          eq(questions.updatedBy, questions.createdBy),
        ),
      );
    const staleIds = stale.map((r) => r.id);
    if (staleIds.length > 0) {
      if (paperId) {
        await this.db
          .delete(questionPaperQuestions)
          .where(
            and(
              eq(questionPaperQuestions.paperId, paperId),
              inArray(questionPaperQuestions.questionId, staleIds),
            ),
          );
      }
      await this.db
        .delete(questions)
        .where(and(eq(questions.instituteId, instituteId), inArray(questions.id, staleIds)));
    }

    const rows: Array<{
      stem: string;
      questionType: string;
      answerFormat: string;
      difficulty: string;
      payload: Record<string, unknown>;
      provenance: QuestionExtractionProvenance;
      issues: QuestionExtractionIssue[];
      originalMarks: number | null;
      section: string | null;
    }> = [];
    for (const detectedQuestion of detected) {
      const type = await this.resolveType(instituteId, detectedQuestion);
      const provenance: QuestionExtractionProvenance = {
        operation: 'EXTRACT_QUESTIONS',
        jobId,
        ...(paperId ? { paperId } : {}),
        source,
        page: detectedQuestion.page,
        blockIds: detectedQuestion.blockIds,
        originalNumber: detectedQuestion.originalNumber,
        originalSection: detectedQuestion.section,
        originalMarks: detectedQuestion.originalMarks,
        issues: detectedQuestion.issues,
        extractedAt: new Date().toISOString(),
      };
      rows.push({
        stem: detectedQuestion.stem,
        questionType: type.code,
        answerFormat: type.answerFormat,
        difficulty: detectedQuestion.difficulty ?? 'MEDIUM',
        payload: detectedQuestion.payload,
        provenance,
        issues: detectedQuestion.issues,
        originalMarks: detectedQuestion.originalMarks,
        section: detectedQuestion.section,
      });
    }

    await this.db.transaction(async (tx) => {
      if (rows.length > 0) {
        const inserted = await tx
          .insert(questions)
          .values(
            rows.map((r) => ({
              instituteId,
              subjectId: null,
              chapterId: null,
              topicId: null,
              stem: r.stem,
              questionType: r.questionType,
              answerFormat: r.answerFormat,
              difficulty: r.difficulty,
              payload: r.payload,
              source: 'EXTRACTED',
              provenance: r.provenance,
              approvalStatus: 'PENDING',
              status: 'REVIEW',
              createdBy: userId,
              updatedBy: userId,
            })),
          )
          .returning({ id: questions.id });

        // Paper runs link each candidate into the paper; bank runs fill only
        // the Question Bank REVIEW tray.
        if (paperId) {
          await tx.insert(questionPaperQuestions).values(
            inserted.map((q, index) => ({
              paperId,
              questionId: q.id,
              sortOrder: index + 1,
              marks: rows[index]!.originalMarks ?? 1,
              section: rows[index]!.section ?? 'General',
            })),
          );
        }
      }

      if (paperId && (paperTotals.durationMinutes !== null || paperTotals.totalMarks !== null)) {
        await tx
          .update(questionPapers)
          .set({
            ...(paperTotals.durationMinutes !== null
              ? { durationMinutes: paperTotals.durationMinutes }
              : {}),
            ...(paperTotals.totalMarks !== null ? { maxMarks: paperTotals.totalMarks } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(questionPapers.id, paperId), eq(questionPapers.instituteId, instituteId)));
      }
    });

    const candidateCount = rows.length;
    const reviewRequiredCount = rows.filter((r) => r.issues.length > 0).length;
    const issueCount = rows.reduce((n, r) => n + r.issues.length, 0);

    await this.jobsService.updateJobStatus(jobId, 'completed', {
      status: candidateCount === 0 ? 'no-questions' : 'extracted',
      ...(paperId ? { paperId } : {}),
      source,
      candidateCount,
      reviewRequiredCount,
      issueCount,
      totalMarks: paperTotals.totalMarks,
      durationMinutes: paperTotals.durationMinutes,
    });
  }

  // ── Source resolution ─────────────────────────────────────────────

  /** Call the OCR service's per-page extraction endpoint. The result keeps
   *  real page numbers so PDF provenance survives into the questions. */
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

  private async resolveType(instituteId: string, detected: DetectedQuestion) {
    const fallback = async (format: string) => {
      const types = await this.types.list(instituteId);
      const match = types.find((t) => t.answerFormat === format);
      if (!match) {
        throw new BadRequestException(`No question type exists for answer format ${format}`);
      }
      return match;
    };
    try {
      const type = await this.types.findByCode(instituteId, detected.suggestedType);
      if (type.answerFormat === detected.format) return type;
      return fallback(detected.format);
    } catch {
      return fallback(detected.format);
    }
  }

  private async enqueue(
    instituteId: string,
    sourceHash: string,
    userId: string,
    payload: Record<string, unknown>,
    paperId?: string,
  ): Promise<ExtractionEnqueueResult> {
    // Reuse the QUEUED/processing run (or the completed one) that already
    // exists for the source in the same mode — never a duplicate resource.
    // A paper-mode reuse returns the existing paper; a bank-mode reuse returns
    // a linkless run (paperId absent).
    const reused = await this.reuseFor(instituteId, sourceHash, paperId);
    if (reused) {
      await this.dropStoredSource(payload);
      return reused;
    }

    // Paper mode is resource-first: create the empty Question Paper NOW — the
    // sweep fills it with extracted questions, so the teacher lands on a real
    // paper page (with live progress) the moment the request returns. Bank
    // mode has no resource to create; the sweep fills the REVIEW tray.
    if (paperId) {
      return this.enqueueIntoPaper(instituteId, userId, payload);
    }

    const job = await this.jobsService.insertJob(instituteId, TYPE, {
      ...payload,
      userId,
    });
    return { jobId: job.id, status: 'QUEUED', reused: false };
  }

  private async enqueueIntoPaper(
    instituteId: string,
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<ExtractionEnqueueResult> {
    const fileName = typeof payload['fileName'] === 'string' ? payload['fileName'] : undefined;
    const text = typeof payload['text'] === 'string' ? payload['text'] : undefined;
    const [paper] = await this.db
      .insert(questionPapers)
      .values({
        instituteId,
        title: titleFrom(fileName, text),
        description:
          payload['kind'] === 'file'
            ? `Extracting questions from "${fileName ?? 'uploaded source'}"…`
            : 'Extracted from pasted paper text',
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    const job = await this.jobsService.insertJob(instituteId, TYPE, {
      ...payload,
      userId,
      paperId: paper!.id,
    });
    return { jobId: job.id, status: 'QUEUED', reused: false, paperId: paper!.id };
  }

  /** Reuse the QUEUED/processing run (or the completed extraction) that
   *  already exists for a source in the same mode → never a duplicate
   *  resource. Paper runs need a paperId (a prior bank run of the same source
   *  must not short-circuit a paper extraction, and vice versa). */
  private async reuseFor(
    instituteId: string,
    sourceHash: string,
    paperId?: string,
  ): Promise<ExtractionEnqueueResult | null> {
    const sameMode = paperId
      ? sql`${jobs.payload}->>'paperId' IS NOT NULL`
      : sql`${jobs.payload}->>'paperId' IS NULL`;
    const [active] = await this.db
      .select({ id: jobs.id, paperId: sql<string | null>`${jobs.payload}->>'paperId'` })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          eq(jobs.instituteId, instituteId),
          sql`${jobs.status} IN ('queued', 'processing')`,
          sql`${jobs.payload}->>'sourceHash' = ${sourceHash}`,
          sameMode,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (active?.id) {
      return { jobId: active.id, status: 'QUEUED', reused: true, paperId: active.paperId ?? undefined };
    }
    const [completed] = await this.db
      .select({ id: jobs.id, paperId: sql<string | null>`${jobs.payload}->>'paperId'` })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          eq(jobs.instituteId, instituteId),
          eq(jobs.status, 'completed'),
          sql`${jobs.payload}->>'sourceHash' = ${sourceHash}`,
          sameMode,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (completed?.id) {
      return { jobId: completed.id, status: 'COMPLETED', reused: true, paperId: completed.paperId ?? undefined };
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
}

export interface ExtractionEnqueueResult {
  jobId: string;
  status: 'QUEUED' | 'COMPLETED';
  reused: boolean;
  /** Present in paper mode (an extraction always belongs to a question paper);
   *  absent in bank mode where candidates land in the Question Bank tray. */
  paperId?: string;
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

function titleFrom(fileName: string | undefined, text: string | undefined): string {
  if (fileName) {
    const base = fileName.replace(/\.[^.]+$/, '').trim();
    if (base) return base.slice(0, 255);
  }
  if (text) {
    const firstLine = text
      .split('\n')
      .map((l) => l.replace(/^[#*·•\-\d.\s]+/, '').trim())
      .find((l) => l.length > 0);
    if (firstLine) return firstLine.slice(0, 255);
  }
  return 'Extracted Question Paper';
}