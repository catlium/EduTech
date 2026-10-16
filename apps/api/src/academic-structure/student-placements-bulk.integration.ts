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

// F.1 — bulk placement integration test: an atomic multi-student placement into
// ONE division. Requires a live database: TEST_DATABASE_URL (see .env). Skips
// cleanly when unset. Scratch data is created under unique slugs/names and
// removed afterwards. Exercises dedup, institute isolation, active-STUDENT
// membership validation, and all-or-nothing rollback when any member conflicts
// with the partial unique index. Single-create behavior is untouched (covered
// in student-placements.integration.ts).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

test('student placements bulk: multiple create, duplicate dedup, atomic rollback on any conflict, member validation, isolation', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const service = new StudentPlacementsService(svc);
  const scratchInstituteIds: string[] = [];
  const scratchUserIds: string[] = [];

  try {
    const [instA] = await db!.insert(institutes).values({ name: randomUUID(), slug: `pgbulk-a-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instA.id);
    const [instB] = await db!.insert(institutes).values({ name: randomUUID(), slug: `pgbulk-b-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instB.id);

    const [year1A] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'Bulk Year 1' }).returning();
    const [year2A] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'Bulk Year 2' }).returning();
    const [yearB] = await db!.insert(academicYears).values({ instituteId: instB.id, name: 'Bulk Year B' }).returning();

    const [classA] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Bulk Class A' }).returning();
    const [classB] = await db!.insert(classes).values({ instituteId: instB.id, name: 'Bulk Class B' }).returning();

    const [divA1] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: year1A.id, classId: classA.id, name: 'A' }).returning();
    const [divA2] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: year2A.id, classId: classA.id, name: 'A' }).returning();
    const [divB1] = await db!.insert(divisions).values({ instituteId: instB.id, academicYearId: yearB.id, classId: classB.id, name: 'A' }).returning();

    const [studentRole] = await db!.select({ id: roles.id }).from(roles).where(eq(roles.key, 'STUDENT')).limit(1);
    const [teacherRole] = await db!.select({ id: roles.id }).from(roles).where(eq(roles.key, 'TEACHER')).limit(1);
    if (!studentRole || !teacherRole) throw new Error('STUDENT/TEACHER roles not seeded');

    const member = async (instituteId: string, name: string, roleId: string, status = 'active') => {
      const [user] = await db!.insert(users).values({ email: randomUUID(), name, passwordHash: 'x' }).returning();
      scratchUserIds.push(user.id);
      const [m] = await db!.insert(memberships).values({ userId: user.id, instituteId, status }).returning();
      await db!.insert(membershipRoles).values({ membershipId: m.id, roleId });
      return m.id;
    };

    const s1 = await member(instA.id, 'Bulk Student 1', studentRole.id);
    const s2 = await member(instA.id, 'Bulk Student 2', studentRole.id);
    const s3 = await member(instA.id, 'Bulk Student 3', studentRole.id);
    const s4 = await member(instA.id, 'Bulk Student 4', studentRole.id);
    const inactiveA = await member(instA.id, 'Bulk Inactive', studentRole.id, 'deactivated');
    const teacherA = await member(instA.id, 'Bulk Teacher', teacherRole.id);
    const studentB = await member(instB.id, 'Bulk Student B', studentRole.id);

    // happy path: three members in one atomic call → three ACTIVE rows, year derived
    const created = await service.createStudentPlacementsBulk(instA.id, { membershipIds: [s1, s2, s3], divisionId: divA1.id });
    assert.equal(created.length, 3);
    assert.ok(created.every((p) => p.status === 'active' && p.academicYearId === year1A.id && p.divisionId === divA1.id));

    // duplicate IDs in one request are deduplicated deterministically (no double insert)
    const deduped = await service.createStudentPlacementsBulk(instA.id, { membershipIds: [s4, s4, s1, s4], divisionId: divA2.id });
    assert.equal(deduped.length, 2); // s4 once + s1 once
    assert.equal(new Set(deduped.map((p) => p.membershipId)).size, 2);

    // already-placed conflict (s1 has an ACTIVE divA2 row) → complete rollback:
    // the conflicting row AND any sibling rows are all absent.
    await assert.rejects(
      service.createStudentPlacementsBulk(instA.id, { membershipIds: [s2, s1, s3], divisionId: divA2.id }),
      ConflictException,
    );
    const none = await db!.select().from(studentPlacements).where(
      and(
        eq(studentPlacements.instituteId, instA.id),
        eq(studentPlacements.academicYearId, year2A.id),
        inArray(studentPlacements.membershipId, [s2, s3]),
      ),
    );
    assert.equal(none.length, 0, 'rollback: sibling members must not have a year-2 row');

    // single-create still works after bulk (both paths coexist)
    const single = await service.createStudentPlacement(instA.id, { membershipId: s2, divisionId: divA2.id });
    assert.equal(single.status, 'active');

    // inactive student rejected → no rows written
    await assert.rejects(
      service.createStudentPlacementsBulk(instA.id, { membershipIds: [inactiveA], divisionId: divA1.id }),
      BadRequestException,
    );

    // non-STUDENT member rejected
    await assert.rejects(
      service.createStudentPlacementsBulk(instA.id, { membershipIds: [teacherA], divisionId: divA1.id }),
      BadRequestException,
    );

    // foreign (other-institute) membership rejected
    await assert.rejects(
      service.createStudentPlacementsBulk(instA.id, { membershipIds: [studentB], divisionId: divA1.id }),
      BadRequestException,
    );

    // cross-institute isolation: B cannot place A members, A cannot use B members;
    // A's own bulk stays scoped to A.
    await assert.rejects(
      service.createStudentPlacementsBulk(instB.id, { membershipIds: [s1], divisionId: divB1.id }),
      BadRequestException,
    );
    await assert.rejects(
      service.createStudentPlacementsBulk(instA.id, { membershipIds: [s2], divisionId: divB1.id }),
      NotFoundException,
    );
    const bRows = await db!.select().from(studentPlacements).where(eq(studentPlacements.instituteId, instB.id));
    assert.equal(bRows.length, 0, 'isolation: instB must hold no placement rows');

    // invalid (foreign cross-institute) division + valid members → 404, no rows
    await assert.rejects(
      service.createStudentPlacementsBulk(instA.id, { membershipIds: [s3], divisionId: divB1.id }),
      NotFoundException,
    );

    // empty membership list rejected (controller ArrayNotEmpty, service defensive)
    await assert.rejects(
      service.createStudentPlacementsBulk(instA.id, { membershipIds: [], divisionId: divA2.id }),
      BadRequestException,
    );
  } finally {
    // Clean up scratch data: institutes cascade academic rows + memberships;
    // users are removed explicitly (no tenant FK).
    await db!.delete(users).where(inArray(users.id, scratchUserIds));
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstituteIds));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});