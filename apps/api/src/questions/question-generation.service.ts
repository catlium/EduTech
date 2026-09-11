import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { eq, and, sql, type SQL } from 'drizzle-orm';
import { topics, chapters, subjects, paperPatterns, questions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';

const OPERATION = 'AI_GENERATE_QUESTIONS';

type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'FILL_IN_BLANK';
type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

interface GenerateQuestionsInput {
  topicId: string;
  questionType: QuestionType;
  count: number;
  difficulty?: QuestionDifficulty;
  blueprintId?: string;
}

export interface BankBucket {
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  count: number;
}

export interface BucketStatus {
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  requested: number;
  existing: number;
  deficit: number;
}

@Injectable()
export class QuestionGenerationService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
  ) {}

  // ── Legacy single-type generation (backward compatible) ────────────

  async requestGeneration(
    instituteId: string,
    userId: string,
    input: GenerateQuestionsInput,
  ) {
    const topic = await this.assertTopicInInstitute(instituteId, input.topicId);

    const payload: Record<string, unknown> = {
      operation: OPERATION,
      source: { type: 'TOPIC', id: input.topicId },
      requestedBy: userId,
      params: {
        questionType: input.questionType,
        count: input.count,
        difficulty: input.difficulty ?? 'MEDIUM',
      },
    };

    // Blueprint-constrained generation: the approved pattern's structure is
    // attached to the job so the worker can target it and report satisfaction.
    if (input.blueprintId) {
      const [pattern] = await this.db
        .select()
        .from(paperPatterns)
        .where(
          and(
            eq(paperPatterns.id, input.blueprintId),
            eq(paperPatterns.instituteId, instituteId),
          ),
        )
        .limit(1);
      if (!pattern || pattern.status !== 'APPROVED') {
        throw new BadRequestException(
          'Blueprint must be an approved paper pattern in this institute',
        );
      }
      if (topic.subjectId !== pattern.subjectId) {
        throw new BadRequestException(
          'Blueprint subject must match the generation topic subject',
        );
      }
      payload['params'] = {
        ...(payload['params'] as Record<string, unknown>),
        blueprint: { patternId: pattern.id, structure: pattern.structure },
      };
    }

    // Same partial-unique-index + isUniqueViolation -> 409 pattern as content
    // generation: only one active AI_GENERATE_QUESTIONS job per topic.
    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, OPERATION, payload);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A generation is already in progress for this source');
      }
      throw error;
    }

    try {
      await this.jobs.publishJob(job);
    } catch {
      await this.jobs.updateJobStatus(job.id, 'failed', undefined, {
        message: 'Failed to enqueue generation job',
      });
      throw new InternalServerErrorException('Failed to enqueue generation job');
    }

    return {
      jobId: job.id,
      operation: OPERATION,
      sourceType: 'TOPIC',
      sourceId: input.topicId,
      status: 'QUEUED' as const,
    };
  }

  async getGenerationJob(instituteId: string, jobId: string): Promise<Job> {
    const job = await this.jobs.getJob(jobId, instituteId);
    if (job.type !== OPERATION) {
      throw new BadRequestException('This job is not a question-generation job');
    }
    return job;
  }

  // ── Bank generation ────────────────────────────────────────────────

  async requestBankGeneration(
    instituteId: string,
    userId: string,
    input: {
      subjectId?: string;
      chapterId?: string;
      topicId?: string;
      questionTypes?: QuestionType[];
      count: number;
      difficultyDistribution?: Record<QuestionDifficulty, number>;
      blueprintId?: string;
    },
    buckets: BankBucket[],
  ) {
    const scope = await this.resolveScopeOrThrow(instituteId, input);

    // Build worker payload
    const workerSource = this.scopeToWorkerSource(scope);
    const payload: Record<string, unknown> = {
      operation: OPERATION,
      source: workerSource,
      requestedBy: userId,
      params: {
        buckets: buckets.map((b) => ({
          questionType: b.questionType,
          difficulty: b.difficulty,
          count: b.count,
        })),
      },
    };

    // Attach blueprint if provided (for satisfaction report only).
    if (input.blueprintId) {
      const [pattern] = await this.db
        .select()
        .from(paperPatterns)
        .where(
          and(
            eq(paperPatterns.id, input.blueprintId),
            eq(paperPatterns.instituteId, instituteId),
          ),
        )
        .limit(1);
      if (pattern?.status === 'APPROVED') {
        payload.params = {
          ...(payload.params as Record<string, unknown>),
          blueprint: { patternId: pattern.id, structure: pattern.structure },
        };
      }
    }

    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, OPERATION, payload);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A generation is already in progress for this source');
      }
      throw error;
    }

    try {
      await this.jobs.publishJob(job);
    } catch {
      await this.jobs.updateJobStatus(job.id, 'failed', undefined, {
        message: 'Failed to enqueue generation job',
      });
      throw new InternalServerErrorException('Failed to enqueue generation job');
    }

    return {
      jobId: job.id,
      operation: OPERATION,
      sourceType: workerSource.type,
      sourceId: workerSource.id,
      status: 'QUEUED' as const,
      buckets,
    };
  }

  // ── Bank stats ─────────────────────────────────────────────────────

  async getBankStats(
    instituteId: string,
    scope: { subjectId?: string; chapterId?: string; topicId?: string },
  ) {
    const conditions: SQL[] = [eq(questions.instituteId, instituteId)];
    if (scope.subjectId) conditions.push(eq(questions.subjectId, scope.subjectId));
    if (scope.chapterId) conditions.push(eq(questions.chapterId, scope.chapterId));
    if (scope.topicId) conditions.push(eq(questions.topicId, scope.topicId));

    const where = and(...conditions);

    const rows = await this.db
      .select({
        questionType: questions.questionType,
        difficulty: questions.difficulty,
        approvalStatus: questions.approvalStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(questions)
      .where(where)
      .groupBy(questions.questionType, questions.difficulty, questions.approvalStatus);

    const byType: Record<QuestionType, number> = { MCQ: 0, TRUE_FALSE: 0, FILL_IN_BLANK: 0 };
    const byDifficulty: Record<QuestionDifficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
    const byApproval: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    let total = 0;
    let usable = 0;

    for (const row of rows) {
      const qt = row.questionType as QuestionType;
      const diff = row.difficulty as QuestionDifficulty;
      const app = row.approvalStatus;
      total += row.count;
      if (byType[qt] !== undefined) byType[qt] += row.count;
      if (byDifficulty[diff] !== undefined) byDifficulty[diff] += row.count;
      if (byApproval[app] !== undefined) byApproval[app] += row.count;
      if (app === 'APPROVED') usable += row.count;
    }

    return { total, usable, byType, byDifficulty, byApproval };
  }

  // ── Generate more (deficit computation + optional queue) ────────────

  async computeDeficitsAndGenerateMore(
    instituteId: string,
    userId: string,
    input: {
      subjectId?: string;
      chapterId?: string;
      topicId?: string;
      buckets: BankBucket[];
      dryRun?: boolean;
    },
  ) {
    const scope = await this.resolveScopeOrThrow(instituteId, input);

    // Count existing approved+active questions per bucket
    const existingCounts = await this.countApprovedQuestions(
      instituteId,
      scope,
      input.buckets,
    );

    const bucketStatuses: BucketStatus[] = input.buckets.map((b) => {
      const key = `${b.questionType}|${b.difficulty}`;
      const existing = existingCounts.get(key) ?? 0;
      return {
        questionType: b.questionType,
        difficulty: b.difficulty,
        requested: b.count,
        existing,
        deficit: Math.max(0, b.count - existing),
      };
    });

    const totalExisting = bucketStatuses.reduce((sum, b) => sum + b.existing, 0);
    const totalDeficit = bucketStatuses.reduce((sum, b) => sum + b.deficit, 0);

    if (totalDeficit === 0 || input.dryRun) {
      return {
        generated: false,
        jobId: null,
        status: 'NO_ACTION' as const,
        buckets: bucketStatuses,
        totalExisting,
        totalDeficit,
      };
    }

    // Queue a bank generation for the deficit buckets only
    const deficitBuckets = input.buckets
      .map((b, i) => ({ ...b, deficit: bucketStatuses[i]!.deficit }))
      .filter((b) => b.deficit > 0)
      .map((b) => ({ ...b, count: b.deficit }));

    const generation = await this.requestBankGeneration(instituteId, userId, {
      ...input,
      count: deficitBuckets.reduce((sum, b) => sum + b.count, 0),
    }, deficitBuckets);

    return {
      generated: true,
      jobId: generation.jobId,
      status: 'QUEUED' as const,
      buckets: bucketStatuses,
      totalExisting,
      totalDeficit,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private async resolveScopeOrThrow(
    instituteId: string,
    input: { subjectId?: string; chapterId?: string; topicId?: string },
  ): Promise<{ kind: 'subject' | 'chapter' | 'topic'; id: string }> {
    const provided: Array<{ kind: 'subject' | 'chapter' | 'topic'; id: string }> = [
      input.subjectId ? { kind: 'subject' as const, id: input.subjectId } : null,
      input.chapterId ? { kind: 'chapter' as const, id: input.chapterId } : null,
      input.topicId ? { kind: 'topic' as const, id: input.topicId } : null,
    ].filter((x): x is { kind: 'subject' | 'chapter' | 'topic'; id: string } => x !== null);

    if (provided.length !== 1) {
      throw new BadRequestException('Exactly one of subjectId, chapterId, topicId must be provided');
    }
    const scope = provided[0]!;
    await this.assertScopeInInstitute(instituteId, scope);
    return scope;
  }

  private async assertTopicInInstitute(
    instituteId: string,
    topicId: string,
  ): Promise<{ topicId: string; subjectId: string }> {
    const [row] = await this.db
      .select({ topicId: topics.id, subjectId: subjects.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, topicId), eq(subjects.instituteId, instituteId)))
      .limit(1);

    if (!row) throw new NotFoundException('Topic not found');
    return row;
  }

  private async assertScopeInInstitute(
    instituteId: string,
    scope: { kind: 'subject' | 'chapter' | 'topic'; id: string },
  ): Promise<void> {
    if (scope.kind === 'topic') {
      await this.assertTopicInInstitute(instituteId, scope.id);
      return;
    }
    if (scope.kind === 'subject') {
      const [row] = await this.db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.id, scope.id), eq(subjects.instituteId, instituteId)))
        .limit(1);
      if (!row) throw new NotFoundException('Subject not found');
      return;
    }
    const [row] = await this.db
      .select({ id: chapters.id })
      .from(chapters)
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(chapters.id, scope.id), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Chapter not found');
  }

  private scopeToWorkerSource(
    scope: { kind: 'subject' | 'chapter' | 'topic'; id: string },
  ): { type: string; id: string } {
    const typeMap = { subject: 'SUBJECT', chapter: 'CHAPTER', topic: 'TOPIC' } as const;
    return { type: typeMap[scope.kind], id: scope.id };
  }

  private async countApprovedQuestions(
    instituteId: string,
    scope: { kind: 'subject' | 'chapter' | 'topic'; id: string },
    buckets: BankBucket[],
  ): Promise<Map<string, number>> {
    const conditions: SQL[] = [
      eq(questions.instituteId, instituteId),
      eq(questions.approvalStatus, 'APPROVED'),
      eq(questions.status, 'ACTIVE'),
    ];

    if (scope.kind === 'subject') conditions.push(eq(questions.subjectId, scope.id));
    else if (scope.kind === 'chapter') conditions.push(eq(questions.chapterId, scope.id));
    else conditions.push(eq(questions.topicId, scope.id));

    const types = [...new Set(buckets.map((b) => b.questionType))];
    const diffs = [...new Set(buckets.map((b) => b.difficulty))];

    const rows = await this.db
      .select({
        questionType: questions.questionType,
        difficulty: questions.difficulty,
        count: sql<number>`count(*)::int`,
      })
      .from(questions)
      .where(and(...conditions, sql`${questions.questionType} IN (${sql.join(types.map((t) => sql`${t}`), sql`,`)})`, sql`${questions.difficulty} IN (${sql.join(diffs.map((d) => sql`${d}`), sql`,`)})`))
      .groupBy(questions.questionType, questions.difficulty);

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(`${row.questionType}|${row.difficulty}`, row.count);
    }
    return map;
  }
}
