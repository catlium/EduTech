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
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import { users, authSessions, memberships, membershipRoles, roles, platformUserRoles, institutes } from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from './permissions.guard.ts';
import { PlatformGuard } from './platform.guard.ts';
import { RequiredPermission } from './permissions.decorator.ts';
import { RequiredRoles } from '../common/decorators/roles.decorator.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from './permission-check.service.ts';
import { PermissionSyncService } from './permission-sync.service.ts';
import { RolesService } from './roles.service.ts';
import { RoleAssignmentService } from './role-assignment.service.ts';

// Phase L regression matrix (D8/§20). Runs the REAL guard chain
// (AccessTokenGuard → TenantGuard → RolesGuard / PermissionGuard /
// PlatformGuard) plus the role/permission services against a live database,
// proving the cross-cutting guarantees no single Phase B/K/H/I suite covers:
//  1. authentication → tenant chain builds a per-membership grant context
//  2. the same access token resolves a different role set per institute
//  3. institute picker returns only own memberships with manage-implied grants
//  4. DB-fresh permission checks: allowance, default-deny, opt-in default
//  5. membership role changes take effect immediately — no JWT regeneration
//  6. custom-role lifecycle authorization via DB + domain/ownership rules
//  7. platform boundary: SUPER_ADMIN via platform_user_roles, tenant-free
// Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
// unset so the default `pnpm test` run needs no database. Role and permission
// seeds come from migration 0039 + the idempotent PermissionSyncService (run
// here), so the suite is self-sufficient on a freshly migrated DB.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'authz-regression-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

// Stub controller carrying the exact metadata the guards read via Reflector.
class StubController {
  @RequiredRoles('INSTITUTE_ADMIN')
  static adminOnlyRole() {}
  @RequiredRoles('TEACHER')
  static teacherOnlyRole() {}
  @RequiredPermission('users.update')
  static usersUpdate() {}
  @RequiredPermission('ocr-workers.read')
  static ocrWorkersRead() {}
  @RequiredPermission('content.read')
  static contentRead() {}
  @RequiredPermission('content.update')
  static contentUpdate() {}
  @RequiredPermission('roles.read')
  static rolesRead() {}
  static noPermission() {}
}

function reqContext(handler: () => void, request: { cookies?: Record<string, string>; headers?: Record<string, string> }, method = 'GET') {
  const req = { headers: {}, method, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => StubController,
  } as unknown as ExecutionContext;
}

