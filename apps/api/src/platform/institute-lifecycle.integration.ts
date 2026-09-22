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
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { PlatformGuard } from '../authorization/platform.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { PlatformInstitutesController } from './platform-institutes.controller.ts';
import { PlatformInstitutesService } from './platform-institutes.service.ts';

// Phase N.2 regression matrix for the platform-plane institute lifecycle
// mutations (institute-lifecycle §7). Runs the REAL guard chain
// (AccessTokenGuard → PlatformGuard) against the REAL controller handlers —
// the @RequiredPermission('institutes.update') metadata comes straight off the
// controller prototype — and drives the REAL controller/service mutation,
// then proves the tenant-side effect through the REAL TenantGuard. Requires a
// live database (TEST_DATABASE_URL); skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'institute-lifecycle-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

// Real controller methods carry the guard metadata.
const deactivateHandler = PlatformInstitutesController.prototype.deactivate as unknown as () => void;
const reactivateHandler = PlatformInstitutesController.prototype.reactivate as unknown as () => void;

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
    .values({ email, name: 'Lifecycle Tester', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `life-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
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
async function platformPass(handler: (...args: unknown[]) => unknown, request: { cookies?: Record<string, string>; headers?: Record<string, string> }) {
  const ctx = reqContext(handler, request, 'POST');
  await accessGuard().canActivate(ctx);
  await platformGuard().canActivate(ctx);
  return ctx;
}

test('institute lifecycle mutations', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.TEACHER && roleIds.SUPER_ADMIN, 'built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const slug = `life-${suffix}`;
  const [inst] = await db!.insert(institutes).values({ name: `Lifecycle Target ${suffix}`, slug }).returning();

  const superUser = await createUser(`super-${suffix}@example.test`);
  const instAdmin = await createUser(`admin-${suffix}@example.test`);
  const teacher = await createUser(`teacher-${suffix}@example.test`);

  const superMembership = await grantMembership(inst!.id, superUser!.id, []);
  const adminMembership = await grantMembership(inst!.id, instAdmin!.id, ['INSTITUTE_ADMIN']);
  const teacherMembership = await grantMembership(inst!.id, teacher!.id, ['TEACHER']);
  await grantPlatformRole(superUser!.id, 'SUPER_ADMIN');

  const [subject] = await db!
    .insert(subjects)
    .values({ instituteId: inst!.id, name: `History ${suffix}`, slug: `history-${suffix}` })
    .returning();

  const sidAdmin = await liveSession(instAdmin!.id);
  const sidTeacher = await liveSession(teacher!.id);

  const service = new PlatformInstitutesService(db as unknown as Database);
  const controller = new PlatformInstitutesController(service);
  const noInstituteHeader = (token: string) => ({ cookies: { access_token: token } });
  const withInstitute = (token: string) => ({ headers: { 'x-institute-id': inst!.id }, cookies: { access_token: token } });

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
    await db.delete(subjects).where(eq(subjects.instituteId, inst!.id));
    await db.delete(institutes).where(inArray(institutes.slug, [slug]));
    void superMembership;
    void adminMembership;
    void teacherMembership;
    void subject;
  });

  await t.test('1. SUPER_ADMIN deactivates via the platform plane', async () => {
    await platformPass(deactivateHandler, noInstituteHeader(await sign(superUser!.id, await liveSession(superUser!.id))));
    const result = await controller.deactivate(inst!.id);
    assert.equal(result.id, inst!.id);
    assert.equal(result.status, 'deactivated');
    assert.ok(result.deactivatedAt instanceof Date, 'deactivated_at stamped');
    const [row] = await db!.select().from(institutes).where(eq(institutes.id, inst!.id));
    assert.equal(row!.status, 'deactivated');
  });

  await t.test('2. non-platform users are denied on both mutations', async () => {
    const superSession = await liveSession(superUser!.id);
    const token = await sign(superUser!.id, superSession);
    // Anonymous → 401 at AccessTokenGuard.
    await assert.rejects(accessGuard().canActivate(reqContext(deactivateHandler, {}, 'POST')), UnauthorizedException);
    // INSTITUTE_ADMIN membership — with a tenant header, still no platform grant → 403.
    await assert.rejects(platformPass(deactivateHandler, withInstitute(await sign(instAdmin!.id, sidAdmin))), ForbiddenException);
    // TEACHER → 403.
    await assert.rejects(platformPass(reactivateHandler, noInstituteHeader(await sign(teacher!.id, sidTeacher))), ForbiddenException);
    // SUPER_ADMIN passes both mutations' guards (no x-institute-id needed).
    await platformPass(deactivateHandler, noInstituteHeader(token));
    await platformPass(reactivateHandler, noInstituteHeader(token));
  });

  await t.test('3. deactivate → tenant access 403 on the next request', async () => {
    // Institute is deactivated after test 1; run the real tenant chain with
    // still-active membership + live session → TenantGuard rejects.
    const ctx = reqContext(deactivateHandler, withInstitute(await sign(instAdmin!.id, sidAdmin)), 'POST');
    await accessGuard().canActivate(ctx);
    await assert.rejects(tenantGuard().canActivate(ctx), (err: Error) => {
      assert.equal(err.constructor, ForbiddenException);
      assert.equal(err.message, 'Institute is not active');
      return true;
    });
  });

  await t.test('4. reactivate → tenant access restored on the next request', async () => {
    await platformPass(reactivateHandler, noInstituteHeader(await sign(superUser!.id, await liveSession(superUser!.id))));
    const result = await controller.reactivate(inst!.id);
    assert.equal(result.status, 'active');
    assert.equal(result.deactivatedAt, null, 'deactivated_at cleared');

    const ctx = reqContext(deactivateHandler, withInstitute(await sign(instAdmin!.id, sidAdmin)), 'POST');
    await accessGuard().canActivate(ctx);
    await tenantGuard().canActivate(ctx);
    const tenant = ctx.switchToHttp().getRequest()['tenant'] as { instituteId: string };
    assert.equal(tenant.instituteId, inst!.id);
  });

  await t.test('5. repeated invalid state transitions conflict', async () => {
    // Deactivate → deactivate again conflicts.
    await service.deactivate(inst!.id);
    await assert.rejects(service.deactivate(inst!.id), (err: Error) => {
      assert.equal(err.constructor, ConflictException);
      return true;
    });
    // Reactivate → reactivate again conflicts (doubles back to active).
    await service.reactivate(inst!.id);
    await assert.rejects(service.reactivate(inst!.id), ConflictException);
  });

  await t.test('6. invalid and nonexistent institutes fail safely', async () => {
    // Nonexistent id → 404.
    await assert.rejects(service.deactivate(randomUUID()), NotFoundException);
    await assert.rejects(service.reactivate(randomUUID()), NotFoundException);
    // Non-UUID id → 400 (ParseUUIDPipe, the routing boundary).
    await assert.rejects(new ParseUUIDPipe().transform('not-a-uuid', { type: 'param', metatype: String, data: 'id' }), BadRequestException);
  });

  await t.test('7. memberships, institute data, and sessions are untouched', async () => {
    const [instRow] = await db!.select().from(institutes).where(eq(institutes.id, inst!.id));
    assert.equal(instRow!.name, `Lifecycle Target ${suffix}`, 'name preserved');
    assert.equal(instRow!.slug, slug, 'slug preserved');

    const [membership] = await db!.select().from(memberships).where(eq(memberships.id, adminMembership!.id));
    assert.equal(membership!.status, 'active', 'membership stays active');

    const [keptSubject] = await db!.select().from(subjects).where(eq(subjects.id, subject!.id));
    assert.ok(keptSubject, 'institute data (subject row) survives');
    assert.equal(keptSubject!.slug, `history-${suffix}`);

    const sessions = await db!.select().from(authSessions).where(inArray(authSessions.userId, [instAdmin!.id, teacher!.id]));
    assert.equal(sessions.length, 2, 'auth sessions not revoked/removed');
    assert.ok(sessions.every((s) => s.revokedAt === null), 'sessions remain live');
  });
});