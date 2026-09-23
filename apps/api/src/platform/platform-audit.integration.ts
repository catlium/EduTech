import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as bcryptjs from 'bcryptjs';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
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

// Phase O.2 platform audit trail (platform-audit-trail.md). Proves the
// append-only `platform_audit_events` write path: each of the six audited
// mutations emits exactly its documented event with the documented metadata
// shape, actor/resource/institute ids, and same-transaction atomicity — an
// event row exists iff the mutation committed, and failed/denied requests and
// rolled-back mutations leave nothing behind. Real controller handlers through
// the REAL guard chain (AccessTokenGuard → PlatformGuard). TEST_DATABASE_URL-
// gated, skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'platform-audit-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

const createHandler = PlatformInstitutesController.prototype.create as unknown as () => void;
const updateHandler = PlatformInstitutesController.prototype.update as unknown as () => void;
const deactivateHandler = PlatformInstitutesController.prototype.deactivate as unknown as () => void;

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
    .values({ email, name: 'Audit Tester', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `audit-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
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

/** Events for a resource, oldest first. */
function eventsFor(resourceId: string) {
  return db!
    .select()
    .from(platformAuditEvents)
    .where(eq(platformAuditEvents.resourceId, resourceId))
    .orderBy(asc(platformAuditEvents.createdAt));
}

test('platform audit trail', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.SUPER_ADMIN, 'built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const slugs: string[] = [];

  const superUser = await createUser(`audit-super-${suffix}@example.test`);
  const instAdmin = await createUser(`audit-admin-${suffix}@example.test`);
  const memberEmail = `audit-member-${suffix}@example.test`;
  const provisionedEmail = `audit-prov-${suffix}@example.test`;
  const deactivatedEmail = `audit-deact-${suffix}@example.test`;
  const deactivatedUser = await createUser(deactivatedEmail);
  const allEmails = [
    `audit-super-${suffix}@example.test`,
    `audit-admin-${suffix}@example.test`,
    memberEmail,
    provisionedEmail,
    deactivatedEmail,
  ];

  // A seed institute (direct insert → itself emits no audit event) for the
  // denial + 409-transition fixtures.
  const [seedInst] = await db!
    .insert(institutes)
    .values({ name: `Audit Seed ${suffix}`, slug: `audit-seed-${suffix}` })
    .returning();
  slugs.push(`audit-seed-${suffix}`);

  const memberUser = await createUser(memberEmail);
  await grantMembership(seedInst!.id, superUser!.id, []);
  await grantMembership(seedInst!.id, instAdmin!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(seedInst!.id, memberUser!.id, []);
  await grantPlatformRole(superUser!.id, 'SUPER_ADMIN');
  await db!.update(users).set({ status: 'deactivated', updatedAt: new Date() }).where(eq(users.id, deactivatedUser!.id));

  const sidAdmin = await liveSession(instAdmin!.id);

  const service = new PlatformInstitutesService(
    db as unknown as Database,
    new RoleAssignmentService(db as unknown as Database),
    new PlatformAuditService(),
  );
  const controller = new PlatformInstitutesController(service);
  const actor = { userId: superUser!.id };

  const noInstituteHeader = (token: string) => ({ cookies: { access_token: token } });
  const adminToken = () => sign(instAdmin!.id, sidAdmin);

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
    await db!
      .delete(platformAuditEvents)
      .where(or(inArray(platformAuditEvents.actorUserId, userIds), inArray(platformAuditEvents.resourceId, instIds)));
    await db!.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db!.delete(memberships).where(inArray(memberships.userId, userIds));
    await db!.delete(platformUserRoles).where(inArray(platformUserRoles.userId, userIds));
    await db!.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db!.delete(instituteSubscriptions).where(inArray(instituteSubscriptions.instituteId, instIds));
    await db!.delete(users).where(inArray(users.email, allEmails));
    await db!.delete(institutes).where(inArray(institutes.slug, slugs));
  });

  await t.test('1. institute.create writes EXACTLY one documented event (actor, resource, institute ids)', async () => {
    const inst = await controller.create(actor, { name: `Audit Create ${suffix}`, slug: `audit-create-${suffix}` });
    slugs.push(`audit-create-${suffix}`);

    const events = await eventsFor(inst.id);
    assert.equal(events.length, 1, 'exactly one event for a plain create');
    const e = events[0]!;
    assert.equal(e.action, 'institute.create');
    assert.equal(e.actorUserId, superUser!.id, 'actor_user_id = authenticated actor');
    assert.equal(e.resourceType, 'institute');
    assert.equal(e.resourceId, inst.id);
    assert.equal(e.instituteId, inst.id, 'institute_id = resource_id for an institute event');
    assert.deepEqual(e.metadata, { name: `Audit Create ${suffix}`, slug: `audit-create-${suffix}`, planCode: 'starter' });
    assert.ok(e.createdAt instanceof Date, 'created_at stamped');
  });

  await t.test('2. institute.primary_admin.attach — provisioned new user', async () => {
    const inst = await controller.create(actor, {
      name: `Audit Prov ${suffix}`,
      slug: `audit-prov-${suffix}`,
      primaryAdmin: { email: provisionedEmail, name: 'Prov Admin' },
    });
    slugs.push(`audit-prov-${suffix}`);

    const events = await eventsFor(inst.id);
    assert.equal(events.length, 2, 'create + attach events');
    const attach = events.find((e) => e.action === 'institute.primary_admin.attach')!;
    assert.equal(attach.actorUserId, superUser!.id);
    assert.equal(attach.resourceId, inst.id);
    assert.equal(attach.instituteId, inst.id);

    const [provUser] = await db!.select().from(users).where(eq(users.email, provisionedEmail));
    assert.ok(provUser, 'new user provisioned');
    const [membership] = await db!
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, provUser!.id), eq(memberships.instituteId, inst.id)));
    assert.ok(membership, 'membership row exists');
    assert.deepEqual(attach.metadata, {
      email: provisionedEmail,
      provisionedUser: true,
      userId: provUser!.id,
      membershipId: membership!.id,
      role: 'INSTITUTE_ADMIN',
    });
  });

  await t.test('3. institute.primary_admin.attach — existing user attached (provisionedUser=false)', async () => {
    const inst = await controller.create(actor, {
      name: `Audit Attach ${suffix}`,
      slug: `audit-attach-${suffix}`,
      primaryAdmin: { email: memberEmail },
    });
    slugs.push(`audit-attach-${suffix}`);

    const events = await eventsFor(inst.id);
    assert.equal(events.length, 2, 'create + attach events');
    const attach = events.find((e) => e.action === 'institute.primary_admin.attach')!;
    assert.equal(attach.actorUserId, superUser!.id);
    const [membership] = await db!
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, memberUser!.id), eq(memberships.instituteId, inst.id)));
    assert.ok(membership, 'membership row exists');
    assert.deepEqual(attach.metadata, {
      email: memberEmail,
      provisionedUser: false,
      userId: memberUser!.id,
      membershipId: membership!.id,
      role: 'INSTITUTE_ADMIN',
    });
  });

  await t.test('4. institute.update — before/after of only the changed fields', async () => {
    const inst = await controller.create(actor, { name: `Audit Upd ${suffix}`, slug: `audit-upd-${suffix}` });
    slugs.push(`audit-upd-${suffix}`);

    await controller.update(actor, inst.id, { name: `Audit Upd Renamed ${suffix}` });
    let events = await eventsFor(inst.id);
    assert.equal(events.length, 2, 'create + update');
    let upd = events.find((e) => e.action === 'institute.update')!;
    assert.deepEqual(upd.metadata, {
      changes: {
        before: { name: `Audit Upd ${suffix}` },
        after: { name: `Audit Upd Renamed ${suffix}` },
      },
    });

    // A slug-only change records the slug pair only.
    await controller.update(actor, inst.id, { slug: `audit-upd-renamed-${suffix}` });
    events = await eventsFor(inst.id);
    assert.equal(events.length, 3, 'create + update + update');
    const updates = events.filter((e) => e.action === 'institute.update');
    upd = updates[updates.length - 1]!;
    assert.deepEqual(upd.metadata, {
      changes: {
        before: { slug: `audit-upd-${suffix}` },
        after: { slug: `audit-upd-renamed-${suffix}` },
      },
    });
  });

  await t.test('5. institute.deactivate / institute.reactivate events', async () => {
    const inst = await controller.create(actor, { name: `Audit Life ${suffix}`, slug: `audit-life-${suffix}` });
    slugs.push(`audit-life-${suffix}`);

    await controller.deactivate(actor, inst.id);
    let events = await eventsFor(inst.id);
    assert.equal(events.length, 2, 'create + deactivate');
    const deact = events.find((e) => e.action === 'institute.deactivate')!;
    assert.deepEqual(deact.metadata, { status: 'deactivated' });
    assert.equal(deact.actorUserId, superUser!.id);
    assert.equal(deact.resourceId, inst.id);
    assert.equal(deact.instituteId, inst.id);

    await controller.reactivate(actor, inst.id);
    events = await eventsFor(inst.id);
    assert.equal(events.length, 3, 'create + deactivate + reactivate');
    const react = events.find((e) => e.action === 'institute.reactivate')!;
    assert.deepEqual(react.metadata, { status: 'active' });
    assert.equal(react.actorUserId, superUser!.id);
  });

  await t.test('6. institute.plan.change — from/to plan codes', async () => {
    const inst = await controller.create(actor, { name: `Audit Plan ${suffix}`, slug: `audit-plan-${suffix}` });
    slugs.push(`audit-plan-${suffix}`);

    await controller.updateSubscription(actor, inst.id, { planCode: 'growth' });
    let events = await eventsFor(inst.id);
    assert.equal(events.length, 2, 'create + plan.change');
    let planEv = events.find((e) => e.action === 'institute.plan.change')!;
    assert.deepEqual(planEv.metadata, { fromPlanCode: 'starter', toPlanCode: 'growth' });
    assert.equal(planEv.actorUserId, superUser!.id);

    await controller.updateSubscription(actor, inst.id, { planCode: 'institute' });
    events = await eventsFor(inst.id);
    assert.equal(events.length, 3);
    const planChanges = events.filter((e) => e.action === 'institute.plan.change');
    planEv = planChanges[planChanges.length - 1]!;
    assert.deepEqual(planEv.metadata, { fromPlanCode: 'growth', toPlanCode: 'institute' });
  });

  await t.test('7. atomicity — a rolled-back mutation leaves NO audit event', async () => {
    const before = await db!.select().from(platformAuditEvents);
    // Duplicate slug → the institute insert violates the unique constraint and
    // the whole tx (any events included) rolls back.
    await assert.rejects(
      controller.create(actor, { name: `Audit Dup ${suffix}`, slug: `audit-create-${suffix}` }),
      ConflictException,
    );
    // A primary-admin failure happens AFTER the institute.create event insert —
    // its rollback must take the event down with it.
    await assert.rejects(
      controller.create(actor, {
        name: `Audit Fail ${suffix}`,
        slug: `audit-fail-${suffix}`,
        primaryAdmin: { email: deactivatedUser!.email },
      }),
      (err: Error) => {
        assert.equal(err.constructor, BadRequestException);
        assert.match(err.message, /not active/);
        return true;
      },
    );

    const after = await db!.select().from(platformAuditEvents);
    assert.equal(after.length, before.length, 'no events from any rolled-back create');
    const failed = await db!.select().from(institutes).where(inArray(institutes.slug, [`audit-fail-${suffix}`]));
    assert.equal(failed.length, 0, 'institute rolled back with its event');
  });

  await t.test('8. failed/denied requests write NO audit event', async () => {
    // 401 anonymous.
    await assert.rejects(accessGuard().canActivate(reqContext(createHandler, {}, 'POST')), UnauthorizedException);
    // 403 non-platform user (even with a tenant header).
    await assert.rejects(platformPass(createHandler, noInstituteHeader(await adminToken()), 'POST'), ForbiddenException);
    await assert.rejects(platformPass(updateHandler, noInstituteHeader(await adminToken()), 'PATCH'), ForbiddenException);
    await assert.rejects(platformPass(deactivateHandler, noInstituteHeader(await adminToken()), 'POST'), ForbiddenException);
    // 404 nonexistent resource.
    const missing = randomUUID();
    await assert.rejects(controller.update(actor, missing, { name: 'x' }), NotFoundException);
    await assert.rejects(controller.deactivate(actor, missing), NotFoundException);
    await assert.rejects(controller.updateSubscription(actor, missing, { planCode: 'growth' }), NotFoundException);
    // 400 invalid plan → mutation never runs.
    await assert.rejects(controller.updateSubscription(actor, seedInst!.id, { planCode: 'vault' }), BadRequestException);

    // 409 invalid lifecycle transition → 0-row update, no second event. The
    // seed institute starts active; the first deactivate is a real (audited)
    // mutation and the repeated call is the denied one.
    const eventsBefore = await eventsFor(seedInst!.id);
    assert.equal(eventsBefore.length, 0, 'no events on the seed before this step');
    await controller.deactivate(actor, seedInst!.id);
    await assert.rejects(controller.deactivate(actor, seedInst!.id), ConflictException);
    const eventsAfter = await eventsFor(seedInst!.id);
    assert.equal(eventsAfter.length, 1, 'exactly the successful deactivate is recorded');
  });

  await t.test('9. repeated valid mutations are SEPARATE append-only events', async () => {
    const inst = await controller.create(actor, { name: `Audit Rep ${suffix}`, slug: `audit-rep-${suffix}` });
    slugs.push(`audit-rep-${suffix}`);

    await controller.update(actor, inst.id, { name: `Audit Rep A ${suffix}` });
    await controller.update(actor, inst.id, { name: `Audit Rep B ${suffix}` });
    const events = await eventsFor(inst.id);
    assert.equal(events.length, 3, 'create + update + update');
    const updates = events.filter((e) => e.action === 'institute.update');
    assert.equal(updates.length, 2);
    assert.notEqual(updates[0]!.id, updates[1]!.id, 'distinct ids');
    assert.deepEqual(updates[0]!.metadata, {
      changes: { before: { name: `Audit Rep ${suffix}` }, after: { name: `Audit Rep A ${suffix}` } },
    });
    assert.deepEqual(updates[1]!.metadata, {
      changes: { before: { name: `Audit Rep A ${suffix}` }, after: { name: `Audit Rep B ${suffix}` } },
    });
    assert.ok(updates[1]!.createdAt >= updates[0]!.createdAt, 'appended in order');
  });
});