import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

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

// Integration test for Phase G (StudentPlacementsService). Requires a live
// database: run with TEST_DATABASE_URL=postgresql://... (see .env). Skips
// cleanly when unset so the default `pnpm test` run needs no database.
// Scratch data is created under unique slugs/names and removed afterwards.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

test('student placements: create, role/inactive/cross-tenant rejection, consistency, duplicate, historical, deactivate, transfer', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const service = new StudentPlacementsService(svc);
  const scratchInstituteIds: string[] = [];
  const scratchUserIds: string[] = [];

  try {
    const [instA] = await db!.insert(institutes).values({ name: randomUUID(), slug: `pg-a-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instA.id);
    const [instB] = await db!.insert(institutes).values({ name: randomUUID(), slug: `pg-b-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instB.id);

    const [year1A] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'Phase G Year 1' }).returning();
    const [year2A] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'Phase G Year 2' }).returning();
    const [yearB] = await db!.insert(academicYears).values({ instituteId: instB.id, name: 'Phase G Year B' }).returning();

    const [classA] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Phase G Class A' }).returning();
    const [classB] = await db!.insert(classes).values({ instituteId: instB.id, name: 'Phase G Class B' }).returning();

    const [divA1] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: year1A.id, classId: classA.id, name: 'A' }).returning();
    const [divA1b] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: year1A.id, classId: classA.id, name: 'B' }).returning();
    const [divA2] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: year2A.id, classId: classA.id, name: 'A' }).returning();
    const [divB] = await db!.insert(divisions).values({ instituteId: instB.id, academicYearId: yearB.id, classId: classB.id, name: 'A' }).returning();

    const [studentRole] = await db!
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'STUDENT'))
      .limit(1);
    if (!studentRole) throw new Error('STUDENT role not seeded');

    const [teacherRole] = await db!
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'TEACHER'))
      .limit(1);
    if (!teacherRole) throw new Error('TEACHER role not seeded');

    const member = async (instituteId: string, name: string, roleId: string, status = 'active') => {
      const [user] = await db!.insert(users).values({ email: randomUUID(), name, passwordHash: 'x' }).returning();
      scratchUserIds.push(user.id);
      const [m] = await db!.insert(memberships).values({ userId: user.id, instituteId, status }).returning();
      await db!.insert(membershipRoles).values({ membershipId: m.id, roleId });
      return m.id;
    };

    const studentA = await member(instA.id, 'Student A', studentRole.id);
    const studentInactive = await member(instA.id, 'Student Inactive', studentRole.id, 'deactivated');
    const teacherA = await member(instA.id, 'Teacher A', teacherRole.id);
    const studentB = await member(instB.id, 'Student B', studentRole.id);

    // create + year derived server-side from the division (never client-trusted)
    const p1 = await service.createStudentPlacement(instA.id, { membershipId: studentA, divisionId: divA1.id });
    assert.equal(p1.status, 'active');
    assert.equal(p1.academicYearId, year1A.id);
    assert.equal(p1.divisionId, divA1.id);

    // a second active placement in a DIFFERENT year is allowed (promotion basis)
    const p2 = await service.createStudentPlacement(instA.id, { membershipId: studentA, divisionId: divA2.id });
    assert.equal(p2.academicYearId, year2A.id);
    assert.equal(p2.status, 'active');

    // duplicate active placement for the same (student, year) → Conflict
    await assert.rejects(
      service.createStudentPlacement(instA.id, { membershipId: studentA, divisionId: divA1.id }),
      ConflictException,
    );
    await assert.rejects(
      service.createStudentPlacement(instA.id, { membershipId: studentA, divisionId: divA2.id }),
      ConflictException,
    );

    // non-STUDENT role → BadRequest
    await assert.rejects(
      service.createStudentPlacement(instA.id, { membershipId: teacherA, divisionId: divA1.id }),
      BadRequestException,
    );

    // inactive membership → BadRequest
    await assert.rejects(
      service.createStudentPlacement(instA.id, { membershipId: studentInactive, divisionId: divA1.id }),
      BadRequestException,
    );

    // cross-tenant membership → BadRequest
    await assert.rejects(
      service.createStudentPlacement(instA.id, { membershipId: studentB, divisionId: divA1.id }),
      BadRequestException,
    );

    // cross-tenant division → NotFound (and reverse direction)
    await assert.rejects(
      service.createStudentPlacement(instA.id, { membershipId: studentA, divisionId: divB.id }),
      NotFoundException,
    );
    await assert.rejects(
      service.createStudentPlacement(instB.id, { membershipId: studentB, divisionId: divA1.id }),
      NotFoundException,
    );

    // get: tenant-scoped, enriched with names
    const p1Get = await service.getStudentPlacement(instA.id, p1.id);
    assert.equal(p1Get.id, p1.id);
    assert.equal(p1Get.studentName, 'Student A');
    assert.equal(p1Get.academicYearName, 'Phase G Year 1');
    assert.equal(p1Get.divisionName, 'A');
    await assert.rejects(service.getStudentPlacement(instB.id, p1.id), NotFoundException);

    // list: scoped + filters
    const all = await service.listStudentPlacements(instA.id);
    assert.equal(all.length, 2);
    const byDivision = await service.listStudentPlacements(instA.id, { divisionId: divA1.id });
    assert.equal(byDivision.length, 1);
    const byMember = await service.listStudentPlacements(instA.id, { membershipId: studentA });
    assert.equal(byMember.length, 2);
    const byYear = await service.listStudentPlacements(instA.id, { academicYearId: year2A.id });
    assert.equal(byYear.length, 1);

    // deactivate → soft, row retained
    const deactivated = await service.deactivateStudentPlacement(instA.id, p1.id);
    assert.equal(deactivated.status, 'inactive');
    assert.equal((await service.getStudentPlacement(instA.id, p1.id)).status, 'inactive');

    // re-placement in the same year after deactivation (history + fresh row)
    const p3 = await service.createStudentPlacement(instA.id, { membershipId: studentA, divisionId: divA1.id });
    assert.equal(p3.status, 'active');
    assert.equal(p3.academicYearId, year1A.id);

    // transfer into a year where the student holds an ACTIVE placement → Conflict,
    // and the current placement stays active (transaction rolled back)
    await assert.rejects(
      service.transferStudentPlacement(instA.id, p3.id, { divisionId: divA2.id }),
      ConflictException,
    );
    assert.equal((await service.getStudentPlacement(instA.id, p3.id)).status, 'active');

    // deactivate the year-2 placement so a transfer into year 2 is legal
    await service.deactivateStudentPlacement(instA.id, p2.id);

    // transfer: old row deactivated, fresh row created at the target year
    const p4 = await service.transferStudentPlacement(instA.id, p3.id, { divisionId: divA2.id });
    assert.equal(p4.status, 'active');
    assert.equal(p4.academicYearId, year2A.id);
    assert.equal(p4.divisionId, divA2.id);
    assert.equal((await service.getStudentPlacement(instA.id, p3.id)).status, 'inactive');

    // cross-year transfer back (promotion/movement across years)
    const p5 = await service.transferStudentPlacement(instA.id, p4.id, { divisionId: divA1.id });
    assert.equal(p5.academicYearId, year1A.id);
    assert.equal((await service.getStudentPlacement(instA.id, p4.id)).status, 'inactive');

    // same-year division movement keeps the year
    const p6 = await service.transferStudentPlacement(instA.id, p5.id, { divisionId: divA1b.id });
    assert.equal(p6.academicYearId, year1A.id);
    assert.equal(p6.divisionId, divA1b.id);
    assert.equal((await service.getStudentPlacement(instA.id, p5.id)).status, 'inactive');

    // final history: 6 retained rows, exactly 1 active (the last transfer target)
    const rows = await db!.select({ status: studentPlacements.status }).from(studentPlacements).where(eq(studentPlacements.instituteId, instA.id));
    assert.equal(rows.length, 6);
    assert.equal(rows.filter((r) => r.status === 'active').length, 1);
  } finally {
    // Clean up scratch data: institutes cascade academic rows + memberships;
    // users are removed explicitly (no tenant FK).
    await db!.delete(users).where(inArray(users.id, scratchUserIds));
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstituteIds));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});