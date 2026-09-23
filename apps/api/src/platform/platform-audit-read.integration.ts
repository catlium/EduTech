import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as bcryptjs from 'bcryptjs';
import { eq, inArray, or } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
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
  instituteSubscriptions,
  platformAuditEvents,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { PlatformGuard } from '../authorization/platform.guard.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { PlatformInstitutesController } from './platform-institutes.controller.ts';
import { PlatformInstitutesService } from './platform-institutes.service.ts';
import { PlatformAuditService } from './platform-audit.service.ts';

// Phase O.3 platform audit READ surface (platform-audit-trail §10). Proves the
// GET :id/audit-events endpoint is strictly institute-scoped, newest-first,
// paginated, actor-resolved, and gated institutes.manage via the real guard
// chain (AccessTokenGuard → PlatformGuard) — no TenantGuard, no x-institute-id.
// TEST_DATABASE_URL-gated, skips cleanly when unset. Note: platform domains
// only allow SYSTEM roles (§15 / roles_platform_kind_check), so EVERY
// platform-role user holds all platform keys — a "platform user without
// institutes.manage" cannot be constructed in the DB; insufficient-permission
// denial is therefore proven by the auth-valid-but-no-platform-role 403 case.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'platform-audit-read-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

const auditEventsHandler = PlatformInstitutesController.prototype.auditEvents as unknown as () => void;

