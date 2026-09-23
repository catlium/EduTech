import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as bcryptjs from 'bcryptjs';
import { eq, inArray, or, and } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  NotFoundException,
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
  platformAuditEvents,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PlatformGuard } from '../authorization/platform.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { PermissionGuard } from '../authorization/permissions.guard.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { UsersController } from '../users/users.controller.ts';
import { UsersService } from '../users/users.service.ts';
import { PlatformUsersController } from './platform-users.controller.ts';
import { PlatformUsersService } from './platform-users.service.ts';
import { PlatformAuditService } from './platform-audit.service.ts';

// Phase P.2 regression matrix for the platform-user lifecycle
// (platform-user-lifecycle §4/§5/§8/§9/§10/§11/§12). Runs the REAL guard chain
// (AccessTokenGuard → PlatformGuard) with REAL controller handler metadata and
// REAL service mutations, then proves the cross-plane effects (auth zapping,
// institute-plane independence, §8 shared attach gate). Requires a live
// database (TEST_DATABASE_URL); skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'platform-user-lifecycle-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

const listHandler = PlatformUsersController.prototype.list as unknown as () => void;
const suspendHandler = PlatformUsersController.prototype.suspend as unknown as () => void;
const buildHandler = UsersController.prototype.list as unknown as () => void;

function reqContext(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }, method = 'GET') {
  const req = { headers: {}, method, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => PlatformUsersController,
  } as unknown as ExecutionContext;
}

