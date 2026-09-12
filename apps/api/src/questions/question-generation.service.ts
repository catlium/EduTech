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
import { QuestionTypesService } from './question-types.service.js';
import { buildBucketsFromBlueprint } from './build-bank-buckets.js';

const OPERATION = 'AI_GENERATE_QUESTIONS';

type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

interface GenerateQuestionsInput {
  topicId: string;
  questionType: string;
  count: number;
  difficulty?: QuestionDifficulty;
  blueprintId?: string;
}

export interface BankBucket {
  questionType: string;
  difficulty: QuestionDifficulty;
  count: number;
}

export interface BucketStatus {
  questionType: string;
  difficulty: QuestionDifficulty;
  requested: number;
  existing: number;
  pending: number;
  deficit: number;
}

@Injectable()
export class QuestionGenerationService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
    private readonly typesService: QuestionTypesService,
  ) {}

  // ── Legacy single-type generation (backward compatible) ────────────

  async requestGeneration(
    instituteId: string,
    userId: string,
    input: GenerateQuestionsInput,
  ) {
    const topic = await this.assertTopicInInstitute(instituteId, input.topicId);

    const typeFormats = await this.resolveTypeFormats(instituteId, [input.questionType]);

    const payload: Record<string, unknown> = {
      operation: OPERATION,
      source: { type: 'TOPIC', id: input.topicId },
      requestedBy: userId,
      params: {
        questionType: input.questionType,
        count: input.count,
        difficulty: input.difficulty ?? 'MEDIUM',
        types: typeFormats,
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
      questionTypes?: string[];
      count: number;
      difficultyDistribution?: Record<QuestionDifficulty, number>;
      blueprintId?: string;
    },
    buckets: BankBucket[],
  ) {
    const scope = await this.resolveScopeOrThrow(instituteId, input);

    const typeFormats = await this.resolveTypeFormats(
      instituteId,
      buckets.map((b) => b.questionType),
    );

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
        types: typeFormats,
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

  // ── Blueprint-driven bank generation ────────────────────────────────

  async getApprovedPattern(
    instituteId: string,
    blueprintId: string,
  ): Promise<{ id: string; subjectId: string; structure: Record<string, unknown> }> {
    const [pattern] = await this.db
      .select()
      .from(paperPatterns)
      .where(and(eq(paperPatterns.id, blueprintId), eq(paperPatterns.instituteId, instituteId)))
      .limit(1);
    if (!pattern) throw new NotFoundException('Paper pattern not found');
    if (pattern.status !== 'APPROVED') {
      throw new BadRequestException('Blueprint must be an approved paper pattern');
    }
    if (!pattern.structure) {
      throw new BadRequestException('Blueprint has no structure to generate from');
    }
    return {
      id: pattern.id,
      subjectId: pattern.subjectId,
      structure: pattern.structure as Record<string, unknown>,
    };
  }

  async generateFromBlueprint(
    instituteId: string,
    userId: string,
    input: { blueprintId: string; subjectId?: string; chapterId?: string; topicId?: string },
  ) {
    const pattern = await this.getApprovedPattern(instituteId, input.blueprintId);
    const scope = await this.resolveScopeOrThrow(instituteId, input);
    const scopeSubjectId = await this.scopeSubjectId(instituteId, scope);
    if (scopeSubjectId !== pattern.subjectId) {
      throw new BadRequestException('Blueprint subject must match the generation scope subject');
    }

    const sections = Array.isArray(pattern.structure['sections'])
      ? (pattern.structure as { sections: unknown[] }).sections
      : [];
    const buckets = buildBucketsFromBlueprint(sections as Parameters<typeof buildBucketsFromBlueprint>[0]);
    if (buckets.length === 0) {
      throw new BadRequestException(
        'Blueprint has no section with a concrete question type and count to generate',
      );
    }

    return this.requestBankGeneration(
      instituteId,
      userId,
      {
        subjectId: input.subjectId,
        chapterId: input.chapterId,
        topicId: input.topicId,
        count: buckets.reduce((sum, b) => sum + b.count, 0),
        blueprintId: pattern.id,
      },
      buckets,
    );
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

    const byType: Record<string, number> = {};
    const byDifficulty: Record<QuestionDifficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
    const byApproval: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    let total = 0;
    let usable = 0;

    for (const row of rows) {
      const diff = row.difficulty as QuestionDifficulty;
      const app = row.approvalStatus;
      total += row.count;
      byType[row.questionType] = (byType[row.questionType] ?? 0) + row.count;
      if (byDifficulty[diff] !== undefined) byDifficulty[diff] += row.count;
      if (byApproval[app] !== undefined) byApproval[app] += row.count;
      if (app === 'APPROVED') usable += row.count;
    }

    return { total, usable, byType, byDifficulty, byApproval };
  }

  // ── Derive a question-type/difficulty distribution from existing resources ──

  /** Build a proposed (type × difficulty) distribution for a target count by
   * weighing existing bank questions in scope AND approved paper patterns for
   * the scope's subject. Purely deterministic — no LLM, output shown to the
   * teacher before generation so they can tweak it. */
  async deriveDistribution(
    instituteId: string,
    scope: { subjectId?: string; chapterId?: string; topicId?: string },
    count: number,
  ) {
    const resolved = await this.resolveScopeOrThrow(instituteId, scope);
    const subjectId = await this.scopeSubjectId(instituteId, resolved);

    const signals = new Map<string, number>(); // `${type}|${difficulty}`
    const sources: string[] = [];

    // Signal 1: existing bank questions in scope.
    const existingCounts = await this.db
      .select({
        questionType: questions.questionType,
        difficulty: questions.difficulty,
        value: sql<number>`count(*)::int`,
      })
      .from(questions)
      .where(
        and(
          eq(questions.instituteId, instituteId),
          eq(questions.approvalStatus, 'APPROVED'),
          eq(questions.status, 'ACTIVE'),
          resolved.kind === 'subject'
            ? eq(questions.subjectId, resolved.id)
            : resolved.kind === 'chapter'
              ? eq(questions.chapterId, resolved.id)
              : eq(questions.topicId, resolved.id),
        ),
      )
      .groupBy(questions.questionType, questions.difficulty);

    for (const row of existingCounts) {
      const key = `${row.questionType}|${row.difficulty}`;
      signals.set(key, (signals.get(key) ?? 0) + row.value);
    }
    if (existingCounts.length > 0) sources.push(`existing question bank (${existingCounts.length} type/difficulty groups)`);

    // Signal 2: approved paper patterns on the scope subject.
    const patterns = await this.db
      .select()
      .from(paperPatterns)
      .where(
        and(
          eq(paperPatterns.instituteId, instituteId),
          eq(paperPatterns.subjectId, subjectId),
          eq(paperPatterns.status, 'APPROVED'),
        ),
      );

    for (const pattern of patterns) {
      const sections = Array.isArray((pattern.structure as Record<string, unknown> | null)?.['sections'])
        ? (pattern.structure as { sections: Array<Record<string, unknown>> }).sections
        : [];
      let added = 0;
      for (const section of sections) {
        const type = section['questionType'];
        const qCount = section['count'];
        if (typeof type !== 'string' || typeof qCount !== 'number' || !(qCount > 0)) continue;
        const diffDist = section['difficultyDistribution'] as
          | Record<string, number>
          | undefined;
        if (diffDist && typeof diffDist === 'object') {
          for (const diff of ['EASY', 'MEDIUM', 'HARD'] as const) {
            const pct = diffDist[diff];
            if (typeof pct === 'number' && pct > 0) {
              const key = `${type}|${diff}`;
              signals.set(key, (signals.get(key) ?? 0) + (qCount * pct) / 100);
              added += 1;
            }
          }
        } else {
          for (const diff of ['EASY', 'MEDIUM', 'HARD'] as const) {
            const key = `${type}|${diff}`;
            signals.set(key, (signals.get(key) ?? 0) + qCount / 3);
            added += 1;
          }
        }
      }
      if (added > 0) sources.push(`paper pattern '${pattern.title}'`); // ponytail: pattern.weight we use question count directly
    }

    // No signal at all → neutral starter proposal the teacher can edit.
    if (signals.size === 0) {
      return {
        sources: [],
        count,
        distribution: [
          { questionType: 'MCQ', difficulty: 'EASY', percentage: 0 },
          { questionType: 'MCQ', difficulty: 'MEDIUM', percentage: 30 },
          { questionType: 'MCQ', difficulty: 'HARD', percentage: 0 },
          { questionType: 'SHORT_ANSWER', difficulty: 'MEDIUM', percentage: 30 },
          { questionType: 'LONG_ANSWER', difficulty: 'MEDIUM', percentage: 40 },
        ],
        buckets: [
          { questionType: 'MCQ', difficulty: 'MEDIUM', count: Math.round(count * 0.3) },
          { questionType: 'SHORT_ANSWER', difficulty: 'MEDIUM', count: Math.round(count * 0.3) },
          { questionType: 'LONG_ANSWER', difficulty: 'MEDIUM', count: Math.min(count, Math.max(1, Math.round(count * 0.4))) },
        ],
      };
    }

    const totalSignal = [...signals.values()].reduce((a, b) => a + b, 0);

    // Targeted allocation across the derived combos (largest remainder).
    const combos = [...signals.entries()].sort((a, b) => b[1] - a[1]);
    const raw = combos.map(([key, weight]) => {
      const [questionType, difficulty] = key.split('|');
      return {
        questionType: questionType!,
        difficulty: difficulty as QuestionDifficulty,
        exact: (count * weight) / totalSignal,
      };
    });

    const floors = raw.map((r) => ({ ...r, floor: Math.floor(r.exact) }));
    const remainder = count - floors.reduce((a, r) => a + r.floor, 0);
    floors
      .sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor))
      .forEach((r, i) => {
        if (i < remainder) r.floor += 1;
      });

    const buckets = floors
      .filter((r) => r.floor > 0)
      .map((r) => ({ questionType: r.questionType, difficulty: r.difficulty, count: r.floor }));

    const distribution = buckets.map((b) => ({
      questionType: b.questionType,
      difficulty: b.difficulty,
      percentage: Math.round((b.count / count) * 100),
    }));

    return { sources, count, distribution, buckets };
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
    // Count pending (generated, awaiting approval) so the UI can warn about
    // outstanding work instead of re-generating duplicates.
    const pendingCounts = await this.countPendingQuestions(
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
        pending: pendingCounts.get(key) ?? 0,
        deficit: Math.max(0, b.count - existing - (pendingCounts.get(key) ?? 0)),
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

  /** Validate each question-type code against the type table (global or
   * institute-scoped) and return the worker answer-format map, so generation
   * can emit ANY type — predefined or custom — by its configuration. */
  private async resolveTypeFormats(
    instituteId: string,
    codes: string[],
  ): Promise<Record<string, string>> {
    const formats: Record<string, string> = {};
    for (const code of new Set(codes)) {
      const type = await this.typesService.findByCode(instituteId, code);
      formats[code] = type.answerFormat;
    }
    return formats;
  }

  /** Resolve the subject a scope belongs to (for e.g. blueprint subject checks). */
  private async scopeSubjectId(
    instituteId: string,
    scope: { kind: 'subject' | 'chapter' | 'topic'; id: string },
  ): Promise<string> {
    if (scope.kind === 'subject') return scope.id;
    if (scope.kind === 'chapter') {
      const [row] = await this.db
        .select({ subjectId: subjects.id })
        .from(chapters)
        .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
        .where(and(eq(chapters.id, scope.id), eq(subjects.instituteId, instituteId)))
        .limit(1);
      if (!row) throw new NotFoundException('Chapter not found');
      return row.subjectId;
    }
    return (await this.assertTopicInInstitute(instituteId, scope.id)).subjectId;
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

  /** Same grouping as countApprovedQuestions but for PENDING questions. */
  private async countPendingQuestions(
    instituteId: string,
    scope: { kind: 'subject' | 'chapter' | 'topic'; id: string },
    buckets: BankBucket[],
  ): Promise<Map<string, number>> {
    const conditions: SQL[] = [
      eq(questions.instituteId, instituteId),
      eq(questions.approvalStatus, 'PENDING'),
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
