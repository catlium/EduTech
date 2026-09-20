import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';

import {
  teacherAssignments,
  classSubjects,
  classes,
  subjects,
  memberships,
  membershipRoles,
  roles,
  users,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { TEACHER } from '../authorization/permission-catalogue.js';

const UNIQUE_VIOLATION = '23505';

export interface TeacherAssignmentListOptions {
  classSubjectId?: string;
  membershipId?: string;
}

// Phase F — teacher academic assignments (D5/§17, revised): a TEACHER
// membership is assigned to one canonical `class_subjects` offering. NOT
// division-specific, no duplicated class/subject copies on the assignment row.
// Tenancy: the assignment's institute must match the class_subject's class
// institute (checked via the class), and the teacher membership must live in
// the same institute. Only TEACHER-role memberships can be assigned, and only
// INSTITUTE_ADMIN can manage the configuration (controller guard).
@Injectable()
export class TeacherAssignmentsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async listTeacherAssignments(instituteId: string, options: TeacherAssignmentListOptions = {}) {
    const conditions = [eq(teacherAssignments.instituteId, instituteId)];
    if (options.classSubjectId) conditions.push(eq(teacherAssignments.classSubjectId, options.classSubjectId));
    if (options.membershipId) conditions.push(eq(teacherAssignments.membershipId, options.membershipId));

    return this.db
      .select({
        id: teacherAssignments.id,
        instituteId: teacherAssignments.instituteId,
        classSubjectId: teacherAssignments.classSubjectId,
        membershipId: teacherAssignments.membershipId,
        status: teacherAssignments.status,
        createdAt: teacherAssignments.createdAt,
        updatedAt: teacherAssignments.updatedAt,
        className: classes.name,
        subjectName: subjects.name,
        teacherName: users.name,
      })
      .from(teacherAssignments)
      .innerJoin(classSubjects, eq(teacherAssignments.classSubjectId, classSubjects.id))
      .innerJoin(classes, eq(classSubjects.classId, classes.id))
      .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
      .innerJoin(memberships, eq(teacherAssignments.membershipId, memberships.id))
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(...conditions));
  }

  async getTeacherAssignment(instituteId: string, assignmentId: string) {
    const [row] = await this.db
      .select()
      .from(teacherAssignments)
      .where(and(eq(teacherAssignments.id, assignmentId), eq(teacherAssignments.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Teacher assignment not found');
    return row;
  }

  async createTeacherAssignment(instituteId: string, input: { membershipId: string; classSubjectId: string }) {
    // The class_subject belongs to this institute if its CLASS belongs here
    // (class_subjects has no institute column; classes is the tenant anchor).
    const [offering] = await this.db
      .select({ id: classSubjects.id })
      .from(classSubjects)
      .innerJoin(classes, eq(classSubjects.classId, classes.id))
      .where(and(eq(classSubjects.id, input.classSubjectId), eq(classes.instituteId, instituteId)))
      .limit(1);
    if (!offering) throw new NotFoundException('Class subject not found');

    // The teacher is an ACTIVE membership of this institute carrying the
    // TEACHER role. Not an institute member → not found; member but without
    // TEACHER → rejected (prevents assigning non-teachers, e.g. self-escalation
    // if an admin grants themselves a teacher slot without the role).
    const [teacherMembership] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(membershipRoles.roleId, roles.id))
      .where(
        and(
          eq(memberships.id, input.membershipId),
          eq(memberships.instituteId, instituteId),
          eq(memberships.status, 'active'),
          eq(roles.key, TEACHER),
        ),
      )
      .limit(1);
    if (!teacherMembership) throw new BadRequestException('Membership is not an active teacher in this institute');

    try {
      const [row] = await this.db
        .insert(teacherAssignments)
        .values({ ...input, instituteId })
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'Teacher already assigned to this class subject');
      throw error;
    }
  }

  async deactivateTeacherAssignment(instituteId: string, assignmentId: string) {
    await this.getTeacherAssignment(instituteId, assignmentId);
    const [row] = await this.db
      .update(teacherAssignments)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(and(eq(teacherAssignments.id, assignmentId), eq(teacherAssignments.instituteId, instituteId)))
      .returning();
    return row!;
  }

  private throwIfUniqueViolation(error: unknown, message: string): void {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error
        ? (error.cause as { code?: string })?.code
        : (error as { code?: string })?.code;

    if (code === UNIQUE_VIOLATION) {
      throw new ConflictException(message);
    }
  }
}