import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { eq, and, desc, asc, inArray, count } from 'drizzle-orm';
import { assessments, assessmentQuestions, questions } from '@catlium/database';
import type { Database } from '@catlium/database';
import type { AssessmentStatus } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';

// Pattern 1 (08-RESEARCH) — the transition lookup table is the single source
// of truth for lifecycle legality. COMPLETED is terminal (empty list).
const VALID_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ACTIVE', 'DRAFT'], // unpublish back to draft
  ACTIVE: ['COMPLETED'],
  COMPLETED: [],
};

export interface CreateAssessmentInput {
  title: string;
  description?: string;
  durationMinutes?: number;
  maxMarks?: number;
  instructions?: Record<string, unknown>;
  startsAt?: string;
  endsAt?: string;
}

export interface UpdateAssessmentInput {
  title?: string;
  description?: string;
  durationMinutes?: number;
  maxMarks?: number;
  instructions?: Record<string, unknown>;
  startsAt?: string | null;
  endsAt?: string | null;
}

@Injectable()
export class ExaminationsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Shared schedule validation — called from both createAssessment and
   * updateAssessment to prevent schedule-invariant drift (08-06 WR-01 fix).
   *
   * @param startsAt  merged start (Date | null)
   * @param endsAt    merged end (Date | null)
   * @param patchingStart true when the patch itself is changing startsAt
   *                     (future-startsAt only fires in this case)
   */
  private validateSchedule(
    startsAt: Date | null | undefined,
    endsAt: Date | null | undefined,
    patchingStart = false,
  ): void {
    if (startsAt != null && endsAt != null) {
      if (startsAt >= endsAt) {
        throw new BadRequestException('Assessment schedule is invalid: start must be before end');
      }
    }
    if (patchingStart && startsAt != null && startsAt <= new Date()) {
      throw new BadRequestException('Assessment start date must be in the future');
    }
  }

  // ── Create ────────────────────────────────

  async createAssessment(instituteId: string, createdBy: string, input: CreateAssessmentInput) {
    this.validateSchedule(
      input.startsAt ? new Date(input.startsAt) : null,
      input.endsAt ? new Date(input.endsAt) : null,
      input.startsAt !== undefined,
    );

    const [assessment] = await this.db
      .insert(assessments)
      .values({
        instituteId,
        title: input.title,
        description: input.description ?? null,
        durationMinutes: input.durationMinutes ?? null,
        maxMarks: input.maxMarks ?? null,
        instructions: input.instructions ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        status: 'DRAFT',
        createdBy,
        updatedBy: createdBy,
      })
      .returning();

    return assessment!;
  }

  // ── Update ────────────────────────────────

  async updateAssessment(
    instituteId: string,
    userId: string,
    assessmentId: string,
    patch: UpdateAssessmentInput,
  ) {
    const existing = await this.getAssessment(instituteId, assessmentId);

    // Pitfall 2 — state-guarded edit: only DRAFT is editable. PUBLISHED is
    // locked until unpublished via the 08-03 state machine.
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Assessment can only be edited in DRAFT status');
    }

    // 08-06 WR-01 fix: validate the MERGED schedule (existing overlaid with
    // the patch) on every update. The future-startsAt rule fires only when the
    // patch itself changes startsAt (touching startsAt only, or both fields);
    // untouched-field freedom is preserved so PATCH-only-endsAt stays legal
    // and null-clear remains allowed.
    this.validateSchedule(
      patch.startsAt !== undefined
        ? (patch.startsAt === null ? null : new Date(patch.startsAt))
        : existing.startsAt,
      patch.endsAt !== undefined
        ? (patch.endsAt === null ? null : new Date(patch.endsAt))
        : existing.endsAt,
      patch.startsAt !== undefined && patch.startsAt !== null,
    );

    const startsAt =
      patch.startsAt === undefined ? undefined : patch.startsAt === null ? null : new Date(patch.startsAt);
    const endsAt =
      patch.endsAt === undefined ? undefined : patch.endsAt === null ? null : new Date(patch.endsAt);

    const [assessment] = await this.db
      .update(assessments)
      .set({
        ...patch,
        startsAt,
        endsAt,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(assessments.id, assessmentId), eq(assessments.instituteId, instituteId)))
      .returning();

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    return assessment!;
  }

  // ── State machine ─────────────────────────

  private assertValidTransition(current: string, next: AssessmentStatus): void {
    const allowed = VALID_TRANSITIONS[current as AssessmentStatus];
    if (!allowed || !allowed.includes(next)) {
      throw new BadRequestException(
        `Cannot transition assessment from ${current} to ${next}`,
      );
    }
  }

  private async setStatus(
    instituteId: string,
    assessmentId: string,
    status: AssessmentStatus,
  ) {
    const [assessment] = await this.db
      .update(assessments)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(assessments.id, assessmentId), eq(assessments.instituteId, instituteId)))
      .returning();

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    return assessment!;
  }

  // Pattern 3 (08-RESEARCH) — the publish validation gate: every precondition
  // re-checked at publish time, any failure keeps the assessment in DRAFT.
  async publishAssessment(instituteId: string, assessmentId: string) {
    const assessment = await this.getAssessment(instituteId, assessmentId);
    this.assertValidTransition(assessment.status, 'PUBLISHED');

    // Pitfall 1 — re-check the CURRENT approval status AND status (ACTIVE) of
    // every linked question (a question approved at link time may have been
    // rejected or archived since). ARCHIVED questions (WR-03/EXAM-08) are
    // unlinkable and unpublishable; status is independent of approvalStatus.
    const linked = await this.listQuestions(instituteId, assessmentId);
    if (linked.length === 0) {
      throw new BadRequestException('Assessment must have at least one question');
    }
    const unapproved = linked.filter(
      (q) => q.question.approvalStatus !== 'APPROVED' || q.question.status !== 'ACTIVE',
    );
    if (unapproved.length > 0) {
      throw new BadRequestException(
        `${unapproved.length} question(s) are not APPROVED or not ACTIVE`,
      );
    }

    if (!assessment.durationMinutes || assessment.durationMinutes <= 0) {
      throw new BadRequestException('Duration must be configured before publishing');
    }
    if (!assessment.maxMarks || assessment.maxMarks <= 0) {
      throw new BadRequestException('Maximum marks must be configured before publishing');
    }
    if (assessment.startsAt && assessment.endsAt) {
      if (new Date(assessment.startsAt) >= new Date(assessment.endsAt)) {
        throw new BadRequestException('Schedule start must be before end');
      }
    }

    return this.setStatus(instituteId, assessmentId, 'PUBLISHED');
  }

  // Manual activation for the MVP (research A1) — no cron/auto-activation.
  async activateAssessment(instituteId: string, assessmentId: string) {
    const assessment = await this.getAssessment(instituteId, assessmentId);
    this.assertValidTransition(assessment.status, 'ACTIVE');
    return this.setStatus(instituteId, assessmentId, 'ACTIVE');
  }

  // Terminal transition — COMPLETED has no outgoing transitions.
  async completeAssessment(instituteId: string, assessmentId: string) {
    const assessment = await this.getAssessment(instituteId, assessmentId);
    this.assertValidTransition(assessment.status, 'COMPLETED');
    return this.setStatus(instituteId, assessmentId, 'COMPLETED');
  }

  // PUBLISHED→DRAFT (research A4) so teachers can fix mistakes. ACTIVE→DRAFT
  // is blocked by VALID_TRANSITIONS — students may be attempting.
  async unpublishAssessment(instituteId: string, assessmentId: string) {
    const assessment = await this.getAssessment(instituteId, assessmentId);
    this.assertValidTransition(assessment.status, 'DRAFT');
    return this.setStatus(instituteId, assessmentId, 'DRAFT');
  }

  // ── Delete ────────────────────────────────

  async deleteAssessment(instituteId: string, assessmentId: string) {
    const [assessment] = await this.db
      .delete(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.instituteId, instituteId)))
      .returning();

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }
  }

  // ── Question linking ─────────────────────

  async listQuestions(instituteId: string, assessmentId: string) {
    await this.getAssessment(instituteId, assessmentId);

    const rows = await this.db
      .select()
      .from(assessmentQuestions)
      .innerJoin(
        questions,
        and(eq(assessmentQuestions.questionId, questions.id), eq(questions.instituteId, instituteId)),
      )
      .where(eq(assessmentQuestions.assessmentId, assessmentId))
      .orderBy(asc(assessmentQuestions.sortOrder));

    return rows.map((row) => ({
      id: row.assessment_questions.id,
      assessmentId: row.assessment_questions.assessmentId,
      questionId: row.assessment_questions.questionId,
      sortOrder: row.assessment_questions.sortOrder,
      marks: row.assessment_questions.marks,
      question: row.questions,
    }));
  }

  async addQuestions(instituteId: string, assessmentId: string, questionIds: string[]) {
    const existing = await this.getAssessment(instituteId, assessmentId);

    // Research "question set is locked after PUBLISHED" + T-08-17 — only a
    // DRAFT assessment can change its question set; unpublish first otherwise.
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Questions can only be added in DRAFT status');
    }

    // Pitfall 3 — cross-tenant linking blocked: every question must exist in
    // the active institute, checked on BOTH id and instituteId. The existence
    // (institute-scope) check runs FIRST and keeps the exact Pitfall-3 400; the
    // status check only fires for in-institute questions (no new oracle, T-08-22).
    for (const id of questionIds) {
      const [question] = await this.db
        .select({ id: questions.id, status: questions.status })
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.instituteId, instituteId)))
        .limit(1);

      if (!question) {
        throw new BadRequestException(`Question ${id} not found or not in this institute`);
      }
      // T-08-21 — an ARCHIVED (non-ACTIVE) question cannot be linked at all;
      // defense in depth with the publish gate (WR-03/EXAM-08).
      if (question.status !== 'ACTIVE') {
        throw new BadRequestException(`Question ${id} is not ACTIVE`);
      }
    }

    try {
      return await this.db.transaction(async (tx) => {
        const added: Array<typeof assessmentQuestions.$inferSelect> = [];
        // sortOrder is 1-based on the array index; marks defaults to 1 (A5).
        for (let i = 0; i < questionIds.length; i++) {
          const [row] = await tx
            .insert(assessmentQuestions)
            .values({
              assessmentId,
              questionId: questionIds[i]!,
              sortOrder: i + 1,
              marks: 1,
            })
            .returning();
          added.push(row!);
        }
        return added;
      });
    } catch (error) {
      this.throwIfUniqueViolation(error, 'Question already in this assessment');
      throw error;
    }
  }

  async removeQuestion(instituteId: string, assessmentId: string, questionId: string) {
    const existing = await this.getAssessment(instituteId, assessmentId);

    // Same non-DRAFT lock as addQuestions — the question set is immutable
    // once published.
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Questions can only be removed in DRAFT status');
    }

    const [row] = await this.db
      .delete(assessmentQuestions)
      .where(
        and(
          eq(assessmentQuestions.assessmentId, assessmentId),
          eq(assessmentQuestions.questionId, questionId),
        ),
      )
      .returning();

    if (!row) {
      throw new NotFoundException('Assessment question not found');
    }
  }

  private throwIfUniqueViolation(error: unknown, message: string): void {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error
        ? (error.cause as { code?: string })?.code
        : (error as { code?: string })?.code;

    if (code === '23505') {
      throw new ConflictException(message);
    }
  }

  // ── Read ──────────────────────────────────

  async getAssessment(instituteId: string, assessmentId: string) {
    const [assessment] = await this.db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.instituteId, instituteId)))
      .limit(1);

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    return assessment;
  }

  async listAssessments(instituteId: string) {
    const rows = await this.db
      .select()
      .from(assessments)
      .where(eq(assessments.instituteId, instituteId))
      .orderBy(desc(assessments.updatedAt));

    if (rows.length === 0) {
      return [];
    }

    const counts = await this.db
      .select({
        assessmentId: assessmentQuestions.assessmentId,
        count: count(),
      })
      .from(assessmentQuestions)
      .where(
        inArray(
          assessmentQuestions.assessmentId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(assessmentQuestions.assessmentId);

    const countMap = new Map(counts.map((row) => [row.assessmentId, row.count]));

    return rows.map((row) => ({
      ...row,
      questionCount: countMap.get(row.id) ?? 0,
    }));
  }
}