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
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  subjects,
  platformUserRoles,
  roles,
  institutes,
  plans,
  instituteSubscriptions,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { PlatformGuard } from '../authorization/platform.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { PlatformInstitutesController } from './platform-institutes.controller.ts';
import { PlatformInstitutesService } from './platform-institutes.service.ts';

// Phase N.3 regression matrix for the platform-plane subscription management
// API (institute-lifecycle §9/§11): GET/PUT /platform/institutes/:id/
// subscription through the REAL guard chain (AccessTokenGuard → PlatformGuard)
// against the REAL controller handlers. Proves: SUPER_ADMIN read/write;
// institute-plane users denied; nonexistent institutes 404; invalid/inactive
// plans 400; valid plan transitions; one-row-per-institute upsert invariant;
// subscription changes never bypass or alter the institute lifecycle gate
// (TenantGuard stays the sole tenant-access authority); no cross-tenant
// exposure. TEST_DATABASE_URL-gated, skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'plan-subscription-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

const subscriptionHandler = PlatformInstitutesController.prototype.subscription as unknown as () => void;
const updateSubscriptionHandler = PlatformInstitutesController.prototype.updateSubscription as unknown as () => void;

function reqContext(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }, method = 'GET') {
  const req = { headers: {}, method, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => PlatformInstitutesController,
  } as unknown as ExecutionContext;
}

