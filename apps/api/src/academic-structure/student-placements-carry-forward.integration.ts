import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, and, inArray } from 'drizzle-orm';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  academicYears,
  classes,
  divisions,
  users,
  memberships,
  membershipRoles,
  roles,
  studentPlacements,
} from '@catlium/database';

import { StudentPlacementsService } from './student-placements.service.ts';

// Phase Q.4.2 — carry-forward (bulk promotion) integration test
// (docs/architecture/academic-student-placement.md §7/§8/§10). Requires a live
// database: run with TEST_DATABASE_URL=postgresql://... (see .env). Skips
// cleanly when unset. Scratch data is created under unique slugs/names and
// removed afterwards. Exercises the documented progression model — FY 2026-27
// → SY 2027-28 → TY 2028-29 via academic-year sort_order.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

test('student placements carry-forward: preview non-mutating, strict-forward, isolation, flags, atomic commit, history retention', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const service = new StudentPlacementsService(db as unknown as Database);
  const scratchInstituteIds: string[] = [];
  const scratchUserIds: string[] = [];

  try {
    const [instA] = await db!.insert(institutes).values({ name: randomUUID(), slug: `cf-a-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instA.id);
    const [instB] = await db!.insert(institutes).values({ name: randomUUID(), slug: `cf-b-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instB.id);

    // FY 2026-27 → SY 2027-28 → TY 2028-29 progression via sort_order.
    const [fy] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'FY 2026-27', sortOrder: 1 }).returning();
    const [sy] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'SY 2027-28', sortOrder: 2 }).returning();
    const [ty] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'TY 2028-29', sortOrder: 3 }).returning();
    const [byear] = await db!.insert(academicYears).values({ instituteId: instB.id, name: 'B Year', sortOrder: 1 }).returning();

    const [cs] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Computer Science', sortOrder: 1 }).returning();
    const [secondClass] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Secondary', sortOrder: 2 }).returning();
    const [thirdClass] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Tertiary', sortOrder: 3 }).returning();
    const [bclass] = await db!.insert(classes).values({ instituteId: instB.id, name: 'B Class', sortOrder: 1 }).returning();

    const [fyA] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: fy.id, classId: cs.id, name: 'A' }).returning();
    const [fyB] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: fy.id, classId: secondClass.id, name: 'A' }).returning();
    const [fyC] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: fy.id, classId: thirdClass.id, name: 'A' }).returning();
    const [syA] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: sy.id, classId: cs.id, name: 'A' }).returning();
    const [syB] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: sy.id, classId: secondClass.id, name: 'B' }).returning();
    const [tyA] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: ty.id, classId: cs.id, name: 'A' }).returning();
    const [bdiv] = await db!.insert(divisions).values({ instituteId: instB.id, academicYearId: byear.id, classId: bclass.id, name: 'A' }).returning();

    const [studentRole] = await db!.select({ id: roles.id }).from(roles).where(eq(roles.key, 'STUDENT')).limit(1);
    const [teacherRole] = await db!.select({ id: roles.id }).from(roles).where(eq(roles.key, 'TEACHER')).limit(1);
    if (!studentRole || !teacherRole) throw new Error('STUDENT/TEACHER roles not seeded');

    const member = async (label: string, roleId: string, status = 'active') => {
      const [user] = await db!.insert(users).values({ email: randomUUID(), name: label, passwordHash: 'x' }).returning();
      scratchUserIds.push(user.id);
      const [m] = await db!.insert(memberships).values({ userId: user.id, instituteId: instA.id, status }).returning();
      await db!.insert(membershipRoles).values({ membershipId: m.id, roleId });
      return m.id;
    };
    const rawPlacement = async (membershipId: string, divisionId: string) => {
      const [row] = await db!
        .insert(studentPlacements)
        .values({ instituteId: instA.id, membershipId, academicYearId: (await db!.select().from(divisions).where(eq(divisions.id, divisionId)))[0]!.academicYearId, divisionId })
        .returning();
      return row!;
    };

    const s1 = await member('CF Student 1', studentRole.id);
    const s2 = await member('CF Student 2', studentRole.id);
    const s3 = await member('CF Student 3', studentRole.id);
    const s4 = await member('CF Student 4', studentRole.id);
    const s7 = await member('CF Student 7', studentRole.id);
    const s8 = await member('CF Student 8', studentRole.id);
    const s9 = await member('CF Student 9', studentRole.id);
    const s5 = await member('CF Inactive', studentRole.id, 'deactivated');
    const s6 = await member('CF Teacher', teacherRole.id);

    // Source (FY) placements: s1/s2/s3/s4/s7/s9 active students; s5 deactivated
    // membership; s6 a non-STUDENT placed historically. s4 also already holds an
    // ACTIVE SY placement (repeat/occupied destination); s8 is placed in TY only.
    const p1 = await service.createStudentPlacement(instA.id, { membershipId: s1, divisionId: fyA.id });
    const p2 = await service.createStudentPlacement(instA.id, { membershipId: s2, divisionId: fyA.id });
    const p3 = await service.createStudentPlacement(instA.id, { membershipId: s3, divisionId: fyB.id });
    const p4f = await service.createStudentPlacement(instA.id, { membershipId: s4, divisionId: fyA.id });
    await service.createStudentPlacement(instA.id, { membershipId: s4, divisionId: syA.id });
    const p7 = await service.createStudentPlacement(instA.id, { membershipId: s7, divisionId: fyA.id });
    await service.createStudentPlacement(instA.id, { membershipId: s9, divisionId: fyC.id });
    const p8ty = await service.createStudentPlacement(instA.id, { membershipId: s8, divisionId: tyA.id });
    const p5 = await rawPlacement(s5, fyA.id);
    const p6 = await rawPlacement(s6, fyA.id);

    const rowsFor = async (instituteId: string, membershipId?: string) => {
      const conditions = [eq(studentPlacements.instituteId, instituteId)];
      if (membershipId) conditions.push(eq(studentPlacements.membershipId, membershipId));
      return db!.select().from(studentPlacements).where(and(...conditions));
    };

    // ── strict-forward + institute isolation (preview never mutates, so these
    // rejections are free of side effects) ────────────────────────────────
    await assert.rejects(
      service.previewCarryForward(instA.id, { sourceAcademicYearId: sy.id, destinationAcademicYearId: fy.id }),
      BadRequestException,
    );
    await assert.rejects(
      service.previewCarryForward(instA.id, { sourceAcademicYearId: fy.id, destinationAcademicYearId: fy.id }),
      BadRequestException,
    );
    await assert.rejects(
      service.previewCarryForward(instA.id, { sourceAcademicYearId: fy.id, destinationAcademicYearId: byear.id }),
      NotFoundException,
    );
    await assert.rejects(
      service.previewCarryForward(instA.id, { sourceAcademicYearId: byear.id, destinationAcademicYearId: sy.id }),
      NotFoundException,
    );
    await assert.rejects(
      service.previewCarryForward(instA.id, { sourceAcademicYearId: fy.id, destinationAcademicYearId: sy.id, classId: bclass.id }),
      NotFoundException,
    );

    // ── preview is non-mutating and reports proposals + flags + occupancy ──
    const before = await rowsFor(instA.id);
    const preview = await service.previewCarryForward(instA.id, { sourceAcademicYearId: fy.id, destinationAcademicYearId: sy.id });
    const after = await rowsFor(instA.id);
    assert.equal(after.length, before.length, 'preview must never mutate placement rows');

    assert.equal(preview.sourceAcademicYearId, fy.id);
    assert.equal(preview.destinationAcademicYearId, sy.id);
    assert.equal(preview.classId, null);
    assert.equal(preview.summary.total, 8);

    const proposalOf = (membershipId: string) => preview.proposals.find((p: { membershipId: string }) => p.membershipId === membershipId)!;

    // auto-match by same class + same division name → syA
    const p1Proposal = proposalOf(s1);
    assert.equal(p1Proposal.proposedDivisionId, syA.id);
    assert.equal(p1Proposal.proposedClassName, 'Computer Science');
    assert.equal(p1Proposal.proposedDivisionName, 'A');
    assert.deepEqual(p1Proposal.flags, []);
    assert.deepEqual(proposalOf(s2).flags, []);

    // s3: same class exists in SY but the section was renamed (no 'A') → no-destination
    assert.deepEqual(proposalOf(s3).flags, ['no-destination']);
    assert.equal(proposalOf(s3).proposedDivisionId, null);

    // s9: the class has NO divisions in SY at all → no-destination + class-name-changed
    assert.deepEqual(proposalOf(s9).flags.sort(), ['class-name-changed', 'no-destination']);
    assert.equal(proposalOf(s9).proposedDivisionId, null);

    // s4: already ACTIVE in the destination year → already-active-in-destination-year
    assert.equal(proposalOf(s4).proposedDivisionId, syA.id);
    assert.deepEqual(proposalOf(s4).flags, ['already-active-in-destination-year']);

    // s5 deactivated + s6 non-STUDENT → membership-not-active
    assert.deepEqual(proposalOf(s5).flags, ['membership-not-active']);
    assert.deepEqual(proposalOf(s6).flags, ['membership-not-active']);

    assert.equal(preview.summary.promotable, 3);
    assert.equal(preview.summary.noDestination, 2);
    assert.equal(preview.summary.alreadyActiveInDestinationYear, 1);
    assert.equal(preview.summary.membershipNotActive, 2);

    // occupancy: syA currently holds only s4 (1); projected adds s1/s2/s7 (+3)
    const syAOccupancy = preview.occupancy.find((o: { divisionId: string }) => o.divisionId === syA.id)!;
    assert.equal(syAOccupancy.current, 1);
    assert.equal(syAOccupancy.projected, 4);

    // class filter narrows the proposal set
    const filtered = await service.previewCarryForward(instA.id, { sourceAcademicYearId: fy.id, destinationAcademicYearId: sy.id, classId: cs.id });
    assert.equal(filtered.summary.total, 6);

    // ── valid forward commit: archive source, create ACTIVE at destination ──
    const commit = await service.commitCarryForward(instA.id, {
      destinationAcademicYearId: sy.id,
      items: [
        { placementId: p1.id, destinationDivisionId: syA.id },
        { placementId: p2.id, destinationDivisionId: syA.id },
      ],
      skipPlacementIds: [p3.id],
    });
    assert.equal(commit.placements.length, 2);
    assert.equal(commit.skipPlacementIds.length, 1);
    assert.ok(commit.placements.every((p: { status: string }) => p.status === 'active'));
    assert.ok(commit.placements.every((p: { academicYearId: string }) => p.academicYearId === sy.id));
    assert.ok(commit.placements.every((p: { divisionId: string }) => p.divisionId === syA.id));

    // historical retention: source rows kept (inactive), skipped row kept ACTIVE
    const p1Row = (await rowsFor(instA.id, s1)).find((r) => r.id === p1.id)!;
    assert.equal(p1Row.status, 'inactive');
    const p3Row = (await rowsFor(instA.id, s3)).find((r) => r.id === p3.id)!;
    assert.equal(p3Row.status, 'active');

    // exactly one ACTIVE placement per (student, year): s1 → SY active only
    const s1Rows = await rowsFor(instA.id, s1);
    assert.equal(s1Rows.filter((r) => r.status === 'active').length, 1);
    assert.equal(s1Rows.filter((r) => r.status === 'active')[0]!.academicYearId, sy.id);

    // ── commit revalidation + atomic all-or-nothing rollback ─────────────
    // valid item s7 first, then a conflicting item (s4 already in SY) → the whole
    // plan rolls back: s7's source placement survives, nothing lands in SY.
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [
          { placementId: p7.id, destinationDivisionId: syA.id },
          { placementId: p4f.id, destinationDivisionId: syA.id },
        ],
      }),
      ConflictException,
    );
    const s7Rows = await rowsFor(instA.id, s7);
    assert.equal(s7Rows.length, 1, 'rollback must leave the source placement untouched');
    assert.equal(s7Rows[0]!.status, 'active', 'rollback must not archive the valid item');
    assert.ok(!s7Rows.some((r) => r.academicYearId === sy.id), 'rollback must not create a destination placement');

    // already-carried placements (now inactive) can never be carried again
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: ty.id,
        items: [{ placementId: p1.id, destinationDivisionId: tyA.id }],
      }),
      ConflictException,
    );

    // cross-institute destination division → 404
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [{ placementId: p7.id, destinationDivisionId: bdiv.id }],
      }),
      NotFoundException,
    );

    // cross-institute destination year → 404
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: byear.id,
        items: [{ placementId: p7.id, destinationDivisionId: bdiv.id }],
      }),
      NotFoundException,
    );

    // destination division not in the destination year → 400
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [{ placementId: p7.id, destinationDivisionId: fyA.id }],
      }),
      BadRequestException,
    );

    // destination division in a different class → 400 (cross-class = single transfer)
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [{ placementId: p7.id, destinationDivisionId: syB.id }],
      }),
      BadRequestException,
    );

    // backward progression (TY → SY) → 400
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [{ placementId: p8ty.id, destinationDivisionId: syA.id }],
      }),
      BadRequestException,
    );

    // deactivated membership and non-STUDENT source → 400
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [{ placementId: p5.id, destinationDivisionId: syA.id }],
      }),
      BadRequestException,
    );
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [{ placementId: p6.id, destinationDivisionId: syA.id }],
      }),
      BadRequestException,
    );

    // duplicate placement in the plan → 400 (rejected before the transaction)
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [
          { placementId: p7.id, destinationDivisionId: syA.id },
          { placementId: p7.id, destinationDivisionId: syA.id },
        ],
      }),
      BadRequestException,
    );

    // same placement both carried and skipped → 400
    await assert.rejects(
      service.commitCarryForward(instA.id, {
        destinationAcademicYearId: sy.id,
        items: [{ placementId: p7.id, destinationDivisionId: syA.id }],
        skipPlacementIds: [p7.id],
      }),
      BadRequestException,
    );

    // ── multi-year forward is allowed: FY → TY directly (skip a year) ──────
    const jump = await service.commitCarryForward(instA.id, {
      destinationAcademicYearId: ty.id,
      items: [{ placementId: p7.id, destinationDivisionId: tyA.id }],
    });
    assert.equal(jump.placements.length, 1);
    assert.equal(jump.placements[0]!.academicYearId, ty.id);
    const s7RowsAfter = await rowsFor(instA.id, s7);
    assert.equal(s7RowsAfter.find((r) => r.id === p7.id)!.status, 'inactive');
    assert.equal(s7RowsAfter.filter((r) => r.status === 'active').length, 1);
    assert.equal(s7RowsAfter.filter((r) => r.status === 'active')[0]!.academicYearId, ty.id);
    assert.ok(s7RowsAfter.every((r) => r.academicYearId !== sy.id), 'jump over SY must not create an SY row');

    // s9 (class with no destination in ANY later year) stays put in FY
    const s9Rows = await rowsFor(instA.id, s9);
    assert.equal(s9Rows.length, 1);
    assert.equal(s9Rows[0]!.status, 'active');

    // ── final invariant sweep: one ACTIVE per (student, year); history kept ──
    const s2Rows = await rowsFor(instA.id, s2);
    assert.equal(s2Rows.filter((r) => r.status === 'active').length, 1);
    assert.equal(s2Rows.filter((r) => r.status === 'inactive').length, 1);
    const s5Rows = await rowsFor(instA.id, s5);
    assert.equal(s5Rows.length, 1, 'deactivated student history is retained');
    const all = await rowsFor(instA.id);
    assert.equal(all.filter((r) => r.status === 'active').length, 10);
  } finally {
    await db!.delete(users).where(inArray(users.id, scratchUserIds));
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstituteIds));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});