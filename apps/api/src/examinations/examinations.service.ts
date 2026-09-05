import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { eq, and, desc, inArray, count } from 'drizzle-orm';
import { assessments, assessmentQuestions } from '@catlium/database';
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