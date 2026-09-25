// Question Extraction into Question Bank (Phase 47) — coordinator-owned jobs.
//
// Mirrors PaperPatternExtractionService: QUESTION_EXTRACT jobs are inserted by
// the API (POST /questions/extract-from-material), adopted by a sweep, and
// never published to RabbitMQ. The extraction itself is deterministic
// (question-extractor.ts), so it belongs in the API, not a worker.
//
// Candidates are stored directly in `questions` as status=REVIEW +
// source=EXTRACTED (provenance->>'jobId' scopes the run — no extra entity).
// Accepting a candidate validates the payload and flips it to ACTIVE/APPROVED,
// so imported questions behave like any ordinary bank question.
//
// Idempotency: the enqueue reuses an active job for the same material+subject;
// a completed run for the same (material, revision, subject) returns the
// existing review (no duplicates). A material revision change frees re-running.

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '@catlium/database';
import {
  jobs,
  materialEnhancements,
  materials,
  questionPapers,
  questions,
} from '@catlium/database';
import type {
  MaterialEnhancedBlock,
  QuestionExtractionIssue,
  QuestionExtractionProvenance,
  ReviewQuestionCandidate,
} from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';
import { AcademicScopeService } from '../authorization/academic-scope.service.js';
import { resolveScopeChain } from '../common/utils/scope-resolver.js';
import { segmentMatches, type SyllabusTarget } from '../material-enhancement/enhancer.js';
import { MaterialEnhancementService } from '../material-enhancement/enhancement.service.js';
import { extractQuestions, type DetectedQuestion, type ExtractionSourceBlock } from './question-extractor.js';
import { QuestionsService } from '../questions/questions.service.js';
import { QuestionTypesService } from '../questions/question-types.service.js';

const SWEEP_INTERVAL_MS = Number(process.env['WORKER_SWEEP_INTERVAL_MS'] ?? '15000') || 15000;
// `ponytail: fixed 60s lease; per-job leases only if multi-replica sweeps ever
// run concurrently.` Processing is seconds-fast and the material+revision
// reuse check makes reprocessing a no-op, so reclaiming an orphaned row is safe.
const EXTRACTION_LEASE_MS = 60_000;

const TYPE = 'QUESTION_EXTRACT';

// Autonomous answer generation (F3.2): the worker fills a REVIEW candidate's
// missing answer (extraction flagged ANSWER_MISSING) without a teacher writing
// it by hand. AI_GENERATE_ANSWER jobs are genuinely published to the
// `ai_generation` queue (unlike QUESTION_EXTRACT, which stays coordinator-owned).
const ANSWER_TYPE = 'AI_GENERATE_ANSWER';

export interface CandidateRow {
  id: string;
  stem: string;
  questionType: string;
  answerFormat: string | null;
  difficulty: string;
  explanation: string | null;
  payload: Record<string, unknown>;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
  approvalStatus: string;
  status: string;
  provenance: Record<string, unknown> | null;
}

