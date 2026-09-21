import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import {
  classSubjects,
  divisions,
  membershipRoles,
  roles,
  studentPlacements,
  studentSubjectEnrollments,
  teacherAssignments,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

// Phase H — academic resource scope (D6/§18). Resolves what a membership may
// access inside an institute:
//   - whole-institute  → INSTITUTE_ADMIN (institute-wide access; the ONLY bypass)
//   - subject-set      → subjects the membership can reach, derived from DB state
//                        (never JWTs): union of the student's enrolled subjects
//                        (placement → division → class → class_subjects, ±
//                        enrollment overrides) and the teacher's assigned
//                        subjects (active teacher_assignments).
// A non-admin with no placement/assignment holds an EMPTY subject-set → every
// subject-anchored resource is out of scope (default deny). Read denials are
// 404 (no existence leak); write denials are 403 (pre-mutation check).
export type AcademicScope = Readonly<
  | { kind: 'whole-institute' }
  | { kind: 'subject-set'; subjectIds: string[] }
>;

@Injectable()
export class AcademicScopeService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async resolveScope(instituteId: string, membershipId: string): Promise<AcademicScope> {
    if (await this.isInstituteAdmin(membershipId)) {
      return { kind: 'whole-institute' };
    }
    const [studentSubjectIds, teacherSubjectIds] = await Promise.all([
      this.studentSubjectSet(instituteId, membershipId),
      this.teacherSubjectSet(instituteId, membershipId),
    ]);
    return { kind: 'subject-set', subjectIds: [...new Set([...studentSubjectIds, ...teacherSubjectIds])] };
  }

  /** SQL predicate for list queries: `undefined` = no filter (admin sees the
   *  whole institute); otherwise restrict the resource's subject column to the
   *  membership's subject set (empty set → a false predicate → nothing). */
  async subjectScopePredicate(
    instituteId: string,
    membershipId: string,
    subjectColumn: AnyPgColumn,
  ): Promise<SQL | undefined> {
    const scope = await this.resolveScope(instituteId, membershipId);
    if (scope.kind === 'whole-institute') return undefined;
    return inArray(subjectColumn, scope.subjectIds);
  }

  /** Read gate: 404 when the resource's subject is outside the actor's scope
   *  (no existence leak). */
  async requireReadableSubject(
    instituteId: string,
    membershipId: string,
    subjectId: string | null,
  ): Promise<void> {
    const scope = await this.resolveScope(instituteId, membershipId);
    if (scope.kind === 'whole-institute') return;
    if (!subjectId || !scope.subjectIds.includes(subjectId)) {
      throw new NotFoundException('Resource not found');
    }
  }

  /** Write gate: 403 pre-mutation when the target subject is outside scope. */
  async requireWritableSubject(
    instituteId: string,
    membershipId: string,
    subjectId: string | null,
  ): Promise<void> {
    const scope = await this.resolveScope(instituteId, membershipId);
    if (scope.kind === 'whole-institute') return;
    if (!subjectId || !scope.subjectIds.includes(subjectId)) {
      throw new ForbiddenException('Resource is outside your academic scope');
    }
  }

  private async isInstituteAdmin(membershipId: string): Promise<boolean> {
    const rows = await this.db
      .select({ key: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(membershipRoles.roleId, roles.id))
      .where(eq(membershipRoles.membershipId, membershipId));
    return rows.some((row) => row.key === 'INSTITUTE_ADMIN');
  }

  /** Subjects the placed student reaches: their class's offerings (placement →
   *  division → class → class_subjects, shared by every division of the
   *  class), minus EXCLUDED overrides, plus ENROLLED overrides. Empty when not
   *  actively placed. */
  private async studentSubjectSet(instituteId: string, membershipId: string): Promise<string[]> {
    const [placement] = await this.db
      .select({ id: studentPlacements.id, divisionId: studentPlacements.divisionId })
      .from(studentPlacements)
      .where(
        and(
          eq(studentPlacements.instituteId, instituteId),
          eq(studentPlacements.membershipId, membershipId),
          eq(studentPlacements.status, 'active'),
        ),
      )
      .limit(1);
    if (!placement) return [];

    const [division] = await this.db
      .select({ classId: divisions.classId })
      .from(divisions)
      .where(eq(divisions.id, placement.divisionId))
      .limit(1);
    if (!division) return [];

    const [offerings, enrollments] = await Promise.all([
      this.db
        .select({ subjectId: classSubjects.subjectId })
        .from(classSubjects)
        .where(eq(classSubjects.classId, division.classId)),
      this.db
        .select({ subjectId: studentSubjectEnrollments.subjectId, kind: studentSubjectEnrollments.kind })
        .from(studentSubjectEnrollments)
        .where(eq(studentSubjectEnrollments.placementId, placement.id)),
    ]);

    const excluded = new Set(
      enrollments.filter((e) => e.kind === 'EXCLUDED').map((e) => e.subjectId),
    );
    const enrolled = enrollments
      .filter((e) => e.kind === 'ENROLLED')
      .map((e) => e.subjectId);

    return [
      ...new Set([
        ...offerings.filter((o) => !excluded.has(o.subjectId)).map((o) => o.subjectId),
        ...enrolled,
      ]),
    ];
  }

  /** Subjects of the teacher's active assignments (Teacher → class_subjects →
   *  subject, shared across every division/class-cohort of the offering). */
  private async teacherSubjectSet(instituteId: string, membershipId: string): Promise<string[]> {
    const assignments = await this.db
      .select({ classSubjectId: teacherAssignments.classSubjectId })
      .from(teacherAssignments)
      .where(
        and(
          eq(teacherAssignments.instituteId, instituteId),
          eq(teacherAssignments.membershipId, membershipId),
          eq(teacherAssignments.status, 'active'),
        ),
      );
    if (!assignments.length) return [];

    const offerings = await this.db
      .select({ subjectId: classSubjects.subjectId })
      .from(classSubjects)
      .where(inArray(classSubjects.id, assignments.map((a) => a.classSubjectId)));

    return [...new Set(offerings.map((o) => o.subjectId))];
  }
}