async function createUser(email: string, status = 'active') {
  const [user] = await db!
    .insert(users)
    .values({ email, name: 'Regression Tester', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  if (status !== 'active') {
    await db!.update(users).set({ status }).where(eq(users.id, user!.id));
  }
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `reg-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
    .returning();
  return row!.id;
}

async function grantMembership(instituteId: string, userId: string, roleKeys: string[], status = 'active') {
  const [membership] = await db!
    .insert(memberships)
    .values({ userId, instituteId, status })
    .returning();
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
  const rows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT', 'SUPER_ADMIN']));
  roleIds = Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const rolesCheck = () => new RolesGuard(new Reflector());
const permGuard = () => new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));
const platformGuard = () => new PlatformGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

/** Run authentication → tenant on a context, then permission/roles checks. */
async function authnAuthz(handler: () => void, request: { cookies?: Record<string, string>; headers?: Record<string, string> }) {
  const ctx = reqContext(handler, request);
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  return ctx;
}

test('authz regression matrix', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.TEACHER && roleIds.STUDENT && roleIds.SUPER_ADMIN, 'four built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const slugA = `reg-a-${suffix}`;
  const slugB = `reg-b-${suffix}`;
  const slugC = `reg-c-${suffix}`;
  const [instA] = await db!.insert(institutes).values({ name: `Reg Alpha ${suffix}`, slug: slugA }).returning();
  const [instB] = await db!.insert(institutes).values({ name: `Reg Beta ${suffix}`, slug: slugB }).returning();
  const [instC] = await db!.insert(institutes).values({ name: `Reg Gamma ${suffix}`, slug: slugC, status: 'deactivated', deactivatedAt: new Date() }).returning();

  const adminA = await createUser(`adminA-${suffix}@example.test`);
  const both = await createUser(`both-${suffix}@example.test`);
  const studentA = await createUser(`studentA-${suffix}@example.test`);
  const noRole = await createUser(`noRole-${suffix}@example.test`);
  const roleUp = await createUser(`roleup-${suffix}@example.test`);
  const customUser = await createUser(`custom-${suffix}@example.test`);
  const inactiveUser = await createUser(`inactive-${suffix}@example.test`, 'deactivated');
  const ghostUser = await createUser(`ghost-${suffix}@example.test`);
  const neverMember = await createUser(`never-${suffix}@example.test`);
  const superUser = await createUser(`super-${suffix}@example.test`);
  const plainTeacher = await createUser(`teacheronly-${suffix}@example.test`);

  await grantMembership(instA!.id, adminA!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instC!.id, adminA!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instA!.id, both!.id, ['TEACHER']);
  await grantMembership(instB!.id, both!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instA!.id, studentA!.id, ['STUDENT']);
  const noRoleMembership = await grantMembership(instA!.id, noRole!.id, []);
  const roleUpMembership = await grantMembership(instA!.id, roleUp!.id, ['TEACHER']);
  const customMembership = await grantMembership(instA!.id, customUser!.id, ['TEACHER']);
  const inactiveMembership = await grantMembership(instA!.id, inactiveUser!.id, ['STUDENT'], 'deactivated');
  const ghostMembership = await grantMembership(instA!.id, ghostUser!.id, ['STUDENT'], 'deactivated');
  await grantMembership(instB!.id, plainTeacher!.id, ['TEACHER']);
  await grantPlatformRole(superUser!.id, 'SUPER_ADMIN');

  const sidForum = {
    adminA: await liveSession(adminA!.id),
    both: await liveSession(both!.id),
    studentA: await liveSession(studentA!.id),
    noRole: await liveSession(noRole!.id),
    roleUp: await liveSession(roleUp!.id),
    custom: await liveSession(customUser!.id),
    inactive: await liveSession(inactiveUser!.id),
    ghost: await liveSession(ghostUser!.id),
    never: await liveSession(neverMember!.id),
    super: await liveSession(superUser!.id),
    plainTeacher: await liveSession(plainTeacher!.id),
  };

  t.after(async () => {
    if (!db) return;
    const emails = [
      `adminA-${suffix}@example.test`, `both-${suffix}@example.test`, `studentA-${suffix}@example.test`,
      `noRole-${suffix}@example.test`, `roleup-${suffix}@example.test`, `custom-${suffix}@example.test`,
      `inactive-${suffix}@example.test`, `ghost-${suffix}@example.test`, `never-${suffix}@example.test`, `super-${suffix}@example.test`,
      `teacheronly-${suffix}@example.test`,
    ];
    const userIds = (
      await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))
    ).map((r) => r.id!);
    if (userIds.length === 0) return;
    const membershipIds = (
      await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))
    ).map((r) => r.id!);
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db.delete(memberships).where(inArray(memberships.userId, userIds));
    await db.delete(platformUserRoles).where(inArray(platformUserRoles.userId, userIds));
    await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(institutes).where(inArray(institutes.slug, [slugA, slugB, slugC]));
    void noRoleMembership;
    void roleUpMembership;
    void customMembership;
    void inactiveMembership;
    void ghostMembership;
  });

  await t.test('1. authentication → tenant chain builds a per-membership grant context', async () => {
    // No access token → 401.
    await assert.rejects(accessGuard().canActivate(reqContext(StubController.noPermission, {})), UnauthorizedException);

    // Revoked session → 401.
    const revokedSid = await liveSession(adminA!.id);
    await db!.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, revokedSid));
    await assert.rejects(
      accessGuard().canActivate(reqContext(StubController.noPermission, { cookies: { access_token: await sign(adminA!.id, revokedSid) } })),
      UnauthorizedException,
    );

    // Deactivated user → 401 even with a live session.
    const inactiveCtx = reqContext(StubController.noPermission, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(inactiveUser!.id, sidForum.inactive) },
    });
    await assert.rejects(accessGuard().canActivate(inactiveCtx), UnauthorizedException);

    // Authenticated but no institute header → 403 (TenantGuard).
    const noTenantCtx = reqContext(StubController.noPermission, { cookies: { access_token: await sign(adminA!.id, sidForum.adminA) } });
    await assert.rejects(tenantGuard().canActivate(noTenantCtx), ForbiddenException);

    // Non-UUID institute header → 403.
    const badUuidCtx = reqContext(StubController.noPermission, {
      headers: { 'x-institute-id': 'not-a-uuid' },
      cookies: { access_token: await sign(adminA!.id, sidForum.adminA) },
    });
    await assert.rejects(tenantGuard().canActivate(badUuidCtx), ForbiddenException);

    // Valid UUID but no membership → 403.
    const neverCtx = reqContext(StubController.noPermission, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(neverMember!.id, sidForum.never) },
    });
    await assert.rejects(tenantGuard().canActivate(neverCtx), ForbiddenException);

    // Inactive membership → 403 (active user, deactivated membership).
    const deactivatedCtx = reqContext(StubController.noPermission, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(ghostUser!.id, sidForum.ghost) },
    });
    await accessGuard().canActivate(deactivatedCtx);
    await assert.rejects(tenantGuard().canActivate(deactivatedCtx), ForbiddenException);

    // Deactivated institute → 403 even with an active membership.
    const deadInstCtx = reqContext(StubController.noPermission, {
      headers: { 'x-institute-id': instC!.id },
      cookies: { access_token: await sign(adminA!.id, sidForum.adminA) },
    });
    await accessGuard().canActivate(deadInstCtx);
    await assert.rejects(tenantGuard().canActivate(deadInstCtx), ForbiddenException);

    // Reactivation restores access on the NEXT request (same token).
    await db!.update(institutes).set({ status: 'active', deactivatedAt: null }).where(eq(institutes.id, instC!.id));
    await tenantGuard().canActivate(deadInstCtx);
    const tenantC = deadInstCtx.switchToHttp().getRequest() as Record<string, unknown>;
    assert.equal((tenantC['tenant'] as { instituteId: string }).instituteId, instC!.id);

    // Full chain success: tenant context carries the membership's role set.
    const ok = reqContext(StubController.noPermission, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(adminA!.id, sidForum.adminA) },
    });
    await accessGuard().canActivate(ok);
    await tenantGuard().canActivate(ok);
    const req = ok.switchToHttp().getRequest() as Record<string, unknown>;
    const tenant = req['tenant'] as { instituteId: string; membershipId: string; roles: string[] };
    assert.equal(tenant.instituteId, instA!.id);
    assert.deepEqual(tenant.roles, ['INSTITUTE_ADMIN']);
  });

  await t.test('2. one access token resolves a different role/permission set per institute', async () => {
    const token = await sign(both!.id, sidForum.both);
    const atA = await authnAuthz(StubController.usersUpdate, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: token } });
    const atB = await authnAuthz(StubController.usersUpdate, { headers: { 'x-institute-id': instB!.id }, cookies: { access_token: token } });

    // TEACHER at A has no users.update; INSTITUTE_ADMIN at B does.
    await assert.rejects(permGuard().canActivate(atA), ForbiddenException);
    await permGuard().canActivate(atB);

    // RolesGuard resolves the same split on role-name metadata (synchronous
    // guard: allowed path returns a boolean, denial throws).
    const roleCtxA = await authnAuthz(StubController.adminOnlyRole, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: token } });
    const roleCtxB = await authnAuthz(StubController.adminOnlyRole, { headers: { 'x-institute-id': instB!.id }, cookies: { access_token: token } });
    assert.throws(() => rolesCheck().canActivate(roleCtxA), ForbiddenException);
    assert.equal(rolesCheck().canActivate(roleCtxB), true);
  });

  await t.test('3. institute picker returns only own memberships, manage-implied grants, no platform keys', async () => {
    const svc = new TenancyService(db as unknown as Database);

    // Self can have memberships of the same institute same user.
    const forSelf = await svc.listMemberships(both!.id);
    assert.equal(forSelf.length, 2);
    const bySlug = new Map(forSelf.map((m) => [m.slug, m]));
    assert.deepEqual(bySlug.get(slugA)!.roles, ['TEACHER']);
    assert.deepEqual(bySlug.get(slugB)!.roles, ['INSTITUTE_ADMIN']);
    assert.equal(bySlug.get(slugA)!.instituteStatus, 'active', 'picker surfaces institute status');
    assert.equal(bySlug.get(slugB)!.instituteStatus, 'active');
    const mTeach = bySlug.get(slugA)!;
    const mAdmin = bySlug.get(slugB)!;
    assert.equal(mTeach.permissions.includes('content.read'), true, 'teacher raw grants surfaced');
    assert.equal(mTeach.permissions.includes('content.manage'), false, 'manage is not a literal teacher grant');
    assert.equal(mAdmin.permissions.includes('content.manage'), true, 'admin manage key surfaced');
    // The picker exposes raw grants; manage-implication lives in hasPermission
    // (exercised via the guard below — admin's content.read passes via content.manage).
    for (const m of forSelf) {
      assert.equal(m.permissions.includes('ocr-workers.read'), false, 'no platform permission through a membership');
    }
    const adminMeta = await authnAuthz(StubController.contentRead, {
      headers: { 'x-institute-id': instB!.id },
      cookies: { access_token: await sign(both!.id, sidForum.both) },
    });
    await permGuard().canActivate(adminMeta); // content.read via admin's content.manage implication

    // A user with no memberships sees an empty picker.
    assert.deepEqual(await svc.listMemberships(neverMember!.id), []);
  });

  await t.test('4. permission matrix is DB-fresh with default-deny and opt-in default', async () => {
    // INSTITUTE_ADMIN → users.update granted.
    const admin = await authnAuthz(StubController.usersUpdate, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(adminA!.id, sidForum.adminA) },
    });
    await permGuard().canActivate(admin);

    // STUDENT → denied.
    const student = await authnAuthz(StubController.usersUpdate, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(studentA!.id, sidForum.studentA) },
    });
    await assert.rejects(permGuard().canActivate(student), ForbiddenException);

    // Zero-role membership → default deny.
    const none = await authnAuthz(StubController.usersUpdate, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(noRole!.id, sidForum.noRole) },
    });
    await assert.rejects(permGuard().canActivate(none), ForbiddenException);

    // No @RequiredPermission declared → the guard is a no-op (opt-in adoption).
    const plain = await authnAuthz(StubController.noPermission, {
      headers: { 'x-institute-id': instA!.id },
      cookies: { access_token: await sign(noRole!.id, sidForum.noRole) },
    });
    await permGuard().canActivate(plain);

    // Institute-domain permission required on a platform-only grant set fails by default-deny
    // (already exercised on the platform plane in matrix 7).
  });

  await t.test('5. role change takes effect immediately — no claims refresh', async () => {
    const ctx = async () =>
      authnAuthz(StubController.usersUpdate, {
        headers: { 'x-institute-id': instA!.id },
        cookies: { access_token: await sign(roleUp!.id, sidForum.roleUp) },
      });
    const assigner = new RoleAssignmentService(db as unknown as Database);

    // TEACHER → denied.
    await assert.rejects(permGuard().canActivate(await ctx()), ForbiddenException);

    // Replace with INSTITUTE_ADMIN: the same token grants immediately.
    await assigner.replaceMembershipRoles(instA!.id, roleUpMembership!.id, [roleIds.INSTITUTE_ADMIN!]);
    await permGuard().canActivate(await ctx());

    // Back to TEACHER → denied again.
    await assigner.replaceMembershipRoles(instA!.id, roleUpMembership!.id, [roleIds.TEACHER!]);
    await assert.rejects(permGuard().canActivate(await ctx()), ForbiddenException);

    // Platform role can never be assigned to a institute membership.
    await assert.rejects(
      assigner.replaceMembershipRoles(instA!.id, roleUpMembership!.id, [roleIds.SUPER_ADMIN!]),
      BadRequestException,
    );
  });

  await t.test('6. custom-role lifecycle authorization via DB (domain + ownership + immutability)', async () => {
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);
    const key = `reg_${suffix}_editor`;
    const created = await svc.createRole(instA!.id, {
      key,
      name: 'Regression Viewer',
      description: undefined,
      permissionKeys: ['roles.read'],
    });
    assert.deepEqual([...created.permissionKeys].sort(), ['roles.read']);

    const ctx = async (handler: () => void) =>
      authnAuthz(handler, {
        headers: { 'x-institute-id': instA!.id },
        cookies: { access_token: await sign(customUser!.id, sidForum.custom) },
      });

    // Assign the custom role to a TEACHER membership (union of grants).
    await assigner.assign(customMembership!.id, created.id);
    await permGuard().canActivate(await ctx(StubController.rolesRead)); // custom-role grant
    await permGuard().canActivate(await ctx(StubController.contentUpdate)); // TEACHER union
    await assert.rejects(permGuard().canActivate(await ctx(StubController.usersUpdate)), ForbiddenException);

    // setRolePermissions removes the custom grant immediately while the
    // built-in TEACHER union persists.
    await svc.setRolePermissions(instA!.id, created.id, [], ['INSTITUTE_ADMIN']);
    await assert.rejects(permGuard().canActivate(await ctx(StubController.rolesRead)), ForbiddenException);
    await permGuard().canActivate(await ctx(StubController.contentUpdate));

    // Restore the grant, then delete the role — its grants cascade away.
    await svc.setRolePermissions(instA!.id, created.id, ['roles.read'], ['INSTITUTE_ADMIN']);
    await permGuard().canActivate(await ctx(StubController.rolesRead));
    await svc.deleteRole(instA!.id, created.id);
    await assert.rejects(permGuard().canActivate(await ctx(StubController.rolesRead)), ForbiddenException);
    await permGuard().canActivate(await ctx(StubController.contentUpdate));

    // System roles are immutable through every mutation path.
    const systemRoleId = roleIds.TEACHER!;
    await assert.rejects(svc.updateRole(instA!.id, systemRoleId, { name: 'x' }), BadRequestException);
    await assert.rejects(svc.deleteRole(instA!.id, systemRoleId), BadRequestException);
    await assert.rejects(svc.setRolePermissions(instA!.id, systemRoleId, ['roles.read'], ['INSTITUTE_ADMIN']), BadRequestException);

    // createRole rejects platform keys and reserved built-in keys.
    await assert.rejects(
      svc.createRole(instA!.id, { key: `reg_${suffix}_bad`, name: 'Bad', description: undefined, permissionKeys: ['ocr-workers.read'] }),
      BadRequestException,
    );
    await assert.rejects(
      svc.createRole(instA!.id, { key: 'STUDENT', name: 'Bad', description: undefined, permissionKeys: ['roles.read'] }),
      ConflictException,
    );

    // Cross-institute: an A-owned custom role cannot be assigned to a B membership.
    const bPlainTeacher = await db!.select().from(memberships).where(eq(memberships.userId, plainTeacher!.id)).limit(1);
    await assert.rejects(assigner.assign(bPlainTeacher[0]!.id, created.id), BadRequestException);
  });

  await t.test('7. platform boundary: SUPER_ADMIN via platform_user_roles, tenant-free', async () => {

    // SUPER_ADMIN platform user — no x-institute-id header at all.
    const superCtx = reqContext(StubController.ocrWorkersRead, { cookies: { access_token: await sign(superUser!.id, sidForum.super) } });
    await accessGuard().canActivate(superCtx);
    await platformGuard().canActivate(superCtx);

    // Institute-role-only user has no platform grant → 403.
    const teacherCtx = reqContext(StubController.ocrWorkersRead, {
      headers: { 'x-institute-id': instB!.id },
      cookies: { access_token: await sign(plainTeacher!.id, sidForum.plainTeacher) },
    });
    await accessGuard().canActivate(teacherCtx);
    await assert.rejects(platformGuard().canActivate(teacherCtx), ForbiddenException);

    // An institute-domain key cannot be satisfied on the platform plane (default-deny).
    const superInstituteKey = reqContext(StubController.usersUpdate, { cookies: { access_token: await sign(superUser!.id, sidForum.super) } });
    await accessGuard().canActivate(superInstituteKey);
    await assert.rejects(platformGuard().canActivate(superInstituteKey), ForbiddenException);
  });
});