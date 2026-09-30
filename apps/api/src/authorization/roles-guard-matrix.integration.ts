import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as bcryptjs from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  roles,
  institutes,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from './permissions.guard.ts';
import { PERMISSIONS_KEY } from './permissions.decorator.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from './permission-check.service.ts';
import { PermissionSyncService } from './permission-sync.service.ts';
import { RolesController } from './roles.controller.ts';
import { RolesService } from './roles.service.ts';
import { RoleAssignmentService } from './role-assignment.service.ts';
import {
  PERMISSION_CATALOGUE,
  invalidInstitutePermissionKeys,
  isSupportedPermission,
  permissionDomain,
} from './permission-catalogue.ts';

// F5.7 guard matrix for the roles surface. Two things shipped in F5.7 and this
// is their durable check:
//   1. `GET /roles/catalogue` (`RolesService.listPermissionCatalogue`) — the
//      institute-domain permission vocabulary the console renders.
//   2. The `@RequiredPermission('roles.read')` gate on it, exercised through the
//      REAL AccessToken → Tenant → Roles → Permission chain.
//
// Everything else on `RolesController` (list/get/create/update/permissions) was
// already covered by `authz-regression` case 6 and `remaining-surface-authz`,
// which are NOT restated here.
//
// Requires TEST_DATABASE_URL; skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({
  secret: 'roles-guard-matrix-secret',
  signOptions: { algorithm: 'HS256' },
});
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });
const hash = (pwd: string) => bcryptjs.hashSync(pwd, 4);

function reqContext(
  handler: (...a: never[]) => unknown,
  request: { headers?: Record<string, string>; cookies?: Record<string, string> },
) {
  const req = { headers: {}, method: 'GET', ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => RolesController,
  } as unknown as ExecutionContext;
}

async function createUser(email: string) {
  const [user] = await db!
    .insert(users)
    .values({ email, name: 'Roles Guard Tester', passwordHash: hash('wrong horse battery staple') })
    .returning();
  return user!;
}