@Injectable()
export class QuestionExtractionService implements OnApplicationBootstrap, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly logger = new Logger(QuestionExtractionService.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobsService: JobsService,
    private readonly enhancement: MaterialEnhancementService,
    private readonly types: QuestionTypesService,
    private readonly questionsService: QuestionsService,
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

  /** Guard + queue extraction. Idempotent: an active job for the material+
   *  subject is reused; a completed run for the same (material, revision,
   *  subject) returns the existing review directly (COMPLETED). */
  async requestExtraction(
    instituteId: string,
    membershipId: string,
    userId: string,
    input: { materialId: string; subjectId: string; chapterId?: string; topicId?: string },
  ): Promise<{ jobId: string; status: 'QUEUED' | 'COMPLETED'; reused: boolean }> {
    const material = await this.assertMaterial(instituteId, input.materialId);
    // Extraction only runs inside the actor's writable scope: the material and
    // the target subject both must be writable (§18.5).
    await this.scope.requireWritableSubject(instituteId, membershipId, material.subjectId);
    await this.scope.requireWritableSubject(instituteId, membershipId, input.subjectId);
    await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: true },
      { subjectId: input.subjectId, chapterId: input.chapterId, topicId: input.topicId },
    );

    // Reuse: a completed run exists for this material+revision+subject.
    const [existing] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          eq(jobs.instituteId, instituteId),
          eq(jobs.status, 'completed'),
          sql`${jobs.payload}->>'materialId' = ${material.id}`,
          sql`${jobs.payload}->>'subjectId' = ${input.subjectId}`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (existing) {
      const completed = await this.db
        .select({ revision: sql<number>`${jobs.result}->>'materialRevision'` })
        .from(jobs)
        .where(eq(jobs.id, existing.id))
        .limit(1);
      const revision = Number(completed[0]?.revision ?? -1);
      if (revision === material.revision) {
        return { jobId: existing.id, status: 'COMPLETED', reused: true };
      }
    }

    // Reuse: an active job is already draining this material+subject.
    const [active] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, TYPE),
          eq(jobs.instituteId, instituteId),
          sql`${jobs.status} IN ('queued', 'processing')`,
          sql`${jobs.payload}->>'materialId' = ${material.id}`,
          sql`${jobs.payload}->>'subjectId' = ${input.subjectId}`,
        ),
      )
      .limit(1);
    if (active) {
      return { jobId: active.id, status: 'QUEUED', reused: true };
    }

    const job = await this.jobsService.insertJob(
      instituteId,
      TYPE,
      { materialId: material.id, subjectId: input.subjectId, chapterId: input.chapterId ?? null, topicId: input.topicId ?? null },
      userId,
    );
    return { jobId: job.id, status: 'QUEUED', reused: false };
  }

  /** Status read for the polling flow. */
  async getExtraction(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
  ): Promise<Job> {
    await this.gateCandidateJob(instituteId, membershipId, userId, jobId);
    return this.jobsService.getJob(jobId, instituteId);
  }

  /** Guard + queue autonomous answer generation for one REVIEW candidate.
   *  Reuses an existing active or completed AI_GENERATE_ANSWER job for the same
   *  (institute, question) so a teacher-initiated trigger never duplicates the
   *  extraction sweep's automatic enqueue. A failed/cancelled job is never
   *  reused, so this doubles as the manual retry path. */
  async requestAnswerGeneration(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
    questionId: string,
  ): Promise<{ jobId: string; status: 'QUEUED' | 'COMPLETED'; reused: boolean }> {
    await this.gateCandidateJob(instituteId, membershipId, userId, jobId);
    await this.getCandidate(instituteId, jobId, questionId); // REVIEW + EXTRACTED + run match
    return this.enqueueAnswerGeneration(instituteId, userId, questionId);
  }

  /** Insert + publish an AI_GENERATE_ANSWER job for a candidate, reusing an
   *  existing active or completed job for the same (institute, question). */
  private async enqueueAnswerGeneration(
    instituteId: string,
    userId: string,
    questionId: string,
  ): Promise<{ jobId: string; status: 'QUEUED' | 'COMPLETED'; reused: boolean }> {
    const [existing] = await this.db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, ANSWER_TYPE),
          eq(jobs.instituteId, instituteId),
          sql`${jobs.payload}->'source'->>'type' = 'QUESTION'`,
          sql`${jobs.payload}->'source'->>'id' = ${questionId}`,
          inArray(jobs.status, ['queued', 'processing', 'completed']),
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (existing) {
      return {
        jobId: existing.id,
        status: existing.status === 'completed' ? 'COMPLETED' : 'QUEUED',
        reused: true,
      };
    }

    const job = await this.jobsService.issueJob(
      instituteId,
      ANSWER_TYPE,
      {
        operation: ANSWER_TYPE,
        source: { type: 'QUESTION', id: questionId },
        requestedBy: userId,
      },
      userId,
    );
    return { jobId: job.id, status: 'QUEUED', reused: false };
  }

  // ── Sweep (adopt queued QUESTION_EXTRACT jobs) ────────────────────

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
        await this.processJob(job.id, job.instituteId, job.payload, job.createdBy);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Extraction failed';
        await this.jobsService.updateJobStatus(job.id, 'failed', undefined, { message });
      }
    }
  }

  private async processJob(
    jobId: string,
    instituteId: string,
    payload: unknown,
    createdBy: string | null,
  ): Promise<void> {
    const data = payloadOf(payload);
    if (!data) {
      await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
        message: 'QUESTION_EXTRACT job is missing the payload',
      });
      return;
    }
    const materialId = data['materialId'];
    if (typeof materialId !== 'string') {
      await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
        message: 'QUESTION_EXTRACT job is missing the materialId payload',
      });
      return;
    }
    const subjectId = data['subjectId'];
    if (typeof subjectId !== 'string') {
      await this.jobsService.updateJobStatus(jobId, 'failed', undefined, {
        message: 'QUESTION_EXTRACT job is missing the subjectId payload',
      });
      return;
    }

    await this.jobsService.updateJobStatus(jobId, 'processing');

    const chain = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: true },
      {
        subjectId,
        chapterId: typeof data['chapterId'] === 'string' ? data['chapterId'] : undefined,
        topicId: typeof data['topicId'] === 'string' ? data['topicId'] : undefined,
      },
    );

    const [material] = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId), isNull(materials.deletedAt)))
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
    const resolvedSubjectId = chain.subjectId!;
    const targets = await this.enhancement.syllabusTargets(instituteId, resolvedSubjectId);
    const scopeConstraint = {
      subjectId: resolvedSubjectId,
      chapterId: chain.chapterId ?? undefined,
      topicId: chain.topicId ?? undefined,
    };

    const { questions: detected } = extractQuestions(blocks);

    // A re-swept job must not stack duplicate candidates for the same run.
    await this.db
      .delete(questions)
      .where(
        and(
          eq(questions.instituteId, instituteId),
          eq(questions.status, 'REVIEW'),
          eq(questions.source, 'EXTRACTED'),
          sql`${questions.provenance}->>'jobId' = ${jobId}`,
          eq(questions.updatedBy, questions.createdBy),
        ),
      );

    const rows = [];
    const unresolvedQuestions: Array<{ ref: string; format: string; error: string }> = [];
    for (const detectedQuestion of detected) {
      try {
        const { chapterId, topicId, issues: scopeIssues } = assignScope(
          detectedQuestion.matchText,
          targets,
          scopeConstraint,
        );
        const type = await this.resolveType(instituteId, detectedQuestion);
        const issues = [...detectedQuestion.issues, ...scopeIssues];
        const provenance: QuestionExtractionProvenance = {
          operation: 'EXTRACT_QUESTIONS',
          jobId,
          materialId,
          materialRevision: material.revision,
          subjectId: resolvedSubjectId,
          source,
          page: detectedQuestion.page,
          blockIds: detectedQuestion.blockIds,
          originalNumber: detectedQuestion.originalNumber,
          originalSection: detectedQuestion.section,
          originalMarks: detectedQuestion.originalMarks,
          issues,
          extractedAt: new Date().toISOString(),
        };
        rows.push({
          subjectId: resolvedSubjectId,
          chapterId: chapterId ?? null,
          topicId: topicId ?? null,
          stem: detectedQuestion.stem,
          questionType: type.code,
          answerFormat: type.answerFormat,
          difficulty: detectedQuestion.difficulty ?? 'MEDIUM',
          payload: detectedQuestion.payload,
          source: 'EXTRACTED',
          provenance,
          approvalStatus: 'PENDING',
          status: 'REVIEW',
          createdBy: createdBy ?? material.createdBy,
          updatedBy: createdBy ?? material.createdBy,
        });
      } catch (error) {
        unresolvedQuestions.push({
          ref: detectedQuestion.originalNumber ?? stemSnippet(detectedQuestion.stem),
          format: detectedQuestion.format,
          error: error instanceof Error ? error.message : 'Extraction failed',
        });
      }
    }

    const inserted: Array<{ id: string }> =
      rows.length > 0
        ? await this.db
            .insert(questions)
            .values(rows.map((r) => ({ instituteId, ...r })))
            .returning({ id: questions.id })
        : [];

    const candidateCount = rows.length;
    const reviewRequiredCount = rows.filter((r) => (r.provenance as QuestionExtractionProvenance).issues.length > 0).length;
    const issueCount = rows.reduce((n, r) => n + (r.provenance as QuestionExtractionProvenance).issues.length, 0);

    // Autonomous answer generation: any candidate whose answer was not
    // extractable (ANSWER_MISSING) gets an AI_GENERATE_ANSWER job enqueued so
    // the teacher does not have to write every objective answer by hand. A
    // failed enqueue never fails the extraction — the candidate stays REVIEW and
    // any teacher can retry via POST .../candidates/:questionId/generate-answer.
    let answerJobsEnqueued = 0;
    for (let i = 0; i < inserted.length; i += 1) {
      const issues = (rows[i]?.provenance as QuestionExtractionProvenance | undefined)?.issues ?? [];
      if (!issues.some((issue) => issue.code === 'ANSWER_MISSING')) continue;
      try {
        await this.enqueueAnswerGeneration(
          instituteId,
          rows[i]!.createdBy ?? material.createdBy,
          inserted[i]!.id,
        );
        answerJobsEnqueued += 1;
      } catch (error) {
        this.logger.warn(
          `Answer generation enqueue failed for candidate ${inserted[i]!.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    await this.jobsService.updateJobStatus(jobId, 'completed', {
      status: candidateCount === 0 ? 'no-questions' : 'extracted',
      candidateCount,
      reviewRequiredCount,
      issueCount,
      answerJobsEnqueued,
      ...(unresolvedQuestions.length > 0 ? { unresolvedQuestions } : {}),
      source,
      materialRevision: material.revision,
    });
  }

  // ── Review reads ─────────────────────────────────────────────────

  /** REVIEW candidates are staged work owned by the requesting teacher — O1:
   *  owner or institute admin. Subject-scope applies only when the run is
   *  subject-anchored (QUESTION_EXTRACT from a material); QP_EXTRACT runs carry
   *  no subjectId, so they gate on ownership alone (§18.7). */
  private async gateCandidateJob(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
  ): Promise<void> {
    const job = await this.jobsService.getJob(jobId, instituteId);
    const subjectId = String(job.payload?.['subjectId'] ?? '');
    if (subjectId) {
      await this.scope.requireWritableSubject(instituteId, membershipId, subjectId);
    }
    const scope = await this.scope.resolveScope(instituteId, membershipId);
    const owner = job.createdBy ?? undefined;
    if (scope.kind !== 'whole-institute' && owner !== undefined && owner !== userId) {
      throw new NotFoundException('Question extraction run not found');
    }
  }

  async listCandidates(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
  ): Promise<{
    meta: {
      jobId: string;
      status: string;
      materialId: string | null;
      materialTitle: string | null;
      paperId: string | null;
      paperTitle: string | null;
      subjectId: string | null;
      materialRevision: number | null;
      source: 'ENHANCEMENT' | 'TEXT' | 'OCR' | null;
      createdAt: Date;
      completedAt: Date | null;
    };
    candidates: CandidateRow[];
  }> {
    await this.gateCandidateJob(instituteId, membershipId, userId, jobId);
    const job = await this.jobsService.getJob(jobId, instituteId);
    const payload = job.payload ?? {};
    const materialId = String(payload['materialId'] ?? '');
    const paperId = String(payload['paperId'] ?? '');

    const [material] = materialId
      ? await this.db
          .select({ id: materials.id, title: materials.title })
          .from(materials)
          .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
          .limit(1)
      : [];

    const [paper] = paperId
      ? await this.db
          .select({ id: questionPapers.id, title: questionPapers.title })
          .from(questionPapers)
          .where(and(eq(questionPapers.id, paperId), eq(questionPapers.instituteId, instituteId)))
          .limit(1)
      : [];

    const rows = await this.db
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.instituteId, instituteId),
          eq(questions.status, 'REVIEW'),
          eq(questions.source, 'EXTRACTED'),
          sql`${questions.provenance}->>'jobId' = ${jobId}`,
          isNull(questions.deletedAt),
        ),
      )
      .orderBy(asc(questions.createdAt));

    const result = payloadOf(job.result) ?? {};
    return {
      meta: {
        jobId,
        status: job.status,
        materialId: materialId || null,
        materialTitle: material ? material.title : null,
        paperId: paperId || null,
        paperTitle: paper ? paper.title : null,
        subjectId: String(payload['subjectId'] ?? '') || null,
        materialRevision:
          typeof result['materialRevision'] === 'number' ? result['materialRevision'] : null,
        source:
          result['source'] === 'ENHANCEMENT' ||
          result['source'] === 'TEXT' ||
          result['source'] === 'OCR'
            ? result['source']
            : null,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
      candidates: rows.map(toCandidateRow),
    };
  }

  // ── Review actions ───────────────────────────────────────────────

  async updateCandidate(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
    questionId: string,
    patch: ReviewQuestionCandidate,
  ): Promise<CandidateRow> {
    await this.gateCandidateJob(instituteId, membershipId, userId, jobId);
    const candidate = await this.getCandidate(instituteId, jobId, questionId);

    let chapterId = candidate.chapterId;
    let topicId = candidate.topicId;
    if (patch.chapterId !== undefined || patch.topicId !== undefined) {
      chapterId = patch.chapterId === null ? null : (patch.chapterId ?? candidate.chapterId);
      topicId = patch.topicId === null ? null : (patch.topicId ?? candidate.topicId);
      const chain = await resolveScopeChain(
        { db: this.db, instituteId, requireSubject: true },
        {
          subjectId: candidate.subjectId ?? undefined,
          chapterId: chapterId ?? undefined,
          topicId: topicId ?? undefined,
        },
      );
      chapterId = chain.chapterId;
      topicId = chain.topicId;
    }

    let answerFormat = candidate.answerFormat;
    if (patch.questionType !== undefined && patch.questionType !== candidate.questionType) {
      answerFormat = (await this.types.findByCode(instituteId, patch.questionType)).answerFormat;
    }

    const [row] = await this.db
      .update(questions)
      .set({
        ...(patch.stem !== undefined ? { stem: patch.stem } : {}),
        ...(patch.questionType !== undefined ? { questionType: patch.questionType } : {}),
        ...(answerFormat !== undefined ? { answerFormat } : {}),
        ...(patch.difficulty !== undefined ? { difficulty: patch.difficulty } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
        ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
        ...(patch.chapterId !== undefined ? { chapterId } : {}),
        ...(patch.topicId !== undefined ? { topicId } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)))
      .returning();

    return toCandidateRow(row!);
  }

  async acceptCandidate(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
    questionId: string,
  ): Promise<CandidateRow> {
    await this.gateCandidateJob(instituteId, membershipId, userId, jobId);
    const candidate = await this.getCandidate(instituteId, jobId, questionId);

    const type = await this.types.findByCode(instituteId, candidate.questionType);
    this.questionsService.validateQuestionPayload(instituteId, type.code, candidate.payload);

    if (candidate.chapterId !== null || candidate.topicId !== null) {
      await resolveScopeChain(
        { db: this.db, instituteId, requireSubject: true },
        {
          subjectId: candidate.subjectId ?? undefined,
          chapterId: candidate.chapterId ?? undefined,
          topicId: candidate.topicId ?? undefined,
        },
      );
    }

    const [row] = await this.db
      .update(questions)
      .set({
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)))
      .returning();

    return toCandidateRow(row!);
  }

  /** Accept every remaining valid REVIEW candidate; invalid ones stay REVIEW
   *  with the reason reported so the teacher fixes them. */
  async importAll(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
  ): Promise<{ imported: number; skipped: Array<{ questionId: string; reason: string }> }> {
    const { candidates } = await this.listCandidates(instituteId, membershipId, userId, jobId);
    let imported = 0;
    const skipped: Array<{ questionId: string; reason: string }> = [];
    for (const c of candidates) {
      try {
        await this.acceptCandidate(instituteId, membershipId, userId, jobId, c.id);
        imported += 1;
      } catch (error) {
        const reason = error instanceof Error ? normalizeMessage(error.message) : 'Invalid question';
        skipped.push({ questionId: c.id, reason });
      }
    }
    return { imported, skipped };
  }

  async discardCandidate(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
    questionId: string,
  ): Promise<void> {
    await this.gateCandidateJob(instituteId, membershipId, userId, jobId);
    await this.getCandidate(instituteId, jobId, questionId);
    await this.db
      .delete(questions)
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)));
  }

  async discardAll(
    instituteId: string,
    membershipId: string,
    userId: string,
    jobId: string,
  ): Promise<{ discarded: number }> {
    const { candidates } = await this.listCandidates(instituteId, membershipId, userId, jobId);
    const ids = candidates.map((c) => c.id);
    if (ids.length > 0) {
      await this.db
        .delete(questions)
        .where(and(eq(questions.instituteId, instituteId), inArray(questions.id, ids)));
    }
    return { discarded: ids.length };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async getCandidate(instituteId: string, jobId: string, questionId: string) {
    const [row] = await this.db
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.id, questionId),
          eq(questions.instituteId, instituteId),
          eq(questions.status, 'REVIEW'),
          eq(questions.source, 'EXTRACTED'),
          sql`${questions.provenance}->>'jobId' = ${jobId}`,
          isNull(questions.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Question extraction candidate not found');
    return toCandidateRow(row);
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

  async assertMaterial(instituteId: string, materialId: string) {
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

  /** Extraction input — line-based, so the canonical raw text (real line
   *  breaks preserved) always wins. Enhanced paragraphs collapse consecutive
   *  lines into one flow, which breaks numbered-question scanning; enhancement
   *  segments are only a fallback when text content is missing. */
  private async extractionBlocks(
    materialId: string,
    materialRevision: number,
    textContent: string | null,
  ): Promise<{ blocks: ExtractionSourceBlock[]; source: 'ENHANCEMENT' | 'TEXT' }> {
    if (textContent) {
      return {
        blocks: [{ id: 'raw', kind: 'other', content: textContent, page: 1 }],
        source: 'TEXT',
      };
    }

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
    throw new Error('Material has no processable text or enhancement to extract from');
  }
}

/** Deterministic per-question scope resolution against the selected subject's
 *  syllabus targets. The selected subject is mandatory; a Chapter/Topic is
 *  assigned only when the question text confidently overlaps one target —
 *  never forced, never outside the subject. */
function assignScope(
  matchText: string,
  targets: SyllabusTarget[],
  constraint: { subjectId: string; chapterId?: string; topicId?: string },
): { chapterId: string | null; topicId: string | null; issues: QuestionExtractionIssue[] } {
  const scoped = targets.filter(
    (t) =>
      t.subjectId === constraint.subjectId &&
      (constraint.topicId
        ? t.topicId === constraint.topicId
        : constraint.chapterId
          ? t.chapterId === constraint.chapterId
          : true),
  );

  let bestTopic: { target: SyllabusTarget; strong: boolean } | null = null;
  let bestChapter: { target: SyllabusTarget; strong: boolean } | null = null;
  let anyHit = false;
  for (const t of scoped) {
    if (t.type !== 'topic' && t.type !== 'chapter' && t.type !== 'unit') continue;
    const m = segmentMatches(t, matchText);
    if (m.hits === 0) continue;
    anyHit = true;
    const strong = m.sigLen === 1 ? m.hits === 1 : m.hits >= 2 && m.ratio >= 0.5;
    if (t.type === 'topic' && (!bestTopic || (strong && !bestTopic.strong))) {
      bestTopic = { target: t, strong };
    } else if (t.type === 'chapter' && (!bestChapter || (strong && !bestChapter.strong))) {
      bestChapter = { target: t, strong };
    }
  }

  if (bestTopic) {
    return {
      chapterId: bestTopic.target.chapterId,
      topicId: bestTopic.target.topicId,
      issues: bestTopic.strong ? [] : [scopeIssue('SCOPE_UNCERTAIN', bestTopic.target)],
    };
  }
  if (bestChapter) {
    return {
      chapterId: bestChapter.target.chapterId,
      topicId: null,
      issues: bestChapter.strong ? [] : [scopeIssue('SCOPE_UNCERTAIN', bestChapter.target)],
    };
  }
  if (anyHit) {
    return {
      chapterId: null,
      topicId: null,
      issues: [
        {
          code: 'SCOPE_UNCERTAIN',
          message:
            'Only a weak syllabus overlap was found — question stays subject-only; review the scope.',
        },
      ],
    };
  }
  return {
    chapterId: null,
    topicId: null,
    issues: [
      {
        code: 'SCOPE_UNMAPPED',
        message: 'No syllabus target matched the question text — review the scope.',
      },
    ],
  };
}

function scopeIssue(
  code: 'SCOPE_UNCERTAIN',
  target: SyllabusTarget,
): QuestionExtractionIssue {
  return {
    code,
    message:
      code === 'SCOPE_UNCERTAIN'
        ? `Weak overlap with ${target.type} "${target.title}" — review the scope assignment.`
        : 'Ambiguous syllabus context — review the scope assignment.',
  };
}

function toCandidateRow(row: typeof questions.$inferSelect): CandidateRow {
  return {
    id: row.id,
    stem: row.stem,
    questionType: row.questionType,
    answerFormat: row.answerFormat,
    difficulty: row.difficulty,
    explanation: row.explanation,
    payload: row.payload as Record<string, unknown>,
    subjectId: row.subjectId,
    chapterId: row.chapterId,
    topicId: row.topicId,
    approvalStatus: row.approvalStatus,
    status: row.status,
    provenance: row.provenance as Record<string, unknown> | null,
  };
}

function payloadOf(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

function normalizeMessage(message: string): string {
  return message.replace(/^Bad Request Exception:? ?|^Not Found Exception:? ?/i, '').trim();
}

/** Compact first-line snippet of a question stem, for unresolved-question refs. */
function stemSnippet(stem: string): string {
  const line = stem.split('\n').find((l) => l.trim().length > 0) ?? stem;
  return line.trim().slice(0, 60);
}