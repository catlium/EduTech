import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';

import {
  classSubjects,
  divisions,
  studentPlacements,
  studentSubjectEnrollments,
  subjects,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

const UNIQUE_VIOLATION = '23505';

// Phase H — student subject enrollments (D5/§17): per-student scope overrides
// on top of the class-derived subject set. An ACTIVE placement is required
// (an enrollment pinned to an inactive/historical placement is meaningless),
// the subject must be a same-institute subject, and its kind must be
// consistent with the placement class's offerings: EXCLUDED only for a class
// subject (removing it from the student's set), ENROLLED only for a subject
// the class does NOT offer (elective addition). The unique
// (placement_id, subject_id) key makes ENROLLED/EXCLUDED mutually exclusive
// and surfaces duplicates as ConflictException. Deleting an override reverts
// the student to the class default.
@Injectable()
export class StudentSubjectEnrollmentsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async listStudentEnrollments(
    instituteId: string,
    filters: { placementId?: string; subjectId?: string } = {},
  ) {
    const conditions = [eq(studentSubjectEnrollments.instituteId, instituteId)];
    if (filters.placementId) {
      conditions.push(eq(studentSubjectEnrollments.placementId, filters.placementId));
    }
    if (filters.subjectId) {
      conditions.push(eq(studentSubjectEnrollments.subjectId, filters.subjectId));
    }
    return this.db
      .select()
      .from(studentSubjectEnrollments)
      .where(and(...conditions))
      .orderBy(studentSubjectEnrollments.createdAt);
  }

  async createStudentEnrollment(
    instituteId: string,
    input: { placementId: string; subjectId: string; kind: 'ENROLLED' | 'EXCLUDED' },
  ) {
    const [placement] = await this.db
      .select({ id: studentPlacements.id, divisionId: studentPlacements.divisionId, status: studentPlacements.status })
      .from(studentPlacements)
      .where(
        and(
          eq(studentPlacements.id, input.placementId),
          eq(studentPlacements.instituteId, instituteId),
        ),
      )
      .limit(1);
    if (!placement) throw new NotFoundException('Student placement not found');
    if (placement.status !== 'active') {
      throw new BadRequestException('Only active student placements can have subject overrides');
    }

    const [subject] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, input.subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!subject) throw new NotFoundException('Subject not found');

    const offered = await this.classOfferedSubjectIds(instituteId, placement.divisionId);
    if (input.kind === 'EXCLUDED') {
      if (!offered.has(input.subjectId)) {
        throw new BadRequestException(
          'EXCLUDED subjects must be offered by the placement class (the student cannot be excluded from a subject they are not offered)',
        );
      }
    } else if (offered.has(input.subjectId)) {
      throw new BadRequestException(
        'The class already offers this subject — no ENROLLED override is needed',
      );
    }

    try {
      const [row] = await this.db
        .insert(studentSubjectEnrollments)
        .values({
          instituteId,
          placementId: placement.id,
          subjectId: input.subjectId,
          kind: input.kind,
        })
        .returning();
      return row!;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'This subject already has an enrollment override for the placement',
        );
      }
      throw error;
    }
  }

  async removeStudentEnrollment(instituteId: string, enrollmentId: string) {
    const [row] = await this.db
      .delete(studentSubjectEnrollments)
      .where(
        and(
          eq(studentSubjectEnrollments.id, enrollmentId),
          eq(studentSubjectEnrollments.instituteId, instituteId),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Student subject enrollment not found');
    return row;
  }

  private async classOfferedSubjectIds(
    instituteId: string,
    divisionId: string,
  ): Promise<Set<string>> {
    const [division] = await this.db
      .select({ classId: divisions.classId })
      .from(divisions)
      .where(and(eq(divisions.id, divisionId), eq(divisions.instituteId, instituteId)))
      .limit(1);
    if (!division) throw new NotFoundException('Division not found');

    const offerings = await this.db
      .select({ subjectId: classSubjects.subjectId })
      .from(classSubjects)
      .where(eq(classSubjects.classId, division.classId));
    return new Set(offerings.map((o) => o.subjectId));
  }

  private isUniqueViolation(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error
        ? (error.cause as { code?: string })?.code
        : (error as { code?: string })?.code;
    return code === UNIQUE_VIOLATION;
  }
}