async function liveSession(userId: string) {
  const [row] = await db!
    .insert(authSessions)
    .values({
      userId,
      refreshTokenHash: `rgm-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return row!.id;
}

let roleIds: Record<string, string> = {};
async function loadRoleIds() {
  const rows = await db!
    .select()
    .from(roles)
    .where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT', 'SUPER_ADMIN']));
  roleIds = Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

async function grantMembership(instituteId: string, userId: string, roleKeys: string[]) {
  const [membership] = await db!
    .insert(memberships)
    .values({ userId, instituteId, status: 'active' })
    .returning();
  for (const key of roleKeys) {
    await db!
      .insert(membershipRoles)
      .values({ membershipId: membership!.id, roleId: roleIds[key]! });
  }
  return membership!;
}

const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const rolesGuard = () => new RolesGuard(new Reflector());
const permGuard = () =>
  new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

/** authentication → tenant → roles → permission, exactly as the controller mounts them. */
async function chain(
  handler: (...a: never[]) => unknown,
  request: { headers?: Record<string, string>; cookies?: Record<string, string> },
) {
  const ctx = reqContext(handler, request);
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  await rolesGuard().canActivate(ctx);
  return permGuard().canActivate(ctx);
}

const declaredKeys = (handler: (...a: never[]) => unknown): string[] | undefined =>
  new Reflector().get<string[]>(PERMISSIONS_KEY, handler as never);

test(
  'F5.7 roles guard matrix: /roles/catalogue metadata, purity and gate',
  { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' },
  async (t) => {
    await new PermissionSyncService(db as unknown as Database).sync();
    await loadRoleIds();
    assert.ok(
      roleIds.INSTITUTE_ADMIN && roleIds.TEACHER && roleIds.STUDENT,
      'built-in institute roles seeded',
    );

    const suffix = randomUUID().slice(0, 8);
    const slug = `rgm-${suffix}`;
    const [inst] = await db!
      .insert(institutes)
      .values({ name: `Roles Guard ${suffix}`, slug })
      .returning();

    const admin = await createUser(`rgm-admin-${suffix}@example.test`);
    const delegate = await createUser(`rgm-delegate-${suffix}@example.test`);
    const noRole = await createUser(`rgm-norole-${suffix}@example.test`);
    const teacher = await createUser(`rgm-teacher-${suffix}@example.test`);

    await grantMembership(inst!.id, admin!.id, ['INSTITUTE_ADMIN']);
    const delegateMembership = await grantMembership(inst!.id, delegate!.id, ['TEACHER']);
    const noRoleMembership = await grantMembership(inst!.id, noRole!.id, []);
    await grantMembership(inst!.id, teacher!.id, ['TEACHER']);

    const sid = {
      admin: await liveSession(admin!.id),
      delegate: await liveSession(delegate!.id),
      noRole: await liveSession(noRole!.id),
      teacher: await liveSession(teacher!.id),
    };

    t.after(async () => {
      if (!db) return;
      const emails = [
        `rgm-admin-${suffix}@example.test`,
        `rgm-delegate-${suffix}@example.test`,
        `rgm-norole-${suffix}@example.test`,
        `rgm-teacher-${suffix}@example.test`,
      ];
      const userIds = (
        await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))
      ).map((r) => r.id!);
      if (userIds.length === 0) return;
      const membershipIds = (
        await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(inArray(memberships.userId, userIds))
      ).map((r) => r.id!);
      await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
      await db.delete(memberships).where(inArray(memberships.userId, userIds));
      await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
      await db.delete(users).where(inArray(users.email, emails));
      await db.delete(institutes).where(eq(institutes.slug, slug));
      void delegateMembership;
      void noRoleMembership;
    });

    await t.test(
      "catalogue is declared BEFORE @Get(':roleId') so ParseUUIDPipe cannot swallow it",
      async () => {
        // Nest matches routes in declaration order. Registered after the param route,
        // `catalogue` would be consumed by `:roleId`'s ParseUUIDPipe and answer 400.
        // Anchor at line start so the explanatory comment above the decorator (which
        // quotes both paths) cannot satisfy the scan.
        const src = readFileSync(new URL('./roles.controller.ts', import.meta.url), 'utf8');
        const catalogueAt = src.search(/^\s*@Get\('catalogue'\)/m);
        const paramAt = src.search(/^\s*@Get\(':roleId'\)/m);
        assert.ok(catalogueAt > -1, 'GET /roles/catalogue must be declared');
        assert.ok(paramAt > -1, 'GET /roles/:roleId must be declared');
        assert.ok(catalogueAt < paramAt, "GET 'catalogue' must be declared before GET ':roleId'");
      },
    );

    await t.test('catalogue declares exactly one key, roles.read, on both reads', async () => {
      assert.deepEqual(declaredKeys(RolesController.prototype.catalogue), ['roles.read']);
      assert.deepEqual(declaredKeys(RolesController.prototype.list), ['roles.read']);
      // RolesGuard must be a no-op here: the controller declares no @RequiredRoles.
      assert.equal(
        new Reflector().getAllAndOverride<string[]>(/* ROLES_KEY */ 'roles', [
          RolesController.prototype.catalogue as never,
          RolesController,
        ]),
        undefined,
        'no @RequiredRoles may remain on the catalogue route or its controller',
      );
    });

    await t.test(
      'listPermissionCatalogue returns only institute-domain, supported keys',
      async () => {
        const items = new RolesService(db as unknown as Database).listPermissionCatalogue();
        assert.ok(items.length > 0, 'catalogue must not be empty');
        for (const item of items) {
          assert.ok(isSupportedPermission(item.key), `${item.key} must be a catalogued permission`);
          assert.equal(
            permissionDomain(item.key),
            'institute',
            `${item.key} must be institute-domain`,
          );
          assert.equal(
            invalidInstitutePermissionKeys([item.key]).length,
            0,
            `${item.key} must be grantable to an institute role`,
          );
          assert.equal(
            item.key,
            `${item.resource}.${item.action}`,
            'key must decompose to its own resource/action',
          );
          assert.ok(
            item.name.length > 0 && item.description.length > 0,
            `${item.key} must carry display metadata`,
          );
        }
        // Exactly the catalogue's institute slice — nothing missing, nothing invented.
        assert.deepEqual(
          items.map((i) => i.key),
          PERMISSION_CATALOGUE.filter((p) => p.domain === 'institute').map((p) => p.key),
        );
      },
    );

    await t.test('no platform-domain key is ever offered to an institute role', async () => {
      const keys = new Set(
        new RolesService(db as unknown as Database).listPermissionCatalogue().map((i) => i.key),
      );
      for (const p of PERMISSION_CATALOGUE.filter((x) => x.domain === 'platform')) {
        assert.ok(
          !keys.has(p.key),
          `${p.key} is platform-domain and must not appear in the institute catalogue`,
        );
      }
    });

    await t.test(
      'gate: INSTITUTE_ADMIN passes via roles.manage; delegate, teacher and zero-role are decided',
      async () => {
        const ctxFor = async (userId: string, sessionId: string) => ({
          headers: { 'x-institute-id': inst!.id },
          cookies: { access_token: await sign(userId, sessionId) },
        });

        await chain(RolesController.prototype.catalogue, await ctxFor(admin!.id, sid.admin));

        // TEACHER holds no roles.* key → default-deny.
        await assert.rejects(
          chain(RolesController.prototype.catalogue, await ctxFor(teacher!.id, sid.teacher)),
          ForbiddenException,
        );
        // Zero-role membership → default-deny.
        await assert.rejects(
          chain(RolesController.prototype.catalogue, await ctxFor(noRole!.id, sid.noRole)),
          ForbiddenException,
        );

        // A custom institute role holding exactly roles.read is delegated through
        // the existing PUT /roles/:roleId/permissions path — no new grant mechanism.
        const svc = new RolesService(db as unknown as Database);
        const assigner = new RoleAssignmentService(db as unknown as Database);
        const custom = await svc.createRole(inst!.id, {
          key: `rgm_${suffix}_reader`,
          name: 'Roles Guard Reader',
          description: undefined,
          permissionKeys: ['roles.read'],
        });
        try {
          await assigner.assign(delegateMembership!.id, custom.id);
          await chain(
            RolesController.prototype.catalogue,
            await ctxFor(delegate!.id, sid.delegate),
          );

          // Narrowing to a sibling action revokes the read immediately.
          await svc.setRolePermissions(inst!.id, custom.id, ['roles.create'], ['INSTITUTE_ADMIN']);
          await assert.rejects(
            chain(RolesController.prototype.catalogue, await ctxFor(delegate!.id, sid.delegate)),
            ForbiddenException,
          );
        } finally {
          await svc.deleteRole(inst!.id, custom.id, ['INSTITUTE_ADMIN']);
        }
      },
    );

    await t.test('unauthenticated is refused before any permission is consulted', async () => {
      await assert.rejects(
        accessGuard().canActivate(reqContext(RolesController.prototype.catalogue, {})),
        UnauthorizedException,
      );
    });

    await t.test(
      'negative probe: dropping the decorator reopens the route, restoring it closes it',
      async () => {
        // Without this the matrix can pass vacuously: it would also pass if the
        // guard never saw a roles.read requirement in the first place.
        const handler = RolesController.prototype.catalogue as (...a: never[]) => unknown;
        const original = Reflect.getMetadata(PERMISSIONS_KEY, handler);
        const readerCtx = async () => ({
          headers: { 'x-institute-id': inst!.id },
          cookies: { access_token: await sign(teacher!.id, sid.teacher) },
        });

        try {
          Reflect.defineMetadata(PERMISSIONS_KEY, undefined, handler);
          await chain(handler, await readerCtx());

          Reflect.defineMetadata(PERMISSIONS_KEY, ['roles.read'], handler);
          await assert.rejects(chain(handler, await readerCtx()), ForbiddenException);
        } finally {
          Reflect.defineMetadata(PERMISSIONS_KEY, original, handler);
        }
      },
    );
  },
);