async function createUser(email: string) {
  const [user] = await db!
    .insert(users)
    .values({ email, name: 'Platform Lifecycle Tester', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `plat-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
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

async function platformRolesOf(userId: string) {
  const rows = await db!.select().from(platformUserRoles).where(eq(platformUserRoles.userId, userId));
  return rows;
}

async function eventsFor(action: string, resourceId: string) {
  return db!
    .select()
    .from(platformAuditEvents)
    .where(and(eq(platformAuditEvents.action, action), eq(platformAuditEvents.resourceId, resourceId)));
}

let roleIds: Record<string, string> = {};
async function loadRoleIds() {
  const rows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'SUPER_ADMIN']));
  roleIds = Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const permissionCheck = () => new PermissionCheckService(db as unknown as Database);
const platformGuard = () => new PlatformGuard(new Reflector(), permissionCheck());

/** AccessTokenGuard + PlatformGuard with the real handler metadata. */
async function platformPass(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }) {
  const ctx = reqContext(handler, request, 'POST');
  await accessGuard().canActivate(ctx);
  await platformGuard().canActivate(ctx);
  return ctx;
}

/** Full institute-plane chain (access → tenant → roles → permission). */
async function institutePass(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }) {
  const ctx = reqContext(handler, request, 'GET');
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  new RolesGuard(new Reflector()).canActivate(ctx);
  await new PermissionGuard(new Reflector(), permissionCheck()).canActivate(ctx);
  return ctx;
}

test('platform user lifecycle mutations', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.TEACHER && roleIds.SUPER_ADMIN, 'built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const [inst] = await db!.insert(institutes).values({ name: `Platform Lifecycle ${suffix}`, slug: `plat-life-${suffix}` }).returning();

  // Two permanent active SUPER_ADMINs (the last-guard needs someone to spare).
  const s1 = await createUser(`s1-${suffix}@example.test`);
  const s2 = await createUser(`s2-${suffix}@example.test`);
  // Institute-plane actor: INSTITUTE_ADMIN membership, platform role granted and
  // revoked mid-suite (immediate-effect + narrow-revoke proof).
  const ia = await createUser(`ia-${suffix}@example.test`);
  // Institute-plane target, kept entirely off the platform plane.
  const tTarget = await createUser(`t-${suffix}@example.test`);
  // Suspend/reactivate target with two live sessions (bulk-revoke proof).
  const tt = await createUser(`tt-${suffix}@example.test`);

  const adminMembership = await grantMembership(inst!.id, ia!.id, ['INSTITUTE_ADMIN']);
  const targetMembership = await grantMembership(inst!.id, tTarget!.id, ['INSTITUTE_ADMIN']);
  const ttMembership = await grantMembership(inst!.id, tt!.id, ['TEACHER']);
  await grantPlatformRole(s1!.id, 'SUPER_ADMIN');
  await grantPlatformRole(s2!.id, 'SUPER_ADMIN');

  const sidS1 = await liveSession(s1!.id);
  const sidIA = await liveSession(ia!.id);
  const sidTt1 = await liveSession(tt!.id);
  const sidTt2 = await liveSession(tt!.id);

  const userService = new UsersService(db as unknown as Database, new RoleAssignmentService(db as unknown as Database));
  const service = new PlatformUsersService(db as unknown as Database, permissionCheck(), new PlatformAuditService());
  const controller = new PlatformUsersController(service);
  const actor = { userId: s1!.id };
  const actorToken = (token: string) => ({ cookies: { access_token: token } });
  const noInstituteHeader = (token: string) => ({ cookies: { access_token: token } });
  const grant = (userId: string, roleKey: string) => controller.grantRole(actor, userId, { roleKey });

  t.after(async () => {
    if (!db) return;
    const emails = [`s1-${suffix}@example.test`, `s2-${suffix}@example.test`, `ia-${suffix}@example.test`, `t-${suffix}@example.test`, `tt-${suffix}@example.test`];
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    if (userIds.length === 0) return;
    const membershipIds = (
      await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))
    ).map((r) => r.id!);
    await db.delete(platformAuditEvents).where(or(eq(platformAuditEvents.actorUserId, s1!.id), inArray(platformAuditEvents.resourceId, userIds)));
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db.delete(memberships).where(inArray(memberships.userId, userIds));
    await db.delete(platformUserRoles).where(inArray(platformUserRoles.userId, userIds));
    await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(institutes).where(eq(institutes.id, inst!.id));
    void adminMembership;
    void targetMembership;
    void ttMembership;
  });

  await t.test('1. list + get: platform users only, roles + permissions surfaced', async () => {
    await platformPass(listHandler, actorToken(await sign(s1!.id, sidS1)));
    const list = await controller.list();
    // Only platform-granted users surface — memberships are irrelevant.
    assert.deepEqual(
      list.map((u) => u.email).sort(),
      [`s1-${suffix}@example.test`, `s2-${suffix}@example.test`].sort(),
    );
    const s1Entry = list.find((u) => u.id === s1!.id)!;
    assert.deepEqual(s1Entry!.roles, ['SUPER_ADMIN']);
    assert.equal(s1Entry!.platformRoles.length, 1);
    assert.equal(s1Entry!.platformRoles[0]!.key, 'SUPER_ADMIN');
    assert.equal(s1Entry!.platformRoles[0]!.id, roleIds.SUPER_ADMIN, 'read surface carries the revoke-able role id');
    assert.deepEqual(list.filter((u) => [tTarget!.id, tt!.id].includes(u.id)), [], 'institute-plane users never list');

    const detail = await controller.get(s1!.id);
    assert.deepEqual(detail.roles, ['SUPER_ADMIN']);
    assert.deepEqual(detail.platformRoles, [{ id: roleIds.SUPER_ADMIN, key: 'SUPER_ADMIN' }]);
    assert.ok(detail.platformPermissions!.includes('platform-users.read'));
    assert.ok(detail.platformPermissions!.includes('platform-users.update'));

    await assert.rejects(controller.get(randomUUID()), NotFoundException);
  });

  await t.test('2. grantRole: attach + idempotent no-op, invalid targets rejected', async () => {
    const granted = await grant(tTarget!.id, 'SUPER_ADMIN');
    assert.equal(granted.roleKey, 'SUPER_ADMIN');
    const tRoles = await platformRolesOf(tTarget!.id);
    assert.equal(tRoles.length, 1, 'row written');
    assert.equal(tRoles[0]!.roleId, granted.roleId);

    const attachEvents = await eventsFor('platform_user.attach', tTarget!.id);
    assert.equal(attachEvents.length, 1);
    assert.equal(attachEvents[0]!.instituteId, null, 'account-scoped event has no institute');
    assert.deepEqual(attachEvents[0]!.metadata, { userId: tTarget!.id, roleKey: 'SUPER_ADMIN', roleId: granted.roleId });

    // Idempotent: same call, same row, no second event.
    await grant(tTarget!.id, 'SUPER_ADMIN');
    assert.equal((await platformRolesOf(tTarget!.id)).length, 1);
    assert.equal((await eventsFor('platform_user.attach', tTarget!.id)).length, 1);

    // Structural rejects, before any write.
    await assert.rejects(grant(tTarget!.id, 'NO_SUCH_ROLE'), BadRequestException);
    await assert.rejects(grant(tTarget!.id, 'INSTITUTE_ADMIN'), BadRequestException, 'institute domain never platform-grantable');
    await assert.rejects(grant(randomUUID(), 'SUPER_ADMIN'), NotFoundException);
  });

  await t.test('3. revokeRole: detach, narrow scope, self-guard, last-guard rollback', async () => {
    // Immediate grant/revoke effect through the real platform guard.
    await grantPlatformRole(ia!.id, 'SUPER_ADMIN');
    await platformPass(listHandler, noInstituteHeader(await sign(ia!.id, sidIA)));
    const revoked = await controller.revokeRole(actor, ia!.id, roleIds.SUPER_ADMIN!);
    assert.equal(revoked.activeSuperAdminsAfter, 3, 's1 + s2 + T(x test2) remain');

    await assert.rejects(platformPass(listHandler, noInstituteHeader(await sign(ia!.id, sidIA))), ForbiddenException, 'platform authority gone on the next request');
    await assert.rejects(platformPass(suspendHandler, noInstituteHeader(await sign(ia!.id, sidIA))), ForbiddenException, 'no platform grant for the mutation plane either');

    const detachEvents = await eventsFor('platform_user.detach', ia!.id);
    assert.equal(detachEvents.length, 1);
    assert.equal(detachEvents[0]!.instituteId, null);
    assert.deepEqual(detachEvents[0]!.metadata, { userId: ia!.id, roleKey: 'SUPER_ADMIN', roleId: roleIds.SUPER_ADMIN, activeSuperAdminsAfter: 3 });

    // Revoking the T SUPER_ADMIN from test 2 — the shared narrower surface.
    const revokedT = await controller.revokeRole(actor, tTarget!.id, roleIds.SUPER_ADMIN!);
    assert.deepEqual(await platformRolesOf(tTarget!.id), []);
    assert.equal(revokedT.activeSuperAdminsAfter, 2);

    // Non-held role → 404, and no event.
    await assert.rejects(controller.revokeRole(actor, tTarget!.id, roleIds.SUPER_ADMIN!), NotFoundException);
    assert.equal((await eventsFor('platform_user.detach', tTarget!.id)).length, 1, 'only the real revoke emitted');

    // Self-revoke → 400, no event, row intact.
    await assert.rejects(service.revokeRole(s1!.id, roleIds.SUPER_ADMIN!, s1!.id), BadRequestException);
    assert.equal((await platformRolesOf(s1!.id)).length, 1, 'row intact after self-revoke rejection');
    assert.equal((await eventsFor('platform_user.detach', s1!.id)).length, 0);
  });

  await t.test('4. suspend: last-guard first (rolled back), then bulk session revocation', async () => {
    // Reduce to a single active SUPER_ADMIN, prove the §10 last-guard fires at
    // the service layer with an actor who contributes no holder count.
    await service.revokeRole(s2!.id, roleIds.SUPER_ADMIN!, s1!.id);
    await assert.rejects(service.suspend(s1!.id, ia!.id), (err: Error) => {
      assert.equal(err.constructor, BadRequestException);
      assert.equal(err.message, 'Cannot suspend the last active Super Admin');
      return true;
    });
    const [s1Row] = await db!.select({ status: users.status }).from(users).where(eq(users.id, s1!.id));
    assert.equal(s1Row!.status, 'active', 'failed suspend fully rolled back');
    assert.equal((await eventsFor('platform_user.suspend', s1!.id)).length, 0, 'no event for the rolled-back mutation');
    await grant(s2!.id, 'SUPER_ADMIN'); // restore the pair

    // Two live sessions, both must die with the account.
    const suspended = await controller.suspend(actor, tt!.id);
    assert.equal(suspended.status, 'deactivated');
    assert.equal(suspended.sessionsRevoked, 2);

    const [ttRow] = await db!.select().from(users).where(eq(users.id, tt!.id));
    assert.equal(ttRow!.status, 'deactivated');
    const sessions = await db!.select().from(authSessions).where(inArray(authSessions.userId, [tt!.id]));
    assert.equal(sessions.length, 2, 'the two live sessions');
    assert.ok(sessions.every((s) => s.revokedAt !== null), 'both live sessions revoked');

    const suspendEvents = await eventsFor('platform_user.suspend', tt!.id);
    assert.equal(suspendEvents.length, 1);
    assert.equal(suspendEvents[0]!.instituteId, null);
    assert.deepEqual(suspendEvents[0]!.metadata, { userId: tt!.id, status: 'deactivated', sessionsRevoked: 2 });

    // No session can authenticate anymore (AccessTokenGuard consults status + revocation).
    await assert.rejects(accessGuard().canActivate(reqContext(suspendHandler, { cookies: { access_token: await sign(tt!.id, sidTt1) } }, 'POST')), UnauthorizedException);
    await assert.rejects(accessGuard().canActivate(reqContext(suspendHandler, { cookies: { access_token: await sign(tt!.id, sidTt2) } }, 'POST')), UnauthorizedException);

    // Self-suspend → 400, conflict on repeat suspend, planes preserved.
    await assert.rejects(service.suspend(s1!.id, s1!.id), BadRequestException);
    await assert.rejects(service.suspend(tt!.id, s1!.id), ConflictException);
    assert.equal((await eventsFor('platform_user.suspend', tt!.id)).length, 1, 'no event for invalid transitions either');
    const [ttMembershipRow] = await db!.select().from(memberships).where(eq(memberships.id, ttMembership!.id));
    assert.equal(ttMembershipRow!.status, 'active', 'membership untouched by global suspension');
  });

  await t.test('4b. status filter reflects a SUSPENDED platform user (TT is not on the platform plane)', async () => {
    // TT is institute-plane only → never in the platform-user list at all.
    const all = await controller.list();
    assert.ok(!all.some((u) => u.id === tt!.id), 'institute-plane suspension is invisible to the platform list');

    // S2 is a real platform user — suspending her must flip the filter.
    await service.suspend(s2!.id, s1!.id);
    const deactivated = await controller.list('deactivated');
    assert.ok(deactivated.some((u) => u.id === s2!.id), 'filter surfaces the suspended platform user');
    const active = await controller.list('active');
    assert.ok(!active.some((u) => u.id === s2!.id), 'active filter excludes her');
    await assert.rejects(controller.list('garbage'), BadRequestException);
    await service.reactivate(s2!.id, s1!.id); // restore: the pair must survive
    assert.ok((await controller.list('active')).some((u) => u.id === s2!.id), 'restored to the active bucket');
  });

  await t.test('5. reactivate: status restored, sessions stay revoked, fresh login works', async () => {
    const reactivated = await controller.reactivate(actor, tt!.id);
    assert.equal(reactivated.status, 'active');

    const [ttRow] = await db!.select().from(users).where(eq(users.id, tt!.id));
    assert.equal(ttRow!.status, 'active');
    const [event] = await eventsFor('platform_user.reactivate', tt!.id);
    assert.equal(event!.instituteId, null);
    assert.deepEqual(event!.metadata, { userId: tt!.id, status: 'active' });

    // Sessions revoked by suspend are NOT resurrected.
    const sessions = await db!.select().from(authSessions).where(inArray(authSessions.userId, [tt!.id]));
    assert.ok(sessions.filter((s) => [sidTt1, sidTt2].includes(s.id)).every((s) => s.revokedAt !== null));

    await assert.rejects(service.reactivate(tt!.id, s1!.id), ConflictException, 'reactivate on active conflicts');
    await assert.rejects(service.reactivate(randomUUID(), s1!.id), NotFoundException);

    // A fresh session authenticates again — account usable, platform plane
    // still closed (no platform role was ever granted to TT). platformPass
    // shares one context so AccessTokenGuard's request.user feeds PlatformGuard.
    const freshSid = await liveSession(tt!.id);
    await assert.rejects(
      platformPass(suspendHandler, { cookies: { access_token: await sign(tt!.id, freshSid) } }),
      ForbiddenException,
      'TT: auth passes, platform grants absent',
    );
  });

  await t.test('6. planes are independent: 403/401 on the platform plane, institute chain unaffected', async () => {
    // IA (INSTITUTE_ADMIN, no platform role) is denied with AND without the tenant header.
    await assert.rejects(platformPass(listHandler, noInstituteHeader(await sign(ia!.id, sidIA))), ForbiddenException);
    await assert.rejects(platformPass(suspendHandler, { headers: { 'x-institute-id': inst!.id }, cookies: { access_token: await sign(ia!.id, sidIA) } }), ForbiddenException);
    // Anonymous → 401.
    await assert.rejects(accessGuard().canActivate(reqContext(listHandler, {}, 'GET')), UnauthorizedException);

    // Membership lifecycle never touches platform authority: S1 holds no
    // membership at all, yet remains fully authorized on the platform plane.
    assert.equal((await db!.select().from(memberships).where(eq(memberships.userId, s1!.id))).length, 0, 'S1 is membership-free');
    await platformPass(listHandler, actorToken(await sign(s1!.id, sidS1)));

    // Narrow revoke (test 3): IA kept its INSTITUTE_ADMIN identity — the full
    // institute chain (access → tenant → roles → permission) still passes.
    await institutePass(buildHandler, { headers: { 'x-institute-id': inst!.id }, cookies: { access_token: await sign(ia!.id, sidIA) } });
  });

  await t.test('7. §8 shared gate: suspended account cannot be re-seated as institute admin', async () => {
    await service.suspend(tt!.id, s1!.id);
    await assert.rejects(
      userService.createInstituteUser(inst!.id, { email: tt!.email, name: 'Re-seat', password: 'wrong horse battery staple', role: 'TEACHER' }),
      (err: Error) => {
        assert.equal(err.constructor, BadRequestException);
        assert.equal(err.message, 'Primary admin user is not active');
        return true;
      },
    );
    // No clone membership was created.
    const membershipsOfTt = await db!.select().from(memberships).where(eq(memberships.userId, tt!.id));
    assert.equal(membershipsOfTt.length, 1, 'only the original membership');
    await service.reactivate(tt!.id, s1!.id);
  });

  await t.test('8. audit trail: events exist iff the mutation committed', async () => {
    // Everything tracked on the platform-user resource; all events institute-less.
    const all = await db!
      .select()
      .from(platformAuditEvents)
      .where(inArray(platformAuditEvents.action, ['platform_user.attach', 'platform_user.detach', 'platform_user.suspend', 'platform_user.reactivate']));
    assert.ok(all.length >= 6, 'expected core lifecycle events');
    assert.ok(all.every((e) => e.instituteId === null), 'account-scoped events never carry an institute');

    // Rolled-back (last-guard) and invalid-transition mutations left no rows:
    // no detach for S1 (self-guard + last-guard in test 3/4) and exactly one
    // suspend for S1's pair-restore misuse of grant (none).
    assert.equal((await eventsFor('platform_user.detach', s1!.id)).length, 0);
    assert.equal((await eventsFor('platform_user.suspend', s1!.id)).length, 0);
  });
});