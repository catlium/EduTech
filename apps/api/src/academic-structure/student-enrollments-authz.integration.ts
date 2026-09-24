import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  roles,
  institutes,
  academicYears,
  classes,
  divisions,
  subjects,
  classSubjects,
  studentPlacements,
  studentSubjectEnrollments,
} from '@catlium/database';
import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from '../authorization/permissions.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RolesService } from '../authorization/roles.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { StudentSubjectEnrollmentsController } from './student-enrollments.controller.ts';
import { StudentSubjectEnrollmentsService } from './student-enrollments.service.ts';

// Phase E.1 — student enrollment-override guard matrix (D-Q4.10). Migrates the
// enrollment override surface (subject ENROLLED/EXCLUDED admin) from role-only
// `@RequiredRoles(INSTITUTE_ADMIN)` to the standard guarded stack
// (AccessTokenGuard → TenantGuard → RolesGuard → PermissionGuard) with the
// catalogued `assignments.*` keys — list=`assignments.read`,
// create=`assignments.create`, remove=`assignments.delete` — reusing the
// sibling student-placement (Q.4.1) family without new keys. Runs the REAL
// guard chain against the REAL StudentSubjectEnrollmentsController handlers,
// proving the declarative matrix AND that an authorized caller's request
// reaches the DB with the service invariants intact:
//   - INSTITUTE_ADMIN passes via the built-in assignments.manage grant
//   - delegated custom roles obey exactly their granted sub-actions
//   - TEACHER/STUDENT default-deny (override data never reaches class users)
//   - zero-role membership default-deny
//   - no stale @RequiredRoles('INSTITUTE_ADMIN') metadata remains
//   - cross-institute isolation of custom-role grants
//   - service invariants untouched: active placement required (400), same-
//     institute subject (404), ENROLLED/EXCLUDED class-offering validation,
//     duplicate (placement,subject) → 409, remove = row deletion (revert to
//     class default).
// Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
// unset. Permission/role seeds come from PermissionSyncService (idempotent).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'student-enrollments-authz-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

const LIST = StudentSubjectEnrollmentsController.prototype.list;
const CREATE = StudentSubjectEnrollmentsController.prototype.create;
const DELETE = StudentSubjectEnrollmentsController.prototype.remove;

function reqContext(handler: unknown, request: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const req = { headers: {}, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler as unknown as (...args: unknown[]) => unknown,
    getClass: () => StudentSubjectEnrollmentsController,
  } as unknown as ExecutionContext;
}

const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const rolesGuard = () => new RolesGuard(new Reflector());
const permGuard = () => new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

async function runChain(handler: unknown, request: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const ctx = reqContext(handler, request);
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  rolesGuard().canActivate(ctx); // stale-role check: must be a no-op now
  await permGuard().canActivate(ctx);
  return ctx.switchToHttp().getRequest() as Record<string, unknown>;
}

