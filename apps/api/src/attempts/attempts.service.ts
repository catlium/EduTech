import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import {
  assessments,
  assessmentQuestions,
  questions,
  attempts,
  attemptQuestions,
  attemptResponses,
  topics,
  users,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import { gradeAnswer } from './attempts.grade.js';
import { buildAnalytics } from './analytics.js';

const ATTEMPTABLE_STATUSES = ['PUBLISHED', 'ACTIVE'] as const;
type AttemptRow = typeof attempts.$inferSelect;

// db or a transaction handle — both expose the same query builders.
type Queryable = Pick<Database, 'select' | 'update' | 'insert'>;

function isUuid(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}

@Injectable()
export class AttemptsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // ── Shared helpers ─────────────────────────

  /**
   * Student-safe projection of a question payload: drops the answer-bearing
   * field(s) of every question type. Single sanitization point for all
   * student-facing attempt endpoints.
   */
  private sanitizePayload(payload: unknown, questionType: string): Record<string, unknown> {
    if (questionType === 'MCQ') {
      return { choices: ((payload as { choices?: unknown })['choices'] ?? []) as unknown };
    }
    return {};
  }

  private validateAnswer(questionType: string, payload: unknown, answer: unknown): void {
    if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
      throw new BadRequestException('Answer must be an object');
    }
    const a = answer as Record<string, unknown>;
    if (questionType === 'MCQ') {
      const choiceId = a['choiceId'];
      if (!isUuid(choiceId)) {
        throw new BadRequestException('MCQ answer must include a choiceId');
      }
      const choices = ((payload as { choices?: Array<{ id?: string }> })['choices'] ?? []) as Array<{
        id?: string;
      }>;
      if (!choices.some((c) => c.id === choiceId)) {
        throw new BadRequestException('choiceId is not a valid choice for this question');
      }
    } else if (questionType === 'TRUE_FALSE') {
      if (typeof a['value'] !== 'boolean') {
        throw new BadRequestException('TRUE_FALSE answer must be a boolean value');
      }
    } else if (questionType === 'FILL_IN_BLANK') {
      if (typeof a['value'] !== 'string' || a['value'].length === 0 || a['value'].length > 500) {
        throw new BadRequestException('FILL_IN_BLANK answer must be a non-empty string (max 500 chars)');
      }
    } else {
      throw new BadRequestException(`Unsupported question type: ${questionType}`);
    }
  }

  private async getAssessment(instituteId: string, assessmentId: string) {
    const [row] = await this.db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Assessment not found');
    return row;
  }

  private async loadOwn(instituteId: string, attemptId: string, studentId: string): Promise<AttemptRow> {
    const [row] = await this.db
      .select()
      .from(attempts)
      .where(
        and(eq(attempts.id, attemptId), eq(attempts.instituteId, instituteId), eq(attempts.studentId, studentId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Attempt not found');
    return row;
  }

  /**
   * Server-side deadline enforcement — never trust the frontend timer. When an
   * IN_PROGRESS attempt has passed its deadline it is atomically transitioned
   * to EXPIRED (submittedAt = deadline) and evaluated against whatever was
   * saved — both in one transaction, so the attempt is never observable as
   * EXPIRED-but-unevaluated. Callers check `status` afterwards.
   */
  private async refreshAndExpire(row: AttemptRow): Promise<AttemptRow> {
    if (row.status !== 'IN_PROGRESS' || !row.deadline) return row;
    if (new Date() <= row.deadline) return row;
    const expired = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(attempts)
        .set({ status: 'EXPIRED', submittedAt: row.deadline, updatedAt: new Date() })
        .where(and(eq(attempts.id, row.id), eq(attempts.status, 'IN_PROGRESS')))
        .returning();
      if (!updated) return null;
      await this.evaluateAttempt(updated.id, tx);
      const [fresh] = await tx.select().from(attempts).where(eq(attempts.id, updated.id));
      return fresh ?? updated;
    });
    if (expired) return expired;
    // Lost the transition race to a concurrent request — return the winner's state.
    const [fresh] = await this.db.select().from(attempts).where(eq(attempts.id, row.id));
    return fresh ?? row;
  }

  /**
   * Phase 10 automatic evaluation. Deterministic, server-side: grades each
   * snapshotted question against the saved response (unanswered = 0 marks),
   * persists per-response correctness, and writes the attempt's total score.
   * Runs exactly once per attempt, inside the same transaction that performs
   * the IN_PROGRESS -> terminal transition — the attempt can never be observed
   * as terminal-but-unevaluated.
   */
  private async evaluateAttempt(attemptId: string, exec: Queryable = this.db): Promise<void> {
    const [aqRows, resRows] = await Promise.all([
      exec.select().from(attemptQuestions).where(eq(attemptQuestions.attemptId, attemptId)),
      exec.select().from(attemptResponses).where(eq(attemptResponses.attemptId, attemptId)),
    ]);
    const responses = new Map(resRows.map((r) => [r.attemptQuestionId, r]));

    const graded = aqRows.map((aq) => {
      const res = responses.get(aq.id);
      const { isCorrect } = res
        ? gradeAnswer(aq.questionType, aq.payload, res.answer)
        : { isCorrect: false };
      return { attemptQuestionId: aq.id, isCorrect, marksAwarded: isCorrect ? aq.marks : 0 };
    });

    for (const g of graded) {
      await exec
        .update(attemptResponses)
        .set({ isCorrect: g.isCorrect, marksAwarded: g.marksAwarded, evaluatedAt: new Date() })
        .where(eq(attemptResponses.attemptQuestionId, g.attemptQuestionId));
    }
    const score = graded.reduce((sum, g) => sum + g.marksAwarded, 0);
    await exec.update(attempts).set({ score, updatedAt: new Date() }).where(eq(attempts.id, attemptId));
  }

  // ── Student endpoints ──────────────────────

  async listAvailable(instituteId: string) {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(assessments)
      .where(and(eq(assessments.instituteId, instituteId), inArray(assessments.status, [...ATTEMPTABLE_STATUSES])));

    const countsRows = await this.db
      .select({
        assessmentId: assessmentQuestions.assessmentId,
        count: sql<number>`count(*)::int`,
      })
      .from(assessmentQuestions)
      .groupBy(assessmentQuestions.assessmentId);
    const counts = new Map(countsRows.map((r) => [r.assessmentId, r.count]));

    const assessmentsOut = rows
      .filter((a) => (a.startsAt ? a.startsAt <= now : true) && (a.endsAt ? a.endsAt >= now : true))
      .map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        durationMinutes: a.durationMinutes,
        maxMarks: a.maxMarks,
        instructions: a.instructions,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        status: a.status,
        questionCount: counts.get(a.id) ?? 0,
      }));
    return { assessments: assessmentsOut };
  }

  /**
   * Start an attempt on an available assessment. The question set is
   * snapshotted (immutable), so later edits to the assessment link or the
   * source questions never affect the in-flight attempt.
   */
  async start(instituteId: string, studentId: string, assessmentId: string) {
    const assessment = await this.getAssessment(instituteId, assessmentId);

    const now = new Date();
    if (!ATTEMPTABLE_STATUSES.includes(assessment.status as (typeof ATTEMPTABLE_STATUSES)[number])) {
      throw new BadRequestException('Assessment is not available');
    }
    if (assessment.endsAt && now > assessment.endsAt) {
      throw new BadRequestException('Assessment has ended');
    }
    if (assessment.startsAt && now < assessment.startsAt) {
      throw new BadRequestException('Assessment has not started yet');
    }

    const [existing] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.assessmentId, assessmentId),
          eq(attempts.studentId, studentId),
          eq(attempts.status, 'IN_PROGRESS'),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException('An attempt is already in progress for this assessment');
    }

    // Snapshot the question set at start (full payload retained server-side
    // for Phase 10 evaluation; student responses stay sanitized).
    const links = await this.db
      .select({
        questionId: assessmentQuestions.questionId,
        sortOrder: assessmentQuestions.sortOrder,
        marks: assessmentQuestions.marks,
        stem: questions.stem,
        questionType: questions.questionType,
        payload: questions.payload,
      })
      .from(assessmentQuestions)
      .innerJoin(questions, eq(questions.id, assessmentQuestions.questionId))
      .where(eq(assessmentQuestions.assessmentId, assessmentId))
      .orderBy(asc(assessmentQuestions.sortOrder));

    if (links.length === 0) {
      throw new BadRequestException('Assessment has no questions');
    }

    const totalMarks = links.reduce((sum, l) => sum + l.marks, 0);
    const deadline = assessment.durationMinutes
      ? new Date(now.getTime() + assessment.durationMinutes * 60_000)
      : assessment.endsAt ?? null;

    let attempt: AttemptRow;
    try {
      attempt = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(attempts)
          .values({
            instituteId,
            assessmentId,
            studentId,
            status: 'IN_PROGRESS',
            startedAt: now,
            deadline,
            totalMarks,
          })
          .returning();
        await tx.insert(attemptQuestions).values(
          links.map((l) => ({
            attemptId: created.id,
            questionId: l.questionId,
            sortOrder: l.sortOrder,
            marks: l.marks,
            questionType: l.questionType,
            stem: l.stem,
            payload: l.payload as unknown as Record<string, unknown>,
          })),
        );
        return created;
      });
    } catch (error) {
      // Concurrent start lost the race: the partial unique index
      // attempts_one_in_progress_unique refused the second row.
      if (isUniqueViolation(error)) {
        throw new ConflictException('An attempt is already in progress for this assessment');
      }
      throw error;
    }

    return this.detail(instituteId, attempt.id, studentId);
  }

  /** Student's own attempt detail (sanitized, with their saved answers). */
  async detail(instituteId: string, attemptId: string, studentId: string) {
    const attempt = await this.refreshAndExpire(await this.loadOwn(instituteId, attemptId, studentId));
    return { attempt: await this.serializeDetail(attempt, true) };
  }

  /** Save/overwrite a student's answer for one snapshotted question. */
  async saveResponse(instituteId: string, attemptId: string, studentId: string, attemptQuestionId: string, answer: unknown) {
    const aq = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.id, attemptId),
            eq(attempts.instituteId, instituteId),
            eq(attempts.studentId, studentId),
          ),
        )
        .for('update')
        .limit(1);
      if (!locked) throw new NotFoundException('Attempt not found');

      if (locked.status === 'IN_PROGRESS' && locked.deadline && new Date() > locked.deadline) {
        // Deadline passed while queued: expire + evaluate atomically, then reject
        // the late answer. Same transition as refreshAndExpire, inside this lock.
        const [expired] = await tx
          .update(attempts)
          .set({ status: 'EXPIRED', submittedAt: locked.deadline, updatedAt: new Date() })
          .where(eq(attempts.id, locked.id))
          .returning();
        if (expired) await this.evaluateAttempt(expired.id, tx);
        throw new BadRequestException('Attempt is not in progress');
      }
      if (locked.status !== 'IN_PROGRESS') {
        throw new BadRequestException('Attempt is not in progress');
      }

      const [aq] = await tx
        .select()
        .from(attemptQuestions)
        .where(and(eq(attemptQuestions.id, attemptQuestionId), eq(attemptQuestions.attemptId, attemptId)))
        .limit(1);
      if (!aq) throw new NotFoundException('Question not found in this attempt');

      this.validateAnswer(aq.questionType, aq.payload, answer);

      // Duplicate-write safe: unique (attemptId, attemptQuestionId) → upsert.
      await tx
        .insert(attemptResponses)
        .values({ attemptId, attemptQuestionId: aq.id, answer: answer as Record<string, unknown> })
        .onConflictDoUpdate({
          target: [attemptResponses.attemptId, attemptResponses.attemptQuestionId],
          set: { answer: answer as Record<string, unknown>, updatedAt: new Date() },
        });

      return aq;
    });

    return { attemptQuestionId: aq.id, saved: true };
  }

  /** Explicit, idempotent submit. Once submitted (or expired) returns unchanged. */
  async submit(instituteId: string, attemptId: string, studentId: string) {
    let attempt = await this.refreshAndExpire(await this.loadOwn(instituteId, attemptId, studentId));

    if (attempt.status === 'IN_PROGRESS') {
      attempt = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(attempts)
          .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(attempts.id, attemptId), eq(attempts.status, 'IN_PROGRESS')))
          .returning();
        if (!updated) {
          // Lost the transition race (concurrent submit/expire) — winner's state.
          const [fresh] = await tx.select().from(attempts).where(eq(attempts.id, attemptId));
          return fresh ?? attempt;
        }
        await this.evaluateAttempt(attemptId, tx);
        const [fresh] = await tx.select().from(attempts).where(eq(attempts.id, attemptId));
        return fresh ?? updated;
      });
    }

    return this.serializeMeta(attempt);
  }

  /**
   * Phase 10 result review. The student's OWN terminal attempt only — the
   * detail endpoint stays answer-key-free, while this route reveals the
   * correct answer for post-submission review.
   */
  async result(instituteId: string, attemptId: string, studentId: string) {
    const attempt = await this.refreshAndExpire(await this.loadOwn(instituteId, attemptId, studentId));
    if (attempt.status === 'IN_PROGRESS') {
      throw new BadRequestException('Attempt has not been submitted yet');
    }

    const aqRows = await this.db
      .select()
      .from(attemptQuestions)
      .where(eq(attemptQuestions.attemptId, attempt.id))
      .orderBy(asc(attemptQuestions.sortOrder), asc(attemptQuestions.id));
    const resRows = await this.db
      .select()
      .from(attemptResponses)
      .where(eq(attemptResponses.attemptId, attempt.id));
    const responses = new Map(resRows.map((r) => [r.attemptQuestionId, r]));

    const questionsOut = aqRows.map((aq) => {
      const res = responses.get(aq.id);
      const { isCorrect, correctAnswer } = gradeAnswer(aq.questionType, aq.payload, res?.answer ?? {});
      return {
        attemptQuestionId: aq.id,
        questionId: aq.questionId,
        questionType: aq.questionType,
        stem: aq.stem,
        payload: this.sanitizePayload(aq.payload, aq.questionType),
        sortOrder: aq.sortOrder,
        marks: aq.marks,
        answer: res?.answer ?? null,
        isCorrect,
        marksAwarded: isCorrect ? aq.marks : 0,
        correctAnswer,
      };
    });

    return { result: { ...this.serializeMeta(attempt), questions: questionsOut } };
  }

  // ── Teacher endpoints ──────────────────────

  /** Teacher/admin attempt ledger for an assessment (score null until Phase 10). */
  async listForAssessment(instituteId: string, assessmentId: string) {
    await this.getAssessment(instituteId, assessmentId);

    const rows = await this.db
      .select({
        id: attempts.id,
        studentId: attempts.studentId,
        studentName: users.name,
        studentEmail: users.email,
        status: attempts.status,
        startedAt: attempts.startedAt,
        deadline: attempts.deadline,
        submittedAt: attempts.submittedAt,
        score: attempts.score,
        totalMarks: attempts.totalMarks,
      })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.studentId))
      .where(and(eq(attempts.assessmentId, assessmentId), eq(attempts.instituteId, instituteId)))
      .orderBy(asc(attempts.startedAt));

    return { attempts: rows };
  }

  /**
   * Phase 12 examination analytics, computed on demand. Only EVALUATED attempts
   * count (SUBMITTED/EXPIRED with a non-null score — IN_PROGRESS and
   * unevaluated attempts are excluded). One grouped query per question drives
   * question accuracy plus topic/difficulty aggregation; no analytics tables.
   * Never exposes answer keys or per-student data (aggregates only).
   */
  async getAnalytics(instituteId: string, assessmentId: string) {
    await this.getAssessment(instituteId, assessmentId);

    const evaluated = ['SUBMITTED', 'EXPIRED'];
    const scope = and(
      eq(attempts.assessmentId, assessmentId),
      eq(attempts.instituteId, instituteId),
      inArray(attempts.status, evaluated),
      isNotNull(attempts.score),
    );

    const [attemptRows, questionRows] = await Promise.all([
      this.db
        .select({ score: attempts.score, totalMarks: attempts.totalMarks })
        .from(attempts)
        .where(scope)
        .orderBy(asc(attempts.score)),
      this.db
        .select({
          questionId: attemptQuestions.questionId,
          stem: attemptQuestions.stem,
          sortOrder: attemptQuestions.sortOrder,
          marks: attemptQuestions.marks,
          questionType: attemptQuestions.questionType,
          difficulty: questions.difficulty,
          topicId: questions.topicId,
          topicName: topics.name,
          responses: sql<number>`count(${attemptResponses.id})::int`,
          correct: sql<number>`count(*) filter (where ${attemptResponses.isCorrect})::int`,
          incorrect: sql<number>`count(*) filter (where ${attemptResponses.isCorrect} = false)::int`,
          marksAwarded: sql<number>`coalesce(sum(${attemptResponses.marksAwarded}), 0)::int`,
        })
        .from(attemptQuestions)
        .innerJoin(attempts, eq(attempts.id, attemptQuestions.attemptId))
        .innerJoin(questions, eq(questions.id, attemptQuestions.questionId))
        .leftJoin(topics, eq(topics.id, questions.topicId))
        .leftJoin(attemptResponses, eq(attemptResponses.attemptQuestionId, attemptQuestions.id))
        .where(scope)
        .groupBy(
          attemptQuestions.questionId,
          attemptQuestions.stem,
          attemptQuestions.sortOrder,
          attemptQuestions.marks,
          attemptQuestions.questionType,
          questions.difficulty,
          questions.topicId,
          topics.name,
        ),
    ]);

    return {
      analytics: buildAnalytics(
        attemptRows.map((r) => ({ score: r.score as number, totalMarks: r.totalMarks })),
        questionRows.map((r) => ({
          ...r,
          topicId: r.topicId,
          topicName: r.topicName,
        })),
      ),
    };
  }

  // ── Serializers ────────────────────────────

  private async serializeDetail(attempt: AttemptRow, withAnswers: boolean) {
    const aqRows = await this.db
      .select()
      .from(attemptQuestions)
      .where(eq(attemptQuestions.attemptId, attempt.id))
      .orderBy(asc(attemptQuestions.sortOrder), asc(attemptQuestions.id));

    let answerMap = new Map<string, Record<string, unknown>>();
    if (withAnswers) {
      const responses = await this.db
        .select()
        .from(attemptResponses)
        .where(eq(attemptResponses.attemptId, attempt.id));
      answerMap = new Map(responses.map((r) => [r.attemptQuestionId, r.answer as Record<string, unknown>]));
    }

    const questionsOut = aqRows.map((aq) => ({
      attemptQuestionId: aq.id,
      questionId: aq.questionId,
      questionType: aq.questionType,
      stem: aq.stem,
      payload: this.sanitizePayload(aq.payload, aq.questionType),
      sortOrder: aq.sortOrder,
      marks: aq.marks,
      ...(withAnswers ? { answer: answerMap.get(aq.id) ?? null } : {}),
    }));

    return { ...this.serializeMeta(attempt), questions: questionsOut };
  }

  private serializeMeta(attempt: AttemptRow) {
    return {
      id: attempt.id,
      assessmentId: attempt.assessmentId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      submittedAt: attempt.submittedAt,
      score: attempt.score,
      totalMarks: attempt.totalMarks,
    };
  }
}