function reqContext(
  handler: (...args: unknown[]) => unknown,
  request: { cookies?: Record<string, string>; headers?: Record<string, string> },
  method = 'GET',
) {
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
    .values({ email, name: 'Audit Read Tester', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `audit-read-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
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
  const rows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'SUPER_ADMIN']));
  roleIds = Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const platformGuard = () => new PlatformGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

async function platformPass(
  handler: (...args: unknown[]) => unknown,
  request: { cookies?: Record<string, string>; headers?: Record<string, string> },
  method = 'GET',
) {
  const ctx = reqContext(handler, request, method);
  await accessGuard().canActivate(ctx);
  await platformGuard().canActivate(ctx);
  return ctx;
}

test('platform audit read surface', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.SUPER_ADMIN, 'built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const slugs: string[] = [];

  const superEmail = `audit-read-super-${suffix}@example.test`;
  const adminEmail = `audit-read-admin-${suffix}@example.test`;
  const superUser = await createUser(superEmail);
  const instAdmin = await createUser(adminEmail);
  const allEmails = [superEmail, adminEmail];

  await grantPlatformRole(superUser!.id, 'SUPER_ADMIN');

  // A seed institute with NO events yet (direct insert → no audit row).
  const [seedInst] = await db!
    .insert(institutes)
    .values({ name: `Audit Read Seed ${suffix}`, slug: `audit-read-seed-${suffix}` })
    .returning();
  slugs.push(`audit-read-seed-${suffix}`);
  const seedInstId = seedInst!.id;
  await grantMembership(seedInstId, instAdmin!.id, ['INSTITUTE_ADMIN']);

  const sidSuper = await liveSession(superUser!.id);
  const sidAdmin = await liveSession(instAdmin!.id);

  const service = new PlatformInstitutesService(
    db as unknown as Database,
    new RoleAssignmentService(db as unknown as Database),
    new PlatformAuditService(),
  );
  const controller = new PlatformInstitutesController(service);

  const noInstituteHeader = (token: string) => ({ cookies: { access_token: token } });
  const readPass = (token: string) => platformPass(auditEventsHandler, noInstituteHeader(token), 'GET');

  t.after(async () => {
    if (!db) return;
    const userIds = (await db!.select({ id: users.id }).from(users).where(inArray(users.email, allEmails))).map((r) => r.id!);
    if (userIds.length === 0) return;
    const membershipIds = (
      await db!.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))
    ).map((r) => r.id!);
    const instIds = (
      await db!.select({ id: institutes.id }).from(institutes).where(inArray(institutes.slug, slugs))
    ).map((r) => r.id!);
    await db!.delete(platformAuditEvents).where(or(inArray(platformAuditEvents.resourceId, instIds)));
    await db!.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db!.delete(memberships).where(inArray(memberships.userId, userIds));
    await db!.delete(platformUserRoles).where(inArray(platformUserRoles.userId, userIds));
    await db!.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db!.delete(instituteSubscriptions).where(inArray(instituteSubscriptions.instituteId, instIds));
    await db!.delete(users).where(inArray(users.email, allEmails));
    await db!.delete(institutes).where(inArray(institutes.slug, slugs));
  });

  await t.test('1. SUPER_ADMIN reads recorded mutations newest-first with resolved actor', async () => {
    const inst = await controller.create({ userId: superUser!.id }, {
      name: `Audit Read One ${suffix}`,
      slug: `audit-read-one-${suffix}`,
    });
    slugs.push(`audit-read-one-${suffix}`);
    await controller.update({ userId: superUser!.id }, inst.id, { name: `Audit Read One B ${suffix}` });

    await readPass(await sign(superUser!.id, sidSuper));

    const page = await controller.auditEvents(inst.id, undefined, undefined);
    assert.equal(page.total, 2, 'create + update');
    assert.equal(page.limit, 50, 'default limit');
    assert.equal(page.offset, 0, 'default offset');
    assert.equal(page.events[0]!.action, 'institute.update', 'newest first');
    assert.equal(page.events[1]!.action, 'institute.create');
    for (const e of page.events) {
      assert.equal(e.resourceType, 'institute');
      assert.equal(e.instituteId, inst.id, 'strictly scoped to the institute');
      assert.ok(e.createdAt instanceof Date);
      assert.equal(e.actor!.userId, superUser!.id, 'actor resolved');
      assert.equal(e.actor!.email, superEmail);
      assert.equal(e.actor!.name, 'Audit Read Tester');
    }
  });

  await t.test('2. no cross-institute leakage', async () => {
    const a = (await controller.create({ userId: superUser!.id }, {
      name: `Audit Read A ${suffix}`,
      slug: `audit-read-a-${suffix}`,
    })).id;
    const b = (await controller.create({ userId: superUser!.id }, {
      name: `Audit Read B ${suffix}`,
      slug: `audit-read-b-${suffix}`,
    })).id;
    slugs.push(`audit-read-a-${suffix}`, `audit-read-b-${suffix}`);

    const pageA = await controller.auditEvents(a, '100', '0');
    const pageB = await controller.auditEvents(b, '100', '0');
    assert.equal(pageA.total, 1);
    assert.equal(pageB.total, 1);
    assert.ok(pageA.events.every((e) => e.instituteId === a), 'only institute A events');
    assert.ok(pageB.events.every((e) => e.instituteId === b), 'only institute B events');
    assert.notEqual(pageA.events[0]!.id, pageB.events[0]!.id, 'distinct event ids');
  });

  await t.test('3. pagination — limit/offset/total and bounds', async () => {
    const [inst] = await db!.insert(institutes).values({
      name: `Audit Read Page ${suffix}`,
      slug: `audit-read-page-${suffix}`,
    }).returning();
    slugs.push(`audit-read-page-${suffix}`);
    for (let i = 0; i < 5; i += 1) {
      await db!.insert(platformAuditEvents).values({
        actorUserId: superUser!.id,
        action: 'institute.update',
        resourceType: 'institute',
        resourceId: inst!.id,
        instituteId: inst!.id,
        metadata: { n: i },
      });
    }

    const first = await controller.auditEvents(inst!.id, '2', '0');
    assert.equal(first.total, 5);
    assert.equal(first.events.length, 2);

    const second = await controller.auditEvents(inst!.id, '2', '2');
    const third = await controller.auditEvents(inst!.id, '2', '4');
    assert.equal(second.events.length, 2);
    assert.equal(third.events.length, 1, 'last page partial');

    const ids = [...first.events, ...second.events, ...third.events].map((e) => e.id);
    assert.equal(new Set(ids).size, 5, 'no overlap across pages');

    // Bounds: limit clamped to 1..100, offset floor 0, default limit 50.
    assert.equal((await controller.auditEvents(inst!.id, '0', '0')).limit, 50, 'limit 0 → default 50');
    assert.equal((await controller.auditEvents(inst!.id, '0', '0')).offset, 0);
    assert.equal((await controller.auditEvents(inst!.id, '1000', '0')).limit, 100, 'limit clamped to 100');
    assert.equal((await controller.auditEvents(inst!.id, '100', '-5')).offset, 0, 'negative offset → 0');
    assert.equal((await controller.auditEvents(inst!.id, '100', '0')).total, 5);
  });

  await t.test('4. empty history → empty page, total 0', async () => {
    const page = await controller.auditEvents(seedInstId, '50', '0');
    assert.equal(page.total, 0);
    assert.deepEqual(page.events, []);
  });

  await t.test('5. nonexistent institute → 404', async () => {
    await assert.rejects(controller.auditEvents(randomUUID(), '50', '0'), NotFoundException);
  });

  await t.test('6. actor resolves even after deactivation; system actor → null', async () => {
    await db!.update(users).set({ status: 'deactivated', updatedAt: new Date() }).where(eq(users.id, superUser!.id));
    const inst = (await controller.create({ userId: superUser!.id }, {
      name: `Audit Read Deact ${suffix}`,
      slug: `audit-read-deact-${suffix}`,
    })).id;
    slugs.push(`audit-read-deact-${suffix}`);

    const page = await controller.auditEvents(inst, '50', '0');
    assert.equal(page.events[0]!.actor!.email, superEmail, 'deactivated actor still resolves');

    await db!.insert(platformAuditEvents).values({
      actorUserId: null,
      action: 'institute.update',
      resourceType: 'institute',
      resourceId: inst,
      instituteId: inst,
      metadata: {},
    });
    const withSystem = await controller.auditEvents(inst, '50', '0');
    assert.equal(withSystem.total, 2);
    assert.equal(withSystem.events[0]!.actor, null, 'system actor → null');
    assert.deepEqual(withSystem.events[0]!.metadata, {}, 'metadata passes through verbatim');
  });

  await t.test('7. authz denial — 401 anonymous, 403 non-platform user', async () => {
    await assert.rejects(accessGuard().canActivate(reqContext(auditEventsHandler, {}, 'GET')), UnauthorizedException);
    await assert.rejects(readPass(await sign(instAdmin!.id, sidAdmin)), ForbiddenException, 'membership-only user denied');
    await assert.rejects(controller.auditEvents(randomUUID(), '50', '0'), NotFoundException);
  });
});