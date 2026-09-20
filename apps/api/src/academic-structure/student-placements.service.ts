import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';

import {
  studentPlacements,
  divisions,
  academicYears,
  classes,
  memberships,
  membershipRoles,
  roles,
  users,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { STUDENT } from '../authorization/permission-catalogue.js';

const UNIQUE_VIOLATION = '23505';

const placementSelect = {
  id: studentPlacements.id,
  instituteId: studentPlacements.instituteId,
  membershipId: studentPlacements.membershipId,
  academicYearId: studentPlacements.academicYearId,
  divisionId: studentPlacements.divisionId,
  status: studentPlacements.status,
  createdAt: studentPlacements.createdAt,
  updatedAt: studentPlacements.updatedAt,
  studentName: users.name,
  academicYearName: academicYears.name,
  className: classes.name,
  divisionName: divisions.name,
};

export interface StudentPlacementListOptions {
  academicYearId?: string;
  divisionId?: string;
  membershipId?: string;
}

// Phase G — student academic placements (D5/§17): a STUDENT membership is
// placed into ONE division per academic year. The placement's academic year is
// derived from the division server-side (never trusted from the client, and
// class is never stored — both follow Student → Division → Class + Year).
// Tenancy: the division must belong to the institute, and the membership must
// be an ACTIVE same-institute STUDENT. Exactly one ACTIVE placement per
// (student, year) is enforced both here and by the partial unique index; a
// deactivated (inactive) row stays as history, and transfer deactivates the
// current row before creating the fresh one.
@Injectable()
export class StudentPlacementsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async listStudentPlacements(instituteId: string, options: StudentPlacementListOptions = {}) {
    const conditions = [eq(studentPlacements.instituteId, instituteId)];
    if (options.academicYearId) conditions.push(eq(studentPlacements.academicYearId, options.academicYearId));
    if (options.divisionId) conditions.push(eq(studentPlacements.divisionId, options.divisionId));
    if (options.membershipId) conditions.push(eq(studentPlacements.membershipId, options.membershipId));

    return this.placementQuery()
      .where(and(...conditions))
      .orderBy(asc(academicYears.name), asc(classes.sortOrder), asc(divisions.name));
  }

  async getStudentPlacement(instituteId: string, placementId: string) {
    const [row] = await this.placementQuery()
      .where(
        and(eq(studentPlacements.id, placementId), eq(studentPlacements.instituteId, instituteId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Student placement not found');
    return row;
  }

  async createStudentPlacement(instituteId: string, input: { membershipId: string; divisionId: string }) {
    // The division is this institute's tenant anchor; its year is authoritative
    // (client-supplied year/class values are never trusted).
    const division = await this.getDivision(instituteId, input.divisionId);
    const academicYearId = division.academicYearId;

    await this.requireActiveStudentMembership(instituteId, input.membershipId);

    try {
      const [row] = await this.db
        .insert(studentPlacements)
        .values({ instituteId, membershipId: input.membershipId, academicYearId, divisionId: division.id })
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'Student already has an active placement in this academic year');
      throw error;
    }
  }

  async deactivateStudentPlacement(instituteId: string, placementId: string) {
    await this.getPlacementRow(instituteId, placementId);
    const [row] = await this.db
      .update(studentPlacements)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(and(eq(studentPlacements.id, placementId), eq(studentPlacements.instituteId, instituteId)))
      .returning();
    return row!;
  }

  /** Moves a student to a target division in one transaction: the current
   *  placement is soft-deactivated (kept as history) and a fresh ACTIVE
   *  placement is created for the same membership at the target division's
   *  year. A target year where the student already holds an ACTIVE placement
   *  conflicts — the insert violates the partial unique index (mapped to
   *  ConflictException). */
  async transferStudentPlacement(instituteId: string, placementId: string, input: { divisionId: string }) {
    const current = await this.getPlacementRow(instituteId, placementId);
    const targetDivision = await this.getDivision(instituteId, input.divisionId);
    const targetYearId = targetDivision.academicYearId;

    await this.requireActiveStudentMembership(instituteId, current.membershipId);

    return this.db.transaction(async (tx) => {
      await tx
        .update(studentPlacements)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(studentPlacements.id, current.id));

      try {
        const [row] = await tx
          .insert(studentPlacements)
          .values({
            instituteId,
            membershipId: current.membershipId,
            academicYearId: targetYearId,
            divisionId: targetDivision.id,
          })
          .returning();
        return row!;
      } catch (error) {
        this.throwIfUniqueViolation(error, 'Student already has an active placement in this academic year');
        throw error;
      }
    });
  }

  private placementQuery() {
    return this.db
      .select(placementSelect)
      .from(studentPlacements)
      .innerJoin(divisions, eq(studentPlacements.divisionId, divisions.id))
      .innerJoin(academicYears, eq(studentPlacements.academicYearId, academicYears.id))
      .innerJoin(classes, eq(divisions.classId, classes.id))
      .innerJoin(memberships, eq(studentPlacements.membershipId, memberships.id))
      .innerJoin(users, eq(memberships.userId, users.id));
  }

  private async getPlacementRow(instituteId: string, placementId: string) {
    const [row] = await this.db
      .select()
      .from(studentPlacements)
      .where(and(eq(studentPlacements.id, placementId), eq(studentPlacements.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Student placement not found');
    return row;
  }

  private async getDivision(instituteId: string, divisionId: string) {
    const [row] = await this.db
      .select()
      .from(divisions)
      .where(and(eq(divisions.id, divisionId), eq(divisions.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Division not found');
    return row;
  }

  private async requireActiveStudentMembership(instituteId: string, membershipId: string) {
    const [membership] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(membershipRoles.roleId, roles.id))
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.instituteId, instituteId),
          eq(memberships.status, 'active'),
          eq(roles.key, STUDENT),
        ),
      )
      .limit(1);
    if (!membership) throw new BadRequestException('Membership is not an active student in this institute');
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