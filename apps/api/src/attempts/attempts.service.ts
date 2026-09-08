import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  assessments,
  assessmentQuestions,
  questions,
  attempts,
  attemptQuestions,
  attemptResponses,
  users,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

const ATTEMPTABLE_STATUSES = ['PUBLISHED', 'ACTIVE'] as const;
type AttemptRow = typeof attempts.$inferSelect;

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
   * to EXPIRED (submittedAt = deadline). Callers check `status` afterwards.
   */
  private async refreshAndExpire(row: AttemptRow): Promise<AttemptRow> {
    if (row.status !== 'IN_PROGRESS' || !row.deadline) return row;
    if (new Date() <= row.deadline) return row;
    const [updated] = await this.db
      .update(attempts)
      .set({ status: 'EXPIRED', submittedAt: row.deadline, updatedAt: new Date() })
      .where(eq(attempts.id, row.id))
      .returning();
    return updated ?? row;
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

    const attempt = await this.db.transaction(async (tx) => {
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

    return this.detail(instituteId, attempt.id, studentId);
  }

  /** Student's own attempt detail (sanitized, with their saved answers). */
  async detail(instituteId: string, attemptId: string, studentId: string) {
    const attempt = await this.refreshAndExpire(await this.loadOwn(instituteId, attemptId, studentId));
    return { attempt: await this.serializeDetail(attempt, true) };
  }

  /** Save/overwrite a student's answer for one snapshotted question. */
  async saveResponse(instituteId: string, attemptId: string, studentId: string, attemptQuestionId: string, answer: unknown) {
    const attempt = await this.refreshAndExpire(await this.loadOwn(instituteId, attemptId, studentId));
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Attempt is not in progress');
    }

    const [aq] = await this.db
      .select()
      .from(attemptQuestions)
      .where(and(eq(attemptQuestions.id, attemptQuestionId), eq(attemptQuestions.attemptId, attemptId)))
      .limit(1);
    if (!aq) throw new NotFoundException('Question not found in this attempt');

    this.validateAnswer(aq.questionType, aq.payload, answer);

    // Duplicate-write safe: unique (attemptId, attemptQuestionId) → upsert.
    await this.db
      .insert(attemptResponses)
      .values({ attemptId, attemptQuestionId: aq.id, answer: answer as Record<string, unknown> })
      .onConflictDoUpdate({
        target: [attemptResponses.attemptId, attemptResponses.attemptQuestionId],
        set: { answer: answer as Record<string, unknown>, updatedAt: new Date() },
      });

    return { attemptQuestionId: aq.id, saved: true };
  }

  /** Explicit, idempotent submit. Already-submitted/expired returns unchanged. */
  async submit(instituteId: string, attemptId: string, studentId: string) {
    let attempt = await this.refreshAndExpire(await this.loadOwn(instituteId, attemptId, studentId));

    if (attempt.status === 'IN_PROGRESS') {
      const [updated] = await this.db
        .update(attempts)
        .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(attempts.id, attemptId))
        .returning();
      attempt = updated ?? attempt;
    }

    return this.serializeMeta(attempt);
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