import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  subjects,
  classes,
  classSubjects,
  users,
  memberships,
  membershipRoles,
  roles,
} from '@catlium/database';

import { TeacherAssignmentsService } from './teacher-assignments.service.ts';

// Integration test for Phase F (TeacherAssignmentsService). Requires a live
// database: run with TEST_DATABASE_URL=postgresql://... (see .env). Skips
// cleanly when unset so the default `pnpm test` run needs no database.
// Scratch data is created under unique slugs/names and removed afterwards.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

test('teacher assignments: create, duplicate, non-teacher, cross-tenant, list, get, deactivate', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const service = new TeacherAssignmentsService(svc);
  const scratchInstituteIds: string[] = [];
  const scratchUserIds: string[] = [];

  try {
    const [instA] = await db!.insert(institutes).values({ name: randomUUID(), slug: `pf-a-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instA.id);
    const [instB] = await db!.insert(institutes).values({ name: randomUUID(), slug: `pf-b-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instB.id);

    const [classA] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Phase F Class A' }).returning();
    const [classB] = await db!.insert(classes).values({ instituteId: instB.id, name: 'Phase F Class B' }).returning();

    const [subA1] = await db!.insert(subjects).values({ instituteId: instA.id, name: 'Phy', slug: randomUUID() }).returning();
    const [subA2] = await db!.insert(subjects).values({ instituteId: instA.id, name: 'Chem', slug: randomUUID() }).returning();
    const [subB1] = await db!.insert(subjects).values({ instituteId: instB.id, name: 'Bio', slug: randomUUID() }).returning();

    const [csA1] = await db!.insert(classSubjects).values({ classId: classA.id, subjectId: subA1.id }).returning();
    const [csA2] = await db!.insert(classSubjects).values({ classId: classA.id, subjectId: subA2.id }).returning();
    const [csB1] = await db!.insert(classSubjects).values({ classId: classB.id, subjectId: subB1.id }).returning();

    const [teacherRole] = await db!
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'TEACHER'))
      .limit(1);
    if (!teacherRole) throw new Error('TEACHER role not seeded');

    const [studentRole] = await db!
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'STUDENT'))
      .limit(1);
    if (!studentRole) throw new Error('STUDENT role not seeded');

    const member = async (instituteId: string, name: string, roleId: string) => {
      const [user] = await db!.insert(users).values({ email: randomUUID(), name, passwordHash: 'x' }).returning();
      scratchUserIds.push(user.id);
      const [m] = await db!.insert(memberships).values({ userId: user.id, instituteId }).returning();
      await db!.insert(membershipRoles).values({ membershipId: m.id, roleId });
      return m.id;
    };

    const teacherA = await member(instA.id, 'Teacher A', teacherRole.id);
    const teacherB = await member(instB.id, 'Teacher B', teacherRole.id);
    const studentA = await member(instA.id, 'Student A', studentRole.id);

    // duplicate + cross-tenant + non-teacher cases share the same institute —
    // each rejection below leaves committed rows behind that later cases expect.
    const baseAt = await service.createTeacherAssignment(instA.id, { membershipId: teacherA, classSubjectId: csA1.id });
    assert.equal(baseAt.instituteId, instA.id);
    assert.equal(baseAt.status, 'active');

    await assert.rejects(
      service.createTeacherAssignment(instA.id, { membershipId: teacherA, classSubjectId: csA1.id }),
      ConflictException,
    );

    const secondAt = await service.createTeacherAssignment(instA.id, { membershipId: teacherA, classSubjectId: csA2.id });
    assert.equal(secondAt.classSubjectId, csA2.id);

    const teacherC = await member(instA.id, 'Teacher C', teacherRole.id);
    await service.createTeacherAssignment(instA.id, { membershipId: teacherC, classSubjectId: csA1.id });

    await assert.rejects(
      service.createTeacherAssignment(instA.id, { membershipId: studentA, classSubjectId: csA2.id }),
      BadRequestException,
    );

    await assert.rejects(
      service.createTeacherAssignment(instA.id, { membershipId: teacherB, classSubjectId: csA1.id }),
      BadRequestException,
    );

    await assert.rejects(
      service.createTeacherAssignment(instA.id, { membershipId: teacherA, classSubjectId: csB1.id }),
      NotFoundException,
    );

    const fetched = await service.getTeacherAssignment(instA.id, baseAt.id);
    assert.equal(fetched.id, baseAt.id);
    await assert.rejects(service.getTeacherAssignment(instB.id, baseAt.id), NotFoundException);

    const all = await service.listTeacherAssignments(instA.id);
    assert.equal(all.length, 3);
    const byCs = await service.listTeacherAssignments(instA.id, { classSubjectId: csA1.id });
    assert.equal(byCs.length, 2);

    const deactivated = await service.deactivateTeacherAssignment(instA.id, baseAt.id);
    assert.equal(deactivated.status, 'inactive');
    const recreated = await service.createTeacherAssignment(instA.id, { membershipId: teacherA, classSubjectId: csA1.id });
    assert.equal(recreated.status, 'active');
  } finally {
    // Clean up scratch data: institutes cascade academic rows + memberships;
    // users are removed explicitly (no tenant FK).
    await db!.delete(users).where(inArray(users.id, scratchUserIds));
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstituteIds));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});