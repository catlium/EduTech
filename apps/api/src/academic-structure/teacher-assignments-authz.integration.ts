import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import { users, authSessions, memberships, membershipRoles, roles, institutes } from '@catlium/database';
import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from '../authorization/permissions.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RolesService } from '../authorization/roles.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { TeacherAssignmentsController } from './teacher-assignments.controller.ts';

// Phase Q.3.0 — teacher-assignment guard matrix (D5/§17, Q.3.0 design).
// Runs the REAL guard chain against the REAL TeacherAssignmentsController
// handlers (their metadata), proving the catalogued `assignments.*` permission
// declares exactly what the routes enforce:
//   - INSTITUTE_ADMIN passes via the built-in assignments.manage grant
//   - delegated custom roles obey exactly their granted sub-actions
//   - TEACHER/STUDENT default-deny (staffing config never reaches class users)
//   - no stale @RequiredRoles('INSTITUTE_ADMIN') metadata remains
// Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
// unset. Permission/role seeds come from PermissionSyncService (idempotent).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'teacher-assignments-authz-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

const READ = TeacherAssignmentsController.prototype.listTeacherAssignments;
const CREATE = TeacherAssignmentsController.prototype.createTeacherAssignment;
const DELETE = TeacherAssignmentsController.prototype.deactivateTeacherAssignment;

function reqContext(handler: unknown, request: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const req = { headers: {}, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler as unknown as (...args: unknown[]) => unknown,
    getClass: () => TeacherAssignmentsController,
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
}

test('Q.3 teacher-assignment guard matrix', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  const roleRows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']));
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));

  const suffix = randomUUID().slice(0, 8);
  const [instA] = await db!.insert(institutes).values({ name: `Assign A ${suffix}`, slug: `assign-a-${suffix}` }).returning();
  const [instB] = await db!.insert(institutes).values({ name: `Assign B ${suffix}`, slug: `assign-b-${suffix}` }).returning();

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
      .values({ userId, refreshTokenHash: `q3-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    return row!.id;
  };

  const admin = await makeUser('admin');
  const teacher = await makeUser('teacher');
  const student = await makeUser('student');
  const zeroRole = await makeUser('zerorole');
  const delegateRead = await makeUser('delegate_read');
  const delegateCreate = await makeUser('delegate_create');
  const delegateDelete = await makeUser('delegate_delete');
  const delegateManage = await makeUser('delegate_manage');
  const crossDelegate = await makeUser('cross_delegate');

  await grantMembership(instA!.id, admin!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instA!.id, teacher!.id, ['TEACHER']);
  await grantMembership(instA!.id, student!.id, ['STUDENT']);
  await grantMembership(instA!.id, zeroRole!.id, []);
  for (const u of [delegateRead, delegateCreate, delegateDelete, delegateManage]) {
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
    delegateManage: await liveSession(delegateManage!.id),
    crossDelegate: await liveSession(crossDelegate!.id),
  };

  t.after(async () => {
    if (!db) return;
    const emails = [
      `admin-${suffix}`, `teacher-${suffix}`, `student-${suffix}`, `zerorole-${suffix}`,
      `delegate_read-${suffix}`, `delegate_create-${suffix}`, `delegate_delete-${suffix}`, `delegate_manage-${suffix}`,
      `cross_delegate-${suffix}`,
    ].map((e) => `${e}@example.test`);
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    if (userIds.length === 0) return;
    const membershipIds = (await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))).map((r) => r.id!);
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db.delete(memberships).where(inArray(memberships.userId, userIds));
    await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(institutes).where(inArray(institutes.slug, [`assign-a-${suffix}`, `assign-b-${suffix}`]));
  });

  async function userIdFor(label: keyof typeof sid): Promise<string> {
    const map: Record<keyof typeof sid, string> = {
      admin: admin!.id,
      teacher: teacher!.id,
      student: student!.id,
      zeroRole: zeroRole!.id,
      delegateRead: delegateRead!.id,
      delegateCreate: delegateCreate!.id,
      delegateDelete: delegateDelete!.id,
      delegateManage: delegateManage!.id,
      crossDelegate: crossDelegate!.id,
    };
    return map[label];
  }

  await t.test('built-in INSTITUTE_ADMIN passes read/create/delete via assignments.manage', async () => {
    await runChain(READ, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(admin!.id, sid.admin) } });
    await runChain(CREATE, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(admin!.id, sid.admin) } });
    await runChain(DELETE, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(admin!.id, sid.admin) } });
  });

  await t.test('TEACHER/STUDENT/zero-role default-deny every assignment route', async () => {
    for (const who of ['teacher', 'student', 'zeroRole'] as const) {
      const label = who as keyof typeof sid;
      for (const handler of [READ, CREATE, DELETE]) {
        await assert.rejects(
          runChain(handler, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign((await userIdFor(label)), sid[label]) } }),
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

    const readOnly = await createCustom(`q3_${suffix}_ro`, ['assignments.read']);
    const createOnly = await createCustom(`q3_${suffix}_co`, ['assignments.create']);
    const deleteOnly = await createCustom(`q3_${suffix}_do`, ['assignments.delete']);
    const manageAll = await createCustom(`q3_${suffix}_ma`, ['assignments.manage']);

    const mRead = await db!.select().from(memberships).where(eq(memberships.userId, delegateRead!.id)).limit(1);
    const mCreate = await db!.select().from(memberships).where(eq(memberships.userId, delegateCreate!.id)).limit(1);
    const mDelete = await db!.select().from(memberships).where(eq(memberships.userId, delegateDelete!.id)).limit(1);
    const mManage = await db!.select().from(memberships).where(eq(memberships.userId, delegateManage!.id)).limit(1);
    await assigner.assign(mRead[0]!.id, readOnly);
    await assigner.assign(mCreate[0]!.id, createOnly);
    await assigner.assign(mDelete[0]!.id, deleteOnly);
    await assigner.assign(mManage[0]!.id, manageAll);

    const ctx = async (who: keyof typeof sid) => ({
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(await userIdFor(who), sid[who]) },
    });

    await runChain(READ, await ctx('delegateRead'));
    await assert.rejects(runChain(CREATE, await ctx('delegateRead')), ForbiddenException);
    await assert.rejects(runChain(DELETE, await ctx('delegateRead')), ForbiddenException);

    await assert.rejects(runChain(READ, await ctx('delegateCreate')), ForbiddenException);
    await runChain(CREATE, await ctx('delegateCreate'));
    await assert.rejects(runChain(DELETE, await ctx('delegateCreate')), ForbiddenException);

    await assert.rejects(runChain(READ, await ctx('delegateDelete')), ForbiddenException);
    await assert.rejects(runChain(CREATE, await ctx('delegateDelete')), ForbiddenException);
    await runChain(DELETE, await ctx('delegateDelete'));

    for (const handler of [READ, CREATE, DELETE]) {
      await runChain(handler, await ctx('delegateManage'));
    }
  });

  await t.test('cross-institute: A-owned custom role never grants an A delegate through a B membership', async () => {
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);
    const roleId = await svc.createRole(instA!.id, { key: `q3_${suffix}_x`, name: 'A only', description: undefined, permissionKeys: ['assignments.manage'] }).then((r) => r.id);

    const membershipB = await db!.select().from(memberships).where(eq(memberships.userId, crossDelegate!.id)).limit(1);
    await assert.rejects(assigner.assign(membershipB[0]!.id, roleId), BadRequestException);

    // The B delegate has no A membership → no grant context in A at all.
    await assert.rejects(
      runChain(CREATE, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(crossDelegate!.id, sid.crossDelegate) } }),
      ForbiddenException,
    );
  });
});