async function createUser(email: string) {
  const [user] = await db!
    .insert(users)
    .values({ email, name: 'Subscription Tester', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `sub-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
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
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const platformGuard = () => new PlatformGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

/** AccessTokenGuard + PlatformGuard with the real handler metadata. */
async function platformPass(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }, method = 'GET') {
  const ctx = reqContext(handler, request, method);
  await accessGuard().canActivate(ctx);
  await platformGuard().canActivate(ctx);
  return ctx;
}

test('platform subscription management', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.TEACHER && roleIds.SUPER_ADMIN, 'built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const slug = `sub-${suffix}`;
  const slugB = `sub-b-${suffix}`;
  const [instA] = await db!.insert(institutes).values({ name: `Sub Target A ${suffix}`, slug }).returning();
  const [instB] = await db!.insert(institutes).values({ name: `Sub Target B ${suffix}`, slug: slugB }).returning();

  const superUser = await createUser(`super-${suffix}@example.test`);
  const instAdmin = await createUser(`admin-${suffix}@example.test`);
  const teacher = await createUser(`teacher-${suffix}@example.test`);

  const superMembership = await grantMembership(instA!.id, superUser!.id, []);
  const adminMembership = await grantMembership(instA!.id, instAdmin!.id, ['INSTITUTE_ADMIN']);
  const teacherMembership = await grantMembership(instA!.id, teacher!.id, ['TEACHER']);
  await grantPlatformRole(superUser!.id, 'SUPER_ADMIN');

  const [subject] = await db!
    .insert(subjects)
    .values({ instituteId: instA!.id, name: `Hist ${suffix}`, slug: `sub-hist-${suffix}` })
    .returning();

  const sidSuper = await liveSession(superUser!.id);
  const sidAdmin = await liveSession(instAdmin!.id);
  const sidTeacher = await liveSession(teacher!.id);

  const service = new PlatformInstitutesService(db as unknown as Database);
  const controller = new PlatformInstitutesController(service);

  const planRows = await db!.select().from(plans);
  const planCodes = planRows.map((p) => p.code);
  assert.deepEqual(planCodes.sort(), ['growth', 'institute', 'starter'], 'seeded plan catalog');

  const noInstituteHeader = (token: string) => ({ cookies: { access_token: token } });
  const withInstitute = (token: string) => ({ headers: { 'x-institute-id': instA!.id }, cookies: { access_token: token } });

  const superToken = () => sign(superUser!.id, sidSuper);
  const adminToken = () => sign(instAdmin!.id, sidAdmin);
  const teacherToken = () => sign(teacher!.id, sidTeacher);

  t.after(async () => {
    if (!db) return;
    const emails = [`super-${suffix}@example.test`, `admin-${suffix}@example.test`, `teacher-${suffix}@example.test`];
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
    await db.delete(subjects).where(inArray(subjects.instituteId, [instA!.id, instB!.id]));
    await db.delete(instituteSubscriptions).where(inArray(instituteSubscriptions.instituteId, [instA!.id, instB!.id]));
    await db.delete(institutes).where(inArray(institutes.slug, [slug, slugB]));
    void superMembership;
    void adminMembership;
    void teacherMembership;
    void subject;
  });

  await t.test('1. SUPER_ADMIN reads the subscription', async () => {
    await service.updateSubscription(instA!.id, { planCode: 'growth' });
    await platformPass(subscriptionHandler, noInstituteHeader(await superToken()));
    const result = await controller.subscription(instA!.id);
    assert.equal(result.instituteId, instA!.id);
    assert.equal(result.planCode, 'growth');
    assert.equal(result.planName, 'Growth');
    assert.ok(result.updatedAt instanceof Date);
  });

  await t.test('2. SUPER_ADMIN updates the subscription (switch plan)', async () => {
    await platformPass(updateSubscriptionHandler, noInstituteHeader(await superToken()), 'PUT');
    const result = await controller.updateSubscription(instA!.id, { planCode: 'institute' });
    assert.equal(result.planCode, 'institute');
    const [row] = await db!.select().from(instituteSubscriptions).where(eq(instituteSubscriptions.instituteId, instA!.id));
    assert.equal(row!.planId, planRows.find((p) => p.code === 'institute')!.id);
    const [instRow] = await db!.select().from(institutes).where(eq(institutes.id, instA!.id));
    assert.equal(instRow!.status, 'active', 'plan switch does not touch institute status');
  });

  await t.test('3. non-platform/institute users are denied', async () => {
    // Anonymous → 401 at AccessTokenGuard.
    await assert.rejects(accessGuard().canActivate(reqContext(subscriptionHandler, {}, 'GET')), UnauthorizedException);
    // INSTITUTE_ADMIN — even with a tenant header, no platform grant → 403.
    await assert.rejects(
      platformPass(subscriptionHandler, withInstitute(await adminToken()), 'GET'),
      ForbiddenException,
    );
    // TEACHER → 403 on both read and write.
    await assert.rejects(
      platformPass(updateSubscriptionHandler, noInstituteHeader(await teacherToken()), 'PUT'),
      ForbiddenException,
    );
    await assert.rejects(
      platformPass(subscriptionHandler, noInstituteHeader(await teacherToken()), 'GET'),
      ForbiddenException,
    );
    // SUPER_ADMIN passes both (no x-institute-id needed).
    await platformPass(subscriptionHandler, noInstituteHeader(await superToken()), 'GET');
    await platformPass(updateSubscriptionHandler, noInstituteHeader(await superToken()), 'PUT');
  });

  await t.test('4. nonexistent institute and invalid id fail safely', async () => {
    const missing = randomUUID();
    await assert.rejects(service.getSubscription(missing), NotFoundException);
    await assert.rejects(service.updateSubscription(missing, { planCode: 'starter' }), NotFoundException);
    await assert.rejects(
      new ParseUUIDPipe().transform('not-a-uuid', { type: 'param', metatype: String, data: 'id' }),
      BadRequestException,
    );
  });

  await t.test('5. invalid and inactive plans are rejected', async () => {
    await assert.rejects(service.updateSubscription(instA!.id, { planCode: 'vault' }), (err: Error) => {
      assert.equal(err.constructor, BadRequestException);
      assert.match(err.message, /'vault' is unknown or not active/);
      return true;
    });
    // Deactivate a seeded plan in the DB → it must become unassignable.
    const target = planRows.find((p) => p.code === 'growth')!;
    await db!.update(plans).set({ isActive: false, updatedAt: new Date() }).where(eq(plans.id, target.id));
    await assert.rejects(service.updateSubscription(instA!.id, { planCode: 'growth' }), (err: Error) => {
      assert.equal(err.constructor, BadRequestException);
      assert.match(err.message, /'growth' is unknown or not active/);
      return true;
    });
    await db!.update(plans).set({ isActive: true, updatedAt: new Date() }).where(eq(plans.id, target.id));
  });

  await t.test('6. valid plan transitions round-trip', async () => {
    for (const code of ['starter', 'growth', 'institute', 'starter']) {
      await platformPass(updateSubscriptionHandler, noInstituteHeader(await superToken()), 'PUT');
      const result = await controller.updateSubscription(instA!.id, { planCode: code });
      assert.equal(result.planCode, code);
    }
  });

  await t.test('7. one subscription row per institute (upsert invariant)', async () => {
    for (let i = 0; i < 5; i++) {
      await service.updateSubscription(instA!.id, { planCode: i % 2 ? 'growth' : 'starter' });
    }
    const rows = await db!.select().from(instituteSubscriptions).where(eq(instituteSubscriptions.instituteId, instA!.id));
    assert.equal(rows.length, 1, 'repeated upserts never create a second row');
    // Institute B stays independent (its own row / none).
    const rowsB = await db!.select().from(instituteSubscriptions).where(eq(instituteSubscriptions.instituteId, instB!.id));
    assert.equal(rowsB.length, 0, 'institute B untouched by A writes');
  });

  await t.test('8. subscription changes do not bypass or alter institute lifecycle access', async () => {
    // Move A to 'growth', then deactivate A via the real lifecycle mutation.
    await service.updateSubscription(instA!.id, { planCode: 'growth' });
    await service.deactivate(instA!.id);

    // Tenant plane: deactivated institute → TenantGuard 403 next request.
    const ctx = reqContext(subscriptionHandler, withInstitute(await adminToken()), 'GET');
    await accessGuard().canActivate(ctx);
    await assert.rejects(tenantGuard().canActivate(ctx), (err: Error) => {
      assert.equal(err.constructor, ForbiddenException);
      assert.equal(err.message, 'Institute is not active');
      return true;
    });

    // Platform plane: subscription read/write still work on a deactivated
    // institute — and must NOT reactivate it (status/deactivated_at unchanged).
    await platformPass(subscriptionHandler, noInstituteHeader(await superToken()), 'GET');
    const readBack = await controller.subscription(instA!.id);
    assert.equal(readBack.planCode, 'growth');
    await platformPass(updateSubscriptionHandler, noInstituteHeader(await superToken()), 'PUT');
    await controller.updateSubscription(instA!.id, { planCode: 'institute' });
    const [stillDeactivated] = await db!.select().from(institutes).where(eq(institutes.id, instA!.id));
    assert.equal(stillDeactivated!.status, 'deactivated', 'plan switch on deactivated institute leaves it deactivated');
    assert.ok(stillDeactivated!.deactivatedAt instanceof Date, 'deactivated_at preserved');

    // Reactivation (lifecycle mutation) changes only institute status.
    await service.reactivate(instA!.id);
    const [reactivated] = await db!.select().from(institutes).where(eq(institutes.id, instA!.id));
    assert.equal(reactivated!.status, 'active');
    const [afterReact] = await db!.select().from(instituteSubscriptions).where(eq(instituteSubscriptions.instituteId, instA!.id));
    assert.equal(afterReact!.planId, planRows.find((p) => p.code === 'institute')!.id, 'subscription survives lifecycle flips');

    // Institute scoped access restored on the next request.
    const ctx2 = reqContext(subscriptionHandler, withInstitute(await adminToken()), 'GET');
    await accessGuard().canActivate(ctx2);
    await tenantGuard().canActivate(ctx2);
    const tenant = ctx2.switchToHttp().getRequest()['tenant'] as { instituteId: string };
    assert.equal(tenant.instituteId, instA!.id);
  });

  await t.test('9. no cross-tenant data exposure', async () => {
    await service.updateSubscription(instA!.id, { planCode: 'starter' });
    await service.updateSubscription(instB!.id, { planCode: 'institute' });
    const a = await controller.subscription(instA!.id);
    const b = await controller.subscription(instB!.id);
    assert.equal(a.instituteId, instA!.id);
    assert.equal(a.planCode, 'starter');
    assert.equal(b.instituteId, instB!.id);
    assert.equal(b.planCode, 'institute');
    // A's SUPER_ADMIN reading B never sees A's plan, and vice versa.
    assert.notEqual(a.planCode, b.planCode);
  });
});