import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as bcryptjs from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  platformUserRoles,
  roles,
  institutes,
  plans,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.ts';
import { PlatformGuard } from '../authorization/platform.guard.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { PlatformInstitutesService } from './platform-institutes.service.ts';
import { PlatformAuditService } from './platform-audit.service.ts';
import { PlatformAdminController } from './platform-admin.controller.ts';

// Phase N.5 regression matrix for the Super Admin console prerequisites
// (institute-lifecycle §9/§11): GET /platform/plans (the assignable plan
// catalog backing the create-form plan selector) and GET /platform/permissions
// (the DB-fresh platform-grant probe the console uses to gate navigation).
// Through the REAL guard chain (AccessTokenGuard → PlatformGuard) and the REAL
// controller handlers. Proves: SUPER_ADMIN access; institute-plane users 403;
// anonymous 401; only active plans are exposed; the catalog leaks no
// billing/internal fields; the permission probe returns exactly the caller's
// platform-domain keys (never institute grants, never JWT claims).
// TEST_DATABASE_URL-gated, skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'platform-plans-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

const plansHandler = PlatformAdminController.prototype.plans as unknown as () => void;
const permissionsHandler = PlatformAdminController.prototype.permissions as unknown as () => void;

function reqContext(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }, method = 'GET') {
  const req = { headers: {}, method, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => PlatformAdminController,
  } as unknown as ExecutionContext;
}

