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
import { DATABASE_TOKEN } from '../database/database.module.js';

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

  // ── Create ────────────────────────────────

  async createAssessment(instituteId: string, createdBy: string, input: CreateAssessmentInput) {
    if (input.startsAt !== undefined) {
      if (new Date(input.startsAt) <= new Date()) {
        throw new BadRequestException('Schedule start must be in the future');
      }
      if (input.endsAt !== undefined && new Date(input.startsAt) >= new Date(input.endsAt)) {
        throw new BadRequestException('Schedule start must be before end');
      }
    }

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

    // Pitfall 6 — re-validate the schedule when either end changes.
    if (patch.startsAt != null && patch.endsAt != null) {
      if (new Date(patch.startsAt) >= new Date(patch.endsAt)) {
        throw new BadRequestException('Schedule start must be before end');
      }
    }

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
    await this.getAssessment(instituteId, assessmentId);

    // Pitfall 3 — cross-tenant linking blocked: every question must exist in
    // the active institute, checked on BOTH id and instituteId.
    for (const id of questionIds) {
      const [question] = await this.db
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.instituteId, instituteId)))
        .limit(1);

      if (!question) {
        throw new BadRequestException(`Question ${id} not found or not in this institute`);
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
    await this.getAssessment(instituteId, assessmentId);

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