test('E.1 student-enrollment-override guard matrix', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  const roleRows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']));
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));

  const suffix = randomUUID().slice(0, 8);
  const [instA] = await db!.insert(institutes).values({ name: `SE A ${suffix}`, slug: `se-a-${suffix}` }).returning();
  const [instB] = await db!.insert(institutes).values({ name: `SE B ${suffix}`, slug: `se-b-${suffix}` }).returning();

  const makeUser = async (label: string) => {
    const [user] = await db!.insert(users).values({ email: `${label}-${suffix}@example.test`, name: label, passwordHash: 'x' }).returning();
    return user!;
  };
  const grantMembership = async (instituteId: string, userId: string, roleKeys: string[]) => {
    const [membership] = await db!.insert(memberships).values({ userId, instituteId }).returning();
    for (const key of roleKeys) {
      await db!.insert(membershipRoles).values({ membershipId: membership!.id, roleId: roleIds[key]! });
    }
    return membership!;
  };
  const liveSession = async (userId: string) => {
    const [row] = await db!
      .insert(authSessions)
      .values({ userId, refreshTokenHash: `e1-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    return row!.id;
  };

  const admin = await makeUser('se_admin');
  const teacher = await makeUser('se_teacher');
  const student = await makeUser('se_student');
  const zeroRole = await makeUser('se_zerorole');
  const delegateRead = await makeUser('se_delegate_read');
  const delegateCreate = await makeUser('se_delegate_create');
  const delegateDelete = await makeUser('se_delegate_delete');
  const crossDelegate = await makeUser('se_cross_delegate');

  await grantMembership(instA!.id, admin!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instA!.id, teacher!.id, ['TEACHER']);
  await grantMembership(instA!.id, student!.id, ['STUDENT']);
  await grantMembership(instA!.id, zeroRole!.id, []);
  for (const u of [delegateRead, delegateCreate, delegateDelete]) {
    await grantMembership(instA!.id, u!.id, ['TEACHER']); // union base, overridden per case
  }
  await grantMembership(instB!.id, crossDelegate!.id, ['TEACHER']);

  const sid = {
    admin: await liveSession(admin!.id),
    teacher: await liveSession(teacher!.id),
    student: await liveSession(student!.id),
    zeroRole: await liveSession(zeroRole!.id),
    delegateRead: await liveSession(delegateRead!.id),
    delegateCreate: await liveSession(delegateCreate!.id),
    delegateDelete: await liveSession(delegateDelete!.id),
    crossDelegate: await liveSession(crossDelegate!.id),
  };

  // Academic structure for the end-to-end behavior phase: a placed student
  // whose class offers s1; s2 is a same-institute elective (not offered).
  const [yr] = await db!.insert(academicYears).values({ instituteId: instA!.id, name: `SE Year ${suffix}`, sortOrder: 1 }).returning();
  const [cls] = await db!.insert(classes).values({ instituteId: instA!.id, name: `SE Class ${suffix}` }).returning();
  const [div] = await db!.insert(divisions).values({ instituteId: instA!.id, academicYearId: yr!.id, classId: cls!.id, name: 'A' }).returning();
  const [s1] = await db!.insert(subjects).values({ instituteId: instA!.id, name: `SE S1 ${suffix}`, slug: `se-s1-${suffix}` }).returning();
  const [s2] = await db!.insert(subjects).values({ instituteId: instA!.id, name: `SE S2 ${suffix}`, slug: `se-s2-${suffix}` }).returning();
  const [sB] = await db!.insert(subjects).values({ instituteId: instB!.id, name: `SE SB ${suffix}`, slug: `se-sb-${suffix}` }).returning();
  await db!.insert(classSubjects).values({ classId: cls!.id, subjectId: s1!.id });

  const placedStudent = await makeUser('se_placed');
  const placedMembership = await grantMembership(instA!.id, placedStudent!.id, ['STUDENT']);
  const [placement] = await db!
    .insert(studentPlacements)
    .values({ instituteId: instA!.id, membershipId: placedMembership!.id, academicYearId: yr!.id, divisionId: div!.id, status: 'active' })
    .returning();
  const [inactivePlacement] = await db!
    .insert(studentPlacements)
    .values({ instituteId: instA!.id, membershipId: placedMembership!.id, academicYearId: yr!.id, divisionId: div!.id, status: 'inactive' })
    .returning();

  t.after(async () => {
    if (!db) return;
    const emails = [
      `se_admin-${suffix}`, `se_teacher-${suffix}`, `se_student-${suffix}`, `se_zerorole-${suffix}`,
      `se_delegate_read-${suffix}`, `se_delegate_create-${suffix}`, `se_delegate_delete-${suffix}`,
      `se_cross_delegate-${suffix}`, `se_placed-${suffix}`,
    ].map((e) => `${e}@example.test`);
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    if (userIds.length === 0) return;
    const membershipIds = (await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))).map((r) => r.id!);
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db.delete(memberships).where(inArray(memberships.userId, userIds));
    await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(institutes).where(inArray(institutes.slug, [`se-a-${suffix}`, `se-b-${suffix}`]));
  });

  async function userIdFor(who: keyof typeof sid): Promise<string> {
    const map: Record<keyof typeof sid, string> = {
      admin: admin!.id,
      teacher: teacher!.id,
      student: student!.id,
      zeroRole: zeroRole!.id,
      delegateRead: delegateRead!.id,
      delegateCreate: delegateCreate!.id,
      delegateDelete: delegateDelete!.id,
      crossDelegate: crossDelegate!.id,
    };
    return map[who];
  }

  const ctx = async (who: keyof typeof sid, instituteId = instA!.id) => ({
    headers: { 'x-institute-id': instituteId },
    cookies: { access_token: await sign(await userIdFor(who), sid[who]) },
  });

  await t.test('built-in INSTITUTE_ADMIN passes list/create/remove via assignments.manage', async () => {
    for (const handler of [LIST, CREATE, DELETE]) {
      await runChain(handler, await ctx('admin'));
    }
  });

  await t.test('TEACHER/STUDENT/zero-role default-deny every enrollment route', async () => {
    for (const who of ['teacher', 'student', 'zeroRole'] as const) {
      for (const handler of [LIST, CREATE, DELETE]) {
        await assert.rejects(
          runChain(handler, await ctx(who)),
          ForbiddenException,
          `${who} should be denied`,
        );
      }
    }
  });

  await t.test('delegated custom roles obey exactly their granted sub-actions', async () => {
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);

    const createCustom = async (key: string, permissionKeys: string[]) => {
      const role = await svc.createRole(instA!.id, { key, name: key, description: undefined, permissionKeys });
      return role.id;
    };

    const readOnly = await createCustom(`e1_${suffix}_ro`, ['assignments.read']);
    const createOnly = await createCustom(`e1_${suffix}_co`, ['assignments.create']);
    const deleteOnly = await createCustom(`e1_${suffix}_do`, ['assignments.delete']);

    const membershipOf = async (userId: string) =>
      (await db!.select().from(memberships).where(eq(memberships.userId, userId)).limit(1))[0]!.id;

    await Promise.all([
      assigner.assign(await membershipOf(delegateRead!.id), readOnly),
      assigner.assign(await membershipOf(delegateCreate!.id), createOnly),
      assigner.assign(await membershipOf(delegateDelete!.id), deleteOnly),
    ]);

    // read-only: list yes, create/remove no.
    await runChain(LIST, await ctx('delegateRead'));
    for (const handler of [CREATE, DELETE]) {
      await assert.rejects(runChain(handler, await ctx('delegateRead')), ForbiddenException);
    }

    // create-only: create yes, list/remove no.
    await assert.rejects(runChain(LIST, await ctx('delegateCreate')), ForbiddenException);
    await runChain(CREATE, await ctx('delegateCreate'));
    await assert.rejects(runChain(DELETE, await ctx('delegateCreate')), ForbiddenException);

    // delete-only: remove yes, list/create no.
    await assert.rejects(runChain(LIST, await ctx('delegateDelete')), ForbiddenException);
    await assert.rejects(runChain(CREATE, await ctx('delegateDelete')), ForbiddenException);
    await runChain(DELETE, await ctx('delegateDelete'));
  });

  await t.test('cross-institute: A-owned custom role never grants an A delegate through a B membership', async () => {
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);
    const roleId = await svc.createRole(instA!.id, { key: `e1_${suffix}_x`, name: 'A only', description: undefined, permissionKeys: ['assignments.manage'] }).then((r) => r.id);

    const membershipB = await db!.select().from(memberships).where(eq(memberships.userId, crossDelegate!.id)).limit(1);
    await assert.rejects(assigner.assign(membershipB[0]!.id, roleId), BadRequestException);

    // The B delegate has no A membership → no grant context in A at all.
    await assert.rejects(
      runChain(LIST, await ctx('crossDelegate')),
      ForbiddenException,
    );
  });

  await t.test('E.1 end-to-end: real handlers exercise the service invariants through the guard chain', async () => {
    const ctl = new StudentSubjectEnrollmentsController(new StudentSubjectEnrollmentsService(db as unknown as Database));

    const invoke = async (who: keyof typeof sid, handler: unknown, ...args: unknown[]) => {
      const request = await ctx(who);
      const req = await runChain(handler, request);
      return (handler as (...h: unknown[]) => unknown).apply(ctl, [req.tenant, ...args]);
    };

    // INSTITUTE_ADMIN (assignments.manage) creates an EXCLUDED override for the
    // class-offered subject — the check that removes s1 from THIS student.
    const excluded = (await invoke('admin', CREATE, { placementId: placement!.id, subjectId: s1!.id, kind: 'EXCLUDED' })) as {
      enrollment: { id: string; kind: string; subjectId: string };
    };
    assert.equal(excluded.enrollment.kind, 'EXCLUDED');
    assert.equal(excluded.enrollment.subjectId, s1!.id);

    // duplicate (placement, subject) → 409 Conflict
    await assert.rejects(
      invoke('admin', CREATE, { placementId: placement!.id, subjectId: s1!.id, kind: 'EXCLUDED' }),
      ConflictException,
    );

    // create-only delegate can create an ENROLLED override (elective s2)…
    const enrolled = (await invoke('delegateCreate', CREATE, { placementId: placement!.id, subjectId: s2!.id, kind: 'ENROLLED' })) as {
      enrollment: { id: string; kind: string; subjectId: string };
    };
    assert.equal(enrolled.enrollment.kind, 'ENROLLED');
    assert.equal(enrolled.enrollment.subjectId, s2!.id);

    // …and can never remove (lacks assignments.delete) → 403, before service work
    await assert.rejects(invoke('delegateCreate', DELETE, enrolled.enrollment.id), ForbiddenException);

    // ENROLLED/EXCLUDED class-offering validation
    await assert.rejects(
      invoke('admin', CREATE, { placementId: placement!.id, subjectId: s2!.id, kind: 'EXCLUDED' }),
      BadRequestException,
    );
    await assert.rejects(
      invoke('admin', CREATE, { placementId: placement!.id, subjectId: s1!.id, kind: 'ENROLLED' }),
      BadRequestException,
    );

    // active placement required: an inactive placement cannot take overrides
    await assert.rejects(
      invoke('admin', CREATE, { placementId: inactivePlacement!.id, subjectId: s2!.id, kind: 'ENROLLED' }),
      BadRequestException,
    );

    // same-institute subject / placement (cross-institute isolation at the service)
    await assert.rejects(
      invoke('admin', CREATE, { placementId: placement!.id, subjectId: sB!.id, kind: 'ENROLLED' }),
      NotFoundException,
    );

    // read-only delegate can list but a cross-institute (B-only) delegate is denied
    const listed = (await invoke('delegateRead', LIST)) as { enrollments: Array<{ id: string }> };
    assert.equal(listed.enrollments.some((e) => e.id === excluded.enrollment.id), true);
    await assert.rejects(invoke('crossDelegate', LIST), ForbiddenException);

    // remove = row deletion (revert to class default) by a delete-only delegate
    await invoke('delegateDelete', DELETE, excluded.enrollment.id);
    const after = await db!.select().from(studentSubjectEnrollments).where(eq(studentSubjectEnrollments.placementId, placement!.id));
    assert.deepEqual(after.map((r) => r.subjectId), [s2!.id], 'EXCLUDED override deleted, ENROLLED stays');

    // STUDENT caller default-deny on a real create attempt
    await assert.rejects(
      invoke('student', CREATE, { placementId: placement!.id, subjectId: s1!.id, kind: 'EXCLUDED' }),
      ForbiddenException,
    );
  });
});