async function createUser(email: string) {
  const [user] = await db!
    .insert(users)
    .values({ email, name: 'Platform Planner', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `plans-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
    .returning();
  return row!.id;
}

async function grantMembership(instituteId: string, userId: string, roleKeys: string[]) {
  const [membership] = await db!.insert(memberships).values({ userId, instituteId }).returning();
  for (const key of roleKeys) {
    await db!.insert(membershipRoles).values({ membershipId: membership!.id, roleId: roleIds[key]! });
  }
  return membership!;
}

async function grantPlatformRole(userId: string, roleKey: string) {
  await db!.insert(platformUserRoles).values({ userId, roleId: roleIds[roleKey]! });
}

let roleIds: Record<string, string> = {};
async function loadRoleIds() {
  const rows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'SUPER_ADMIN']));
  roleIds = Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const platformGuard = () => new PlatformGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

async function platformPass(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }, method = 'GET') {
  const ctx = reqContext(handler, request, method);
  await accessGuard().canActivate(ctx);
  await platformGuard().canActivate(ctx);
  const req = ctx.switchToHttp().getRequest() as { user?: { userId: string } };
  return req.user?.userId;
}

test('platform plans catalog + permissions probe', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.TEACHER && roleIds.SUPER_ADMIN, 'built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const [instA] = await db!.insert(institutes).values({ name: `Plans Target ${suffix}`, slug: `plans-${suffix}` }).returning();

  const superUser = await createUser(`plans-super-${suffix}@example.test`);
  const instAdmin = await createUser(`plans-admin-${suffix}@example.test`);
  const teacher = await createUser(`plans-teacher-${suffix}@example.test`);
  await grantMembership(instA!.id, superUser!.id, []);
  await grantMembership(instA!.id, instAdmin!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instA!.id, teacher!.id, ['TEACHER']);
  await grantPlatformRole(superUser!.id, 'SUPER_ADMIN');

  const sidSuper = await liveSession(superUser!.id);
  const sidAdmin = await liveSession(instAdmin!.id);
  const sidTeacher = await liveSession(teacher!.id);

  const service = new PlatformInstitutesService(
    db as unknown as Database,
    new RoleAssignmentService(db as unknown as Database),
    new PlatformAuditService(),
  );
  const permissionCheck = new PermissionCheckService(db as unknown as Database);
  const controller = new PlatformAdminController(service, permissionCheck);

  const noInstituteHeader = (token: string) => ({ cookies: { access_token: token } });
  const withInstitute = (token: string) => ({ headers: { 'x-institute-id': instA!.id }, cookies: { access_token: token } });
  const superToken = () => sign(superUser!.id, sidSuper);
  const adminToken = () => sign(instAdmin!.id, sidAdmin);
  const teacherToken = () => sign(teacher!.id, sidTeacher);

  t.after(async () => {
    if (!db) return;
    const emails = [`plans-super-${suffix}@example.test`, `plans-admin-${suffix}@example.test`, `plans-teacher-${suffix}@example.test`];
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    if (userIds.length === 0) return;
    const membershipIds = (
      await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))
    ).map((r) => r.id!);
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db.delete(memberships).where(inArray(memberships.userId, userIds));
    await db.delete(platformUserRoles).where(inArray(platformUserRoles.userId, userIds));
    await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(institutes).where(eq(institutes.id, instA!.id));
  });

  await t.test('1. SUPER_ADMIN reads the active plan catalog', async () => {
    const userId = await platformPass(plansHandler, noInstituteHeader(await superToken()));
    assert.equal(userId, superUser!.id);
    const catalog = await controller.plans();
    const codes = catalog.map((p) => p.code).sort();
    assert.deepEqual(codes, ['growth', 'institute', 'starter'], 'all seeded plans exposed');
    for (const plan of catalog) {
      assert.deepEqual(Object.keys(plan).sort(), ['code', 'description', 'id', 'name'], `no internal fields on ${plan.code}`);
      assert.ok(plan.name.length > 0 && plan.description !== null, plan.code);
    }
  });

  await t.test('2. anonymous 401; institute-plane users 403 (even with a tenant header)', async () => {
    await assert.rejects(accessGuard().canActivate(reqContext(plansHandler, {}, 'GET')), UnauthorizedException);
    await assert.rejects(accessGuard().canActivate(reqContext(permissionsHandler, {}, 'GET')), UnauthorizedException);
    await assert.rejects(
      platformPass(plansHandler, withInstitute(await adminToken()), 'GET'),
      ForbiddenException,
    );
    await assert.rejects(
      platformPass(plansHandler, noInstituteHeader(await teacherToken()), 'GET'),
      ForbiddenException,
    );
  });

  await t.test('3. inactive plans are dropped from the catalog', async () => {
    const [target] = await db!.select().from(plans).where(eq(plans.code, 'growth')).limit(1);
    await db!.update(plans).set({ isActive: false, updatedAt: new Date() }).where(eq(plans.id, target!.id));
    const catalog = await controller.plans();
    assert.ok(!catalog.some((p) => p.code === 'growth'), 'inactive plan hidden');
    await db!.update(plans).set({ isActive: true, updatedAt: new Date() }).where(eq(plans.id, target!.id));
    const restored = await controller.plans();
    assert.ok(restored.some((p) => p.code === 'growth'));
  });

  await t.test('4. permission probe: SUPER_ADMIN sees platform keys; institute admins see none', async () => {
    const asUser = (userId: string) => ({ userId }) as AuthenticatedUser;
    await platformPass(permissionsHandler, noInstituteHeader(await superToken()));
    const { permissions } = await controller.permissions(asUser(superUser!.id));
    assert.ok(permissions.includes('plans.read'), 'plans.read granted');
    assert.ok(permissions.includes('institutes.read') && permissions.includes('institutes.manage'), 'institutes keys granted');
    assert.ok(permissions.includes('ocr-workers.read'), 'ocr-workers keys granted');
    assert.ok(!permissions.some((k) => k.startsWith('users.')), 'no institute-domain keys on the platform probe');

    await platformPass(permissionsHandler, withInstitute(await adminToken()));
    const adminProbe = await controller.permissions(asUser(instAdmin!.id));
    assert.deepEqual(adminProbe.permissions, [], 'INSTITUTE_ADMIN has no platform grants');
    await platformPass(permissionsHandler, noInstituteHeader(await teacherToken()));
    const teacherProbe = await controller.permissions(asUser(teacher!.id));
    assert.deepEqual(teacherProbe.permissions, []);
  });
});