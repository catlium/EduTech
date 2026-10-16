import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, asc, inArray, sql } from 'drizzle-orm';

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

export interface CarryForwardPreviewOptions {
  sourceAcademicYearId: string;
  destinationAcademicYearId: string;
  classId?: string;
}

export interface CarryForwardItem {
  placementId: string;
  destinationDivisionId: string;
}

export interface CarryForwardCommitInput {
  destinationAcademicYearId: string;
  items: CarryForwardItem[];
  skipPlacementIds?: string[];
}

// Human-readable flags on a carry-forward preview proposal (design §7).
const CF_FLAGS = {
  MEMBERSHIP_NOT_ACTIVE: 'membership-not-active',
  ALREADY_ACTIVE_IN_DESTINATION_YEAR: 'already-active-in-destination-year',
  NO_DESTINATION: 'no-destination',
  CLASS_NAME_CHANGED: 'class-name-changed',
} as const;

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

  // F.1 — bulk placement: an atomic, all-or-nothing batch of the single-create
  // semantics. Every membership is deduplicated, then revalidated inside ONE
  // transaction against the same invariants as single create (division must
  // belong to the institute + membership an active same-institute STUDENT),
  // then all rows are inserted together. Any violation — including the partial
  // unique index on (academic_year, membership) where status = 'active' — rolls
  // back the ENTIRE batch: partial placement is impossible.
  async createStudentPlacementsBulk(instituteId: string, input: { membershipIds: string[]; divisionId: string }) {
    if (input.membershipIds.length === 0) {
      throw new BadRequestException('At least one student must be selected');
    }
    const division = await this.getDivision(instituteId, input.divisionId);
    const academicYearId = division.academicYearId;
    const membershipIds = [...new Set(input.membershipIds)];

    return this.db.transaction(async (tx) => {
      for (const membershipId of membershipIds) {
        await this.requireActiveStudentMembership(instituteId, membershipId, tx);
      }
      try {
        return await tx
          .insert(studentPlacements)
          .values(membershipIds.map((membershipId) => ({ instituteId, membershipId, academicYearId, divisionId: division.id })))
          .returning();
      } catch (error) {
        this.throwIfUniqueViolation(error, 'One or more students already have an active placement in this academic year');
        throw error;
      }
    });
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

  // ── Q.4.2 — carry-forward (bulk promotion) ────────────────────────────
  //
  // A year-level operation: every ACTIVE placement in a source academic year
  // (optionally a single class) is proposed onward into a destination year.
  // PREVIEW is strictly read-only — it reports the proposal set, per-student
  // flags, and destination-division occupancy so an admin can review/adjust
  // before any mutation. COMMIT revalidates ALL relevant state inside its own
  // transaction (never trusting the preview) and applies archive+insert
  // atomically: any violation rolls the whole plan back. Chronology is decided
  // by academic-year `sort_order`, never name inference — a destination year
  // must sort strictly after the source year of EVERY carried placement
  // (§8.1/§10), so backward or same-year progression is impossible.

  async previewCarryForward(instituteId: string, input: CarryForwardPreviewOptions) {
    const sourceYear = await this.getAcademicYear(instituteId, input.sourceAcademicYearId);
    const destinationYear = await this.getAcademicYear(instituteId, input.destinationAcademicYearId);
    if (input.classId) await this.getAcademicClass(instituteId, input.classId);
    this.assertStrictForward(sourceYear.sortOrder, destinationYear.sortOrder);

    const placements = await this.db
      .select({
        id: studentPlacements.id,
        membershipId: studentPlacements.membershipId,
        divisionId: studentPlacements.divisionId,
        studentName: users.name,
        classId: classes.id,
        className: classes.name,
        divisionName: divisions.name,
      })
      .from(studentPlacements)
      .innerJoin(divisions, eq(studentPlacements.divisionId, divisions.id))
      .innerJoin(classes, eq(divisions.classId, classes.id))
      .innerJoin(memberships, eq(studentPlacements.membershipId, memberships.id))
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(studentPlacements.instituteId, instituteId),
          eq(studentPlacements.academicYearId, sourceYear.id),
          eq(studentPlacements.status, 'active'),
          ...(input.classId ? [eq(classes.id, input.classId)] : []),
        ),
      )
      .orderBy(asc(users.name));

    if (placements.length === 0) {
      return this.emptyPreview(input, sourceYear, destinationYear);
    }

    const membershipIds = [...new Set(placements.map((p) => p.membershipId))];
    const [memberStates, destActiveMembers, destDivisions, occupancyByDivision] = await Promise.all([
      this.membershipStudentStates(instituteId, membershipIds),
      this.activeMembersInYear(instituteId, destinationYear.id, membershipIds),
      this.destinationDivisions(instituteId, destinationYear.id),
      this.occupancyByDivision(instituteId, destinationYear.id),
    ]);

    // Auto-match: same class + same division name in the destination year. When
    // the class/division mapping changed, proposedDivisionId stays null and the
    // admin must pick (proposing a wrong-level class is never done silently).
    const destByClass = new Map<string, typeof destDivisions>();
    for (const d of destDivisions) {
      const list = destByClass.get(d.classId) ?? [];
      list.push(d);
      destByClass.set(d.classId, list);
    }

    const occupancy = new Map<
      string,
      { divisionName: string; className: string; current: number; projected: number }
    >();
    const summary = {
      total: placements.length,
      promotable: 0,
      noDestination: 0,
      alreadyActiveInDestinationYear: 0,
      membershipNotActive: 0,
    };

    const proposals = placements.map((placement) => {
      const state = memberStates.get(placement.membershipId);
      const membershipNotActive = !state?.active || !state.isStudent;
      const alreadyActive = destActiveMembers.has(placement.membershipId);
      const matched = destByClass.get(placement.classId)?.find((d) => d.name === placement.divisionName);

      const flags: string[] = [];
      if (membershipNotActive) flags.push(CF_FLAGS.MEMBERSHIP_NOT_ACTIVE);
      if (alreadyActive) flags.push(CF_FLAGS.ALREADY_ACTIVE_IN_DESTINATION_YEAR);
      if (!matched) {
        flags.push(CF_FLAGS.NO_DESTINATION);
        // Advisory: the class itself has no divisions in the destination year —
        // a rename/restructure signal, distinct from a plain section rename.
        if ((destByClass.get(placement.classId)?.length ?? 0) === 0) {
          flags.push(CF_FLAGS.CLASS_NAME_CHANGED);
        }
      }

      const promotable = Boolean(matched) && !membershipNotActive && !alreadyActive;
      if (promotable) summary.promotable += 1;
      if (!matched) summary.noDestination += 1;
      if (alreadyActive) summary.alreadyActiveInDestinationYear += 1;
      if (membershipNotActive) summary.membershipNotActive += 1;

      if (matched) {
        const target = occupancy.get(matched!.id) ?? {
          divisionName: matched!.name,
          className: matched!.className,
          current: occupancyByDivision.get(matched!.id) ?? 0,
          projected: occupancyByDivision.get(matched!.id) ?? 0,
        };
        if (promotable) target.projected += 1;
        occupancy.set(matched!.id, target);
      }

      return {
        placementId: placement.id,
        membershipId: placement.membershipId,
        studentName: placement.studentName,
        currentClassId: placement.classId,
        currentClassName: placement.className,
        currentDivisionId: placement.divisionId,
        currentDivisionName: placement.divisionName,
        proposedDivisionId: matched?.id ?? null,
        proposedClassName: matched?.className ?? null,
        proposedDivisionName: matched?.name ?? null,
        flags,
      };
    });

    return {
      sourceAcademicYearId: sourceYear.id,
      destinationAcademicYearId: destinationYear.id,
      classId: input.classId ?? null,
      proposals,
      occupancy: [...occupancy.entries()]
        .map(([divisionId, o]) => ({ divisionId, ...o }))
        .sort((a, b) => a.className.localeCompare(b.className) || a.divisionName.localeCompare(b.divisionName)),
      summary,
    };
  }

  /** Bulk promotion — all-or-nothing. Revalidates every item inside the
   *  transaction: source placement exists+ACTIVE+institute-scoped; destination
   *  division exists+institute-scoped+in the destination year+same class; the
   *  destination year sorts strictly after the source placement's year;
   *  membership still an active STUDENT; no existing ACTIVE placement in the
   *  destination year (also guarded by the partial unique index). The first
   *  violation throws → the whole plan rolls back; partial promotion is
   *  impossible. */
  async commitCarryForward(instituteId: string, input: CarryForwardCommitInput) {
    const itemPlacementIds = input.items.map((i) => i.placementId);
    if (new Set(itemPlacementIds).size !== itemPlacementIds.length) {
      throw new BadRequestException('A placement cannot appear twice in the carry-forward plan');
    }
    const skipSet = new Set(input.skipPlacementIds ?? []);
    for (const item of input.items) {
      if (skipSet.has(item.placementId)) {
        throw new BadRequestException('A placement cannot be both carried forward and skipped');
      }
    }

    return this.db.transaction(async (tx) => {
      const [destinationYear] = await tx
        .select()
        .from(academicYears)
        .where(
          and(
            eq(academicYears.id, input.destinationAcademicYearId),
            eq(academicYears.instituteId, instituteId),
          ),
        )
        .limit(1);
      if (!destinationYear) throw new NotFoundException('Destination academic year not found');

      const allPlacementIds = [...itemPlacementIds, ...(input.skipPlacementIds ?? [])];
      const sourceRows = allPlacementIds.length
        ? await tx
            .select({
              id: studentPlacements.id,
              membershipId: studentPlacements.membershipId,
              status: studentPlacements.status,
              studentName: users.name,
              classId: classes.id,
              sourceSortOrder: academicYears.sortOrder,
            })
            .from(studentPlacements)
            .innerJoin(divisions, eq(studentPlacements.divisionId, divisions.id))
            .innerJoin(academicYears, eq(studentPlacements.academicYearId, academicYears.id))
            .innerJoin(classes, eq(divisions.classId, classes.id))
            .innerJoin(memberships, eq(studentPlacements.membershipId, memberships.id))
            .innerJoin(users, eq(memberships.userId, users.id))
            .where(
              and(
                eq(studentPlacements.instituteId, instituteId),
                inArray(studentPlacements.id, allPlacementIds),
              ),
            )
        : [];
      const sourceById = new Map(sourceRows.map((r) => [r!.id, r]));

      const destDivisionIds = [...new Set(input.items.map((i) => i.destinationDivisionId))];
      const destDivisions = await tx
        .select()
        .from(divisions)
        .where(
          and(eq(divisions.instituteId, instituteId), inArray(divisions.id, destDivisionIds)),
        );
      const destById = new Map(destDivisions.map((d) => [d!.id, d]));

      for (const skipId of input.skipPlacementIds ?? []) {
        if (!sourceById.has(skipId)) {
          throw new NotFoundException(`Carry-forward rejected: skip placement ${skipId} not found`);
        }
      }

      const placements: Array<{
        id: string;
        instituteId: string;
        membershipId: string;
        academicYearId: string;
        divisionId: string;
        status: string;
      }> = [];
      for (const item of input.items) {
        const source = sourceById.get(item.placementId);
        if (!source) {
          throw new NotFoundException(`Carry-forward rejected: source placement ${item.placementId} not found`);
        }
        if (source.status !== 'active') {
          throw new ConflictException(
            `Carry-forward rejected: ${source.studentName}'s source placement is no longer active (already carried over or deactivated)`,
          );
        }

        const dest = destById.get(item.destinationDivisionId);
        if (!dest) {
          throw new NotFoundException(
            `Carry-forward rejected: destination division ${item.destinationDivisionId} not found`,
          );
        }
        if (dest.academicYearId !== destinationYear.id) {
          throw new BadRequestException(
            `Carry-forward rejected: ${source.studentName}'s destination division is not in the destination academic year`,
          );
        }
        if (dest.classId !== source.classId) {
          throw new BadRequestException(
            `Carry-forward rejected: ${source.studentName}'s destination division is in a different class — cross-class moves use the single transfer endpoint`,
          );
        }
        this.assertStrictForward(source.sourceSortOrder, destinationYear.sortOrder);

        await this.requireActiveStudentMembership(instituteId, source.membershipId, tx);

        const [occupied] = await tx
          .select({ id: studentPlacements.id })
          .from(studentPlacements)
          .where(
            and(
              eq(studentPlacements.instituteId, instituteId),
              eq(studentPlacements.academicYearId, destinationYear.id),
              eq(studentPlacements.membershipId, source.membershipId),
              eq(studentPlacements.status, 'active'),
            ),
          )
          .limit(1);
        if (occupied) {
          throw new ConflictException(
            `Carry-forward rejected: ${source.studentName} already has an active placement in the destination academic year`,
          );
        }

        await tx
          .update(studentPlacements)
          .set({ status: 'inactive', updatedAt: new Date() })
          .where(eq(studentPlacements.id, source.id));

        try {
          const [row] = await tx
            .insert(studentPlacements)
            .values({
              instituteId,
              membershipId: source.membershipId,
              academicYearId: destinationYear.id,
              divisionId: dest.id,
            })
            .returning();
          placements.push(row!);
        } catch (error) {
          this.throwIfUniqueViolation(
            error,
            `Carry-forward rejected: ${source.studentName} already has an active placement in the destination academic year`,
          );
          throw error;
        }
      }

      return { placements, skipPlacementIds: input.skipPlacementIds ?? [] };
    });
  }

  private assertStrictForward(sourceSortOrder: number, destinationSortOrder: number): void {
    if (sourceSortOrder >= destinationSortOrder) {
      throw new BadRequestException(
        'Destination academic year must be strictly after the source academic year',
      );
    }
  }

  private emptyPreview(input: CarryForwardPreviewOptions, sourceYear: { id: string }, destinationYear: { id: string }) {
    return {
      sourceAcademicYearId: sourceYear.id,
      destinationAcademicYearId: destinationYear.id,
      classId: input.classId ?? null,
      proposals: [],
      occupancy: [],
      summary: {
        total: 0,
        promotable: 0,
        noDestination: 0,
        alreadyActiveInDestinationYear: 0,
        membershipNotActive: 0,
      },
    };
  }

  private async membershipStudentStates(instituteId: string, membershipIds: string[]) {
    const rows = await this.db
      .select({
        membershipId: memberships.id,
        status: memberships.status,
        roleKey: roles.key,
      })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(membershipRoles.roleId, roles.id))
      .where(
        and(eq(memberships.instituteId, instituteId), inArray(memberships.id, membershipIds)),
      );
    const map = new Map<string, { active: boolean; isStudent: boolean }>();
    for (const row of rows) {
      const entry = map.get(row.membershipId) ?? { active: false, isStudent: false };
      if (row.status === 'active') entry.active = true;
      if (row.roleKey === STUDENT) entry.isStudent = true;
      map.set(row.membershipId, entry);
    }
    return map;
  }

  private async activeMembersInYear(instituteId: string, academicYearId: string, membershipIds: string[]) {
    const rows = await this.db
      .select({ membershipId: studentPlacements.membershipId })
      .from(studentPlacements)
      .where(
        and(
          eq(studentPlacements.instituteId, instituteId),
          eq(studentPlacements.academicYearId, academicYearId),
          eq(studentPlacements.status, 'active'),
          inArray(studentPlacements.membershipId, membershipIds),
        ),
      );
    return new Set(rows.map((r) => r.membershipId));
  }

  private async destinationDivisions(instituteId: string, academicYearId: string) {
    return this.db
      .select({
        id: divisions.id,
        classId: divisions.classId,
        name: divisions.name,
        className: classes.name,
      })
      .from(divisions)
      .innerJoin(classes, eq(divisions.classId, classes.id))
      .where(
        and(eq(divisions.instituteId, instituteId), eq(divisions.academicYearId, academicYearId)),
      );
  }

  private async occupancyByDivision(instituteId: string, academicYearId: string) {
    const rows = await this.db
      .select({
        divisionId: studentPlacements.divisionId,
        count: sql<number>`count(*)::int`,
      })
      .from(studentPlacements)
      .where(
        and(
          eq(studentPlacements.instituteId, instituteId),
          eq(studentPlacements.academicYearId, academicYearId),
          eq(studentPlacements.status, 'active'),
        ),
      )
      .groupBy(studentPlacements.divisionId);
    return new Map(rows.map((r) => [r.divisionId, r.count]));
  }

  private async getAcademicYear(instituteId: string, academicYearId: string) {
    const [row] = await this.db
      .select()
      .from(academicYears)
      .where(and(eq(academicYears.id, academicYearId), eq(academicYears.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Academic year not found');
    return row;
  }

  private async getAcademicClass(instituteId: string, classId: string) {
    const [row] = await this.db
      .select()
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Class not found');
    return row;
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

  private async requireActiveStudentMembership(
    instituteId: string,
    membershipId: string,
    q?: Pick<Database, 'select'>,
  ) {
    const db = q ?? this.db;
    const [membership] = await db
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