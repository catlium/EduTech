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
  ValidationPipe,
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
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { PlatformGuard } from '../authorization/platform.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { PlatformInstitutesController } from './platform-institutes.controller.ts';
import { PlatformInstitutesService } from './platform-institutes.service.ts';
import { CreateInstituteDto, UpdateInstituteDto } from './platform-institutes.dto.ts';

// Phase N.4 regression matrix for the platform-plane institute management API
// (institute-lifecycle §5/§6/§11): GET/POST /platform/institutes, GET/PATCH
// /platform/institutes/:id, GET /platform/institutes/:id/admins through the
// REAL guard chain (AccessTokenGuard → PlatformGuard) against the REAL
// controller handlers. Proves: SUPER_ADMIN list/detail/create/update;
// non-platform users denied; duplicate slug 409; invalid/nonexistent institute
// 404/400; primary-admin provisioning + attachment via the documented flow with
// correct membership + INSTITUTE_ADMIN grant; tenant isolation; deactivated
// institute visibility on the platform plane; deactivate/reactivate unchanged;
// subscription independent from institute lifecycle. TEST_DATABASE_URL-gated,
// skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'institute-crud-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

const listHandler = PlatformInstitutesController.prototype.list as unknown as () => void;
const createHandler = PlatformInstitutesController.prototype.create as unknown as () => void;
const getHandler = PlatformInstitutesController.prototype.get as unknown as () => void;
const updateHandler = PlatformInstitutesController.prototype.update as unknown as () => void;
const adminsHandler = PlatformInstitutesController.prototype.admins as unknown as () => void;
const deactivateHandler = PlatformInstitutesController.prototype.deactivate as unknown as () => void;
const reactivateHandler = PlatformInstitutesController.prototype.reactivate as unknown as () => void;
const subscriptionHandler = PlatformInstitutesController.prototype.subscription as unknown as () => void;
const updateSubscriptionHandler = PlatformInstitutesController.prototype.updateSubscription as unknown as () => void;

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
    .values({ email, name: 'Crud Tester', passwordHash: await hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({ userId, refreshTokenHash: `crud-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
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

// The production global pipe (apps/api/src/main.ts) — used to prove DTO-level
// validation without booting the app.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

test('platform institute management', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  await loadRoleIds();
  assert.ok(roleIds.INSTITUTE_ADMIN && roleIds.TEACHER && roleIds.SUPER_ADMIN, 'built-in roles seeded');

  const suffix = randomUUID().slice(0, 8);
  const slugA = `crud-a-${suffix}`;
  const slugB = `crud-b-${suffix}`;
  const slugC = `crud-c-${suffix}`;
  const slugD = `crud-d-${suffix}`;
  const slugE = `crud-e-${suffix}`;
  const slugF = `crud-f-${suffix}`;
  const slugG = `crud-g-${suffix}`;
  const slugs = [slugA, slugB, slugC, slugD, slugE, slugF, slugG, `crud-seed-${suffix}`];

  // Seed institute (direct insert) so the denial/tenant-isolation fixtures
  // have a tenant to bind memberships to.
  const [seedInst] = await db!
    .insert(institutes)
    .values({ name: `Crud Seed ${suffix}`, slug: `crud-seed-${suffix}` })
    .returning();

  const superUser = await createUser(`crud-super-${suffix}@example.test`);
  const instAdmin = await createUser(`crud-admin-${suffix}@example.test`);
  const teacher = await createUser(`crud-teacher-${suffix}@example.test`);
  // Provisioned/attached primary-admin identities + a deactivated-user case.
  const provAdminEmail = `crud-prov-${suffix}@example.test`;
  const attachEmail = `crud-attach-${suffix}@example.test`;
  const noNameEmail = `crud-noname-${suffix}@example.test`;
  const deactivatedAdmin = await createUser(`crud-deact-${suffix}@example.test`);
  const emails = [
    `crud-super-${suffix}@example.test`,
    `crud-admin-${suffix}@example.test`,
    `crud-teacher-${suffix}@example.test`,
    provAdminEmail,
    attachEmail,
    `crud-deact-${suffix}@example.test`,
  ];

  await grantMembership(seedInst!.id, superUser!.id, []);
  await grantMembership(seedInst!.id, instAdmin!.id, ['INSTITUTE_ADMIN']);
  const teacherMembership = await grantMembership(seedInst!.id, teacher!.id, ['TEACHER']);
  await grantPlatformRole(superUser!.id, 'SUPER_ADMIN');
  await db!.update(users).set({ status: 'deactivated', updatedAt: new Date() }).where(eq(users.id, deactivatedAdmin!.id));

  const sidSuper = await liveSession(superUser!.id);
  const sidAdmin = await liveSession(instAdmin!.id);
  const sidTeacher = await liveSession(teacher!.id);

  const service = new PlatformInstitutesService(db as unknown as Database, new RoleAssignmentService(db as unknown as Database));
  const controller = new PlatformInstitutesController(service);

  const noInstituteHeader = (token: string) => ({ cookies: { access_token: token } });
  const withInstitute = (token: string) => ({ headers: { 'x-institute-id': seedInst!.id }, cookies: { access_token: token } });

  const superToken = () => sign(superUser!.id, sidSuper);
  const adminToken = () => sign(instAdmin!.id, sidAdmin);
  const teacherToken = () => sign(teacher!.id, sidTeacher);

  t.after(async () => {
    if (!db) return;
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    if (userIds.length > 0) {
      const membershipIds = (await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))).map(
        (r) => r.id!,
      );
      await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
      await db.delete(memberships).where(inArray(memberships.userId, userIds));
      await db.delete(platformUserRoles).where(inArray(platformUserRoles.userId, userIds));
      await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
      await db.delete(users).where(inArray(users.email, emails));
    }
    await db.delete(instituteSubscriptions).where(inArray(instituteSubscriptions.instituteId, [seedInst!.id]));
    await db.delete(institutes).where(inArray(institutes.slug, slugs));
    void teacherMembership;
  });

  await t.test('1. SUPER_ADMIN creates, lists, gets and updates institutes (platform plane)', async () => {
    await platformPass(createHandler, noInstituteHeader(await superToken()), 'POST');
    const created = await controller.create({ name: `Crud Institute A ${suffix}`, slug: slugA });
    assert.equal(created.slug, slugA);
    assert.equal(created.status, 'active');
    assert.equal(created.memberCount, 0, 'no members yet');
    assert.equal(created.subscription!.planCode, 'starter', 'default plan is starter');
    assert.equal(created.subscription!.planName, 'Starter');
    const [row] = await db!.select().from(institutes).where(eq(institutes.slug, slugA));
    assert.equal(row!.status, 'active');
    const [subRow] = await db!.select().from(instituteSubscriptions).where(eq(instituteSubscriptions.instituteId, created.id));
    assert.ok(subRow, 'subscription ledger row attached at provision');

    // Slug auto-generation when omitted.
    const auto = await controller.create({ name: 'Crud B Institute' });
    assert.equal(auto.slug, 'crud-b-institute', 'slug derived from name');

    // List + detail.
    await platformPass(listHandler, noInstituteHeader(await superToken()), 'GET');
    const all = await controller.list(undefined);
    const slugsSeen = all.map((i) => i.slug);
    assert.ok(slugsSeen.includes(slugA), 'list contains created institute');
    assert.ok(slugsSeen.includes('crud-b-institute'), 'list contains auto-slugged institute');
    const [seedItem] = all.filter((i) => i.slug === `crud-seed-${suffix}`);
    assert.ok(seedItem, 'seed institute listed');

    await platformPass(getHandler, noInstituteHeader(await superToken()), 'GET');
    const detail = await controller.get(created.id);
    assert.equal(detail.id, created.id);
    assert.equal(detail.name, `Crud Institute A ${suffix}`);
    assert.equal(detail.memberCount, 0);
    assert.equal(detail.subscription!.planCode, 'starter');

    // Update name + slug.
    await platformPass(updateHandler, noInstituteHeader(await superToken()), 'PATCH');
    const updated = await controller.update(created.id, { name: `Renamed ${suffix}`, slug: slugB });
    assert.equal(updated.name, `Renamed ${suffix}`);
    assert.equal(updated.slug, slugB);
    const [renamed] = await db!.select().from(institutes).where(eq(institutes.id, created.id));
    assert.equal(renamed!.name, `Renamed ${suffix}`);
    assert.equal(renamed!.slug, slugB);
    assert.equal(renamed!.status, 'active', 'update does not touch status');
  });

  await t.test('2. non-platform / institute-plane users are denied on every surface', async () => {
    const anon = reqContext(createHandler, {}, 'POST');
    await assert.rejects(accessGuard().canActivate(anon), UnauthorizedException);
    await assert.rejects(accessGuard().canActivate(reqContext(listHandler, {}, 'GET')), UnauthorizedException);

    // INSTITUTE_ADMIN — even with a tenant header, no platform grant → 403.
    const surfaces: Array<[handler: (...args: unknown[]) => unknown, method: string]> = [
      [listHandler, 'GET'],
      [createHandler, 'POST'],
      [getHandler, 'GET'],
      [updateHandler, 'PATCH'],
      [adminsHandler, 'GET'],
      [deactivateHandler, 'POST'],
      [reactivateHandler, 'POST'],
      [subscriptionHandler, 'GET'],
      [updateSubscriptionHandler, 'PUT'],
    ];
    for (const [handler, method] of surfaces) {
      await assert.rejects(platformPass(handler, withInstitute(await adminToken()), method), ForbiddenException, `INSTITUTE_ADMIN denied ${method}`);
    }
    // TEACHER → 403 on the management surface.
    await assert.rejects(platformPass(createHandler, noInstituteHeader(await teacherToken()), 'POST'), ForbiddenException);
    await assert.rejects(platformPass(listHandler, noInstituteHeader(await teacherToken()), 'GET'), ForbiddenException);

    // SUPER_ADMIN passes every surface (no x-institute-id needed anywhere).
    await platformPass(createHandler, noInstituteHeader(await superToken()), 'POST');
    await platformPass(listHandler, noInstituteHeader(await superToken()), 'GET');
    await platformPass(getHandler, noInstituteHeader(await superToken()), 'GET');
    await platformPass(updateHandler, noInstituteHeader(await superToken()), 'PATCH');
    await platformPass(adminsHandler, noInstituteHeader(await superToken()), 'GET');
  });

  await t.test('3. duplicate slug conflicts (create + rename)', async () => {
    await assert.rejects(controller.create({ name: `Dup ${suffix}`, slug: slugB }), (err: Error) => {
      assert.equal(err.constructor, ConflictException);
      assert.match(err.message, /slug already exists/);
      return true;
    });
    const dupRows = await db!.select().from(institutes).where(eq(institutes.slug, slugB));
    assert.equal(dupRows.length, 1, 'transaction rolled back — no second institute row');

    // Renaming onto an existing slug conflicts too.
    await assert.rejects(controller.update((await controller.get(seedInst!.id)).id, { slug: slugB }), (err: Error) => {
      assert.equal(err.constructor, ConflictException);
      assert.match(err.message, /slug already exists/);
      return true;
    });
  });

  await t.test('4. invalid / nonexistent institutes fail safely', async () => {
    const missing = randomUUID();
    await assert.rejects(controller.get(missing), NotFoundException);
    await assert.rejects(controller.update(missing, { name: 'x' }), NotFoundException);
    await assert.rejects(controller.admins(missing), NotFoundException);
    await assert.rejects(
      new ParseUUIDPipe().transform('not-a-uuid', { type: 'param', metatype: String, data: 'id' }),
      BadRequestException,
    );
    // Invalid list filter.
    await assert.rejects(controller.list('bogus'), BadRequestException);
    // DTO-level: unknown property (e.g. lifecycle status on PATCH) is rejected
    // by the production global pipe.
    await assert.rejects(
      pipe.transform({ name: 'x', status: 'deactivated' } as CreateInstituteDto, { type: 'body', metatype: UpdateInstituteDto }),
      BadRequestException,
    );
    const patchWithStatus = await controller.update((await controller.get(seedInst!.id)).id, {
      slug: `crud-seed-${suffix}`,
      status: 'deactivated',
    } as unknown as UpdateInstituteDto);
    assert.equal(patchWithStatus.status, 'active', 'service never reads a status field on PATCH');
  });

  await t.test('5. primary-admin provisioning (new user) and attachment (existing user)', async () => {
    // Provision a brand-new primary admin via the documented creation flow.
    await platformPass(createHandler, noInstituteHeader(await superToken()), 'POST');
    const provisioned = await controller.create({
      name: `Prov Inst ${suffix}`,
      slug: slugC,
      primaryAdmin: { email: provAdminEmail, name: `Prov Admin ${suffix}` },
    });
    assert.equal(provisioned.memberCount, 1, 'primary admin membership created');
    const [provUser] = await db!.select().from(users).where(eq(users.email, provAdminEmail));
    assert.ok(provUser, 'new user provisioned');
    assert.equal(provUser!.name, `Prov Admin ${suffix}`);
    assert.equal(provUser!.status, 'active');
    assert.notEqual(provUser!.passwordHash, 'wrong horse battery staple', 'password is a fresh unknown hash');

    // Attach the SAME user to a second institute (create/upsert path).
    const attached = await controller.create({
      name: `Attach Inst ${suffix}`,
      slug: slugD,
      primaryAdmin: { email: provAdminEmail },
    });
    assert.equal(attached.memberCount, 1);
    const provUsers = await db!.select().from(users).where(eq(users.email, provAdminEmail));
    assert.equal(provUsers.length, 1, 'no second user row — existing identity reused');

    // Invalid identity: new email without a name cannot be provisioned.
    await assert.rejects(
      controller.create({ name: `NoName ${suffix}`, slug: slugE, primaryAdmin: { email: noNameEmail } }),
      (err: Error) => {
        assert.equal(err.constructor, BadRequestException);
        assert.match(err.message, /name is required/);
        return true;
      },
    );
    const noNameRows = await db!.select().from(users).where(eq(users.email, noNameEmail));
    assert.equal(noNameRows.length, 0, 'no user created for the rejected invitation');
    const noNameInst = await db!.select().from(institutes).where(eq(institutes.slug, slugE));
    assert.equal(noNameInst.length, 0, 'institute rollback on invalid admin identity');

    // Invalid identity: a deactivated user cannot become primary admin.
    await assert.rejects(
      controller.create({
        name: `Deact ${suffix}`,
        slug: slugF,
        primaryAdmin: { email: deactivatedAdmin!.email },
      }),
      (err: Error) => {
        assert.equal(err.constructor, BadRequestException);
        assert.match(err.message, /not active/);
        return true;
      },
    );
    const deactInst = await db!.select().from(institutes).where(eq(institutes.slug, slugF));
    assert.equal(deactInst.length, 0, 'institute rollback on deactivated admin');

    // Invalid identity: malformed email rejected at the DTO boundary.
    await assert.rejects(
      pipe.transform({ name: 'x', primaryAdmin: { email: 'not-an-email' } } as CreateInstituteDto, {
        type: 'body',
        metatype: CreateInstituteDto,
      }),
      BadRequestException,
    );
  });

  await t.test('6. membership + INSTITUTE_ADMIN role correctness for the provisioned admin', async () => {
    const [provUser] = await db!.select().from(users).where(eq(users.email, provAdminEmail));
    const membership = await db!
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, provUser!.id));
    assert.equal(membership.length, 2, 'two memberships (one per institute)');
    for (const m of membership) {
      const roleGrants = await db!
        .select({ key: roles.key, kind: roles.kind, domain: roles.domain, instituteId: roles.instituteId })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(eq(membershipRoles.membershipId, m.id));
      assert.deepEqual(roleGrants.map((r) => r.key), ['INSTITUTE_ADMIN'], 'exactly the INSTITUTE_ADMIN role');
      assert.equal(roleGrants[0]!.kind, 'system', 'built-in system role');
      assert.equal(roleGrants[0]!.domain, 'institute', 'institute-domain role');
      assert.equal(roleGrants[0]!.instituteId, null, 'system role is global');
      const mRow = await db!.select().from(memberships).where(eq(memberships.id, m.id));
      assert.equal(mRow[0]!.status, 'active', 'membership active');
      const platform = await db!
        .select()
        .from(platformUserRoles)
        .where(inArray(platformUserRoles.userId, [provUser!.id]));
      assert.equal(platform.length, 0, 'provisioned admin holds ZERO platform grants');
    }
  });

  await t.test('7. tenant isolation — per-institute membership + admin scoping', async () => {
    // A second institute with a distinct admin.
    await platformPass(createHandler, noInstituteHeader(await superToken()), 'POST');
    await controller.create({ name: `Isolate B ${suffix}`, slug: slugG, primaryAdmin: { email: attachEmail, name: 'B Admin' } });

    const adminsProv = await controller.admins((await db!.select().from(institutes).where(eq(institutes.slug, slugC)))[0]!.id);
    const adminsB = await controller.admins((await db!.select().from(institutes).where(eq(institutes.slug, slugG)))[0]!.id);
    assert.deepEqual(adminsProv.map((a) => a.email), [provAdminEmail], 'institute C admin list is exactly its admin');
    assert.deepEqual(adminsB.map((a) => a.email), [attachEmail], 'institute G admin list is exactly its admin');
    assert.notEqual(adminsProv[0]!.email, adminsB[0]!.email, 'no admin leaks across institutes');

    // Cross-tenant institute-plane request refuses (TenantGuard) — the B user
    // holds a membership only in institute G, so the seed header has no
    // resolvable membership behind it.
    const [bUser] = await db!.select().from(users).where(eq(users.email, attachEmail));
    const sidB = await liveSession(bUser!.id);
    const ctx = reqContext(
      listHandler,
      { headers: { 'x-institute-id': seedInst!.id }, cookies: { access_token: await sign(bUser!.id, sidB) } },
      'GET',
    );
    await accessGuard().canActivate(ctx);
    await assert.rejects(tenantGuard().canActivate(ctx), ForbiddenException, 'no cross-tenant institute context resolves');
  });

  await t.test('8. deactivated institutes stay visible + manageable on the platform plane', async () => {
    const [instC] = await db!.select().from(institutes).where(eq(institutes.slug, slugC));
    await platformPass(deactivateHandler, noInstituteHeader(await superToken()), 'POST');
    await controller.deactivate(instC!.id);

    const all = await controller.list(undefined);
    const item = all.find((i) => i.id === instC!.id)!;
    assert.equal(item.status, 'deactivated', 'deactivated institute still listed');
    const deactivatedList = await controller.list('deactivated');
    assert.ok(deactivatedList.some((i) => i.id === instC!.id), 'status=deactivated filter includes it');
    const activeList = await controller.list('active');
    assert.ok(!activeList.some((i) => i.id === instC!.id), 'status=active filter excludes it');

    await platformPass(getHandler, noInstituteHeader(await superToken()), 'GET');
    const detail = await controller.get(instC!.id);
    assert.equal(detail.status, 'deactivated');
    assert.ok(detail.deactivatedAt instanceof Date, 'deactivated_at surfaced');

    await platformPass(adminsHandler, noInstituteHeader(await superToken()), 'GET');
    const admins = await controller.admins(instC!.id);
    assert.deepEqual(admins.map((a) => a.email), [provAdminEmail], 'admins still readable while deactivated');

    await platformPass(updateHandler, noInstituteHeader(await superToken()), 'PATCH');
    const renamed = await controller.update(instC!.id, { name: `Deactivated Renamed ${suffix}` });
    assert.equal(renamed.status, 'deactivated', 'PATCH on a deactivated institute leaves the lifecycle state untouched');
  });

  await t.test('9. deactivate/reactivate behavior remains unchanged', async () => {
    await platformPass(createHandler, noInstituteHeader(await superToken()), 'POST');
    const instD = await controller.create({ name: `Lifecycle D ${suffix}`, slug: slugE });

    await platformPass(deactivateHandler, noInstituteHeader(await superToken()), 'POST');
    const deactivated = await controller.deactivate(instD.id);
    assert.equal(deactivated.status, 'deactivated');
    assert.ok(deactivated.deactivatedAt instanceof Date);
    await assert.rejects(controller.deactivate(instD.id), ConflictException, 'repeat deactivate conflicts');

    await platformPass(reactivateHandler, noInstituteHeader(await superToken()), 'POST');
    const reactivated = await controller.reactivate(instD.id);
    assert.equal(reactivated.status, 'active');
    assert.equal(reactivated.deactivatedAt, null, 'stamp cleared');
    await assert.rejects(controller.reactivate(instD.id), ConflictException, 'repeat reactivate conflicts');

    const [row] = await db!.select().from(institutes).where(eq(institutes.id, instD.id));
    assert.equal(row!.status, 'active');
  });

  await t.test('10. subscription remains independent from institute lifecycle', async () => {
    await platformPass(createHandler, noInstituteHeader(await superToken()), 'POST');
    const instE = await controller.create({ name: `Sub Lifecycle E ${suffix}`, slug: slugF });

    await platformPass(subscriptionHandler, noInstituteHeader(await superToken()), 'GET');
    const initial = await controller.subscription(instE.id);
    assert.equal(initial.planCode, 'starter', 'provision attached the default plan');

    await platformPass(deactivateHandler, noInstituteHeader(await superToken()), 'POST');
    await controller.deactivate(instE.id);

    const stillReadable = await controller.subscription(instE.id);
    assert.equal(stillReadable.planCode, 'starter', 'subscription readable on a deactivated institute');

    await platformPass(updateSubscriptionHandler, noInstituteHeader(await superToken()), 'PUT');
    const switched = await controller.updateSubscription(instE.id, { planCode: 'growth' });
    assert.equal(switched.planCode, 'growth');
    const [stillDeactivated] = await db!.select().from(institutes).where(eq(institutes.id, instE.id));
    assert.equal(stillDeactivated!.status, 'deactivated', 'plan switch does NOT reactivate');
    assert.ok(stillDeactivated!.deactivatedAt instanceof Date, 'deactivated_at preserved through plan switch');

    await platformPass(reactivateHandler, noInstituteHeader(await superToken()), 'POST');
    await controller.reactivate(instE.id);
    const [reactivated] = await db!.select().from(institutes).where(eq(institutes.id, instE.id));
    assert.equal(reactivated!.status, 'active');
    const after = await controller.subscription(instE.id);
    assert.equal(after.planCode, 'growth', 'subscription survives lifecycle flips');
  });
});