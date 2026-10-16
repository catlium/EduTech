import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  roles,
  institutes,
  subjects,
  academicYears,
  classes,
  classSubjects,
  divisions,
} from '@catlium/database';
import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from '../authorization/permissions.guard.ts';
import { PERMISSIONS_KEY } from '../authorization/permissions.decorator.ts';
import { ROLES_KEY } from '../common/decorators/roles.decorator.ts';
import type { TenantContext } from '../common/decorators/tenant.decorator.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RolesService } from '../authorization/roles.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { AcademicStructureController } from './academic-structure.controller.ts';
import { AcademicStructureService } from './academic-structure.service.ts';

// Phase F5.2 — academic-structure guard matrix (D4/§13). Runs the REAL guard
// chain against the REAL AcademicStructureController handlers (their metadata),
// proving the catalogued `academic-structure` permission declares exactly what
// the D4 structural routes enforce:
//   - INSTITUTE_ADMIN passes every route via the built-in
//     academic-structure.manage grant (implication rule)
//   - delegated custom roles obey exactly their granted sub-action, with no OR
//     widening: read-only, create-only, update-only and delete-only roles each
//     fail every action they were not granted
//   - a manage delegate gets the full surface
//   - TEACHER/STUDENT/zero-role default-deny — structural config is admin-only
//     by default (they hold no academic-structure.* key)
//   - no stale @RequiredRoles metadata remains on the controller or its handlers
//   - a permission never substitutes for the service's institute scoping: a
//     fully-authorized delegate targeting another institute's class still misses
//   - cross-institute custom-role grants stay isolated
// Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
// unset. Permission/role seeds come from PermissionSyncService (idempotent).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'academic-structure-authz-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

const C = AcademicStructureController.prototype;
const READ = C.listAcademicYears;
const READ_CLASSES = C.listClasses;
const READ_CLASS_SUBJECTS = C.listClassSubjects;
const READ_DIVISIONS = C.listDivisions;
const CREATE = C.createAcademicYear;
const UPDATE = C.updateAcademicYear;
const DELETE = C.deleteClass;
const OFFER_CREATE = C.addClassSubject;
const OFFER_DELETE = C.removeClassSubject;

const ALL_READS = [READ, READ_CLASSES, READ_CLASS_SUBJECTS, READ_DIVISIONS];
const ALL_HANDLERS = [...ALL_READS, CREATE, UPDATE, DELETE, OFFER_CREATE, OFFER_DELETE];

function reqContext(handler: unknown, request: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const req = { headers: {}, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler as unknown as (...args: unknown[]) => unknown,
    getClass: () => AcademicStructureController,
  } as unknown as ExecutionContext;
}

const reflector = () => new Reflector();
const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const permGuard = () => new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

/** The single permission key a handler declares, as the guards read it. */
function declaredPermission(handler: unknown): string | undefined {
  const declared = reflector().getAllAndOverride<string[]>(PERMISSIONS_KEY, [
    handler as (...args: unknown[]) => unknown,
    AcademicStructureController,
  ]);
  return declared?.length === 1 ? declared[0] : undefined;
}

/** Any residual @RequiredRoles metadata — must be undefined after the migration. */
function roleMetadata(target: unknown): string[] | undefined {
  return reflector().getAllAndOverride<string[]>(ROLES_KEY, [
    target as (...args: unknown[]) => unknown,
    AcademicStructureController,
  ]);
}

/** The full production chain, in the order app.module registers the guards. */
async function runChain(
  handler: unknown,
  request: { headers?: Record<string, string>; cookies?: Record<string, string> },
) {
  const ctx = reqContext(handler, request);
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  new RolesGuard(reflector()).canActivate(ctx); // stale-role check: must be a no-op now
  await permGuard().canActivate(ctx);
  return ctx;
}

test('F5.2 academic-structure guard matrix', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  const roleRows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']));
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));

  const suffix = randomUUID().slice(0, 8);
  const [instA] = await db!.insert(institutes).values({ name: `Struct A ${suffix}`, slug: `struct-a-${suffix}` }).returning();
  const [instB] = await db!.insert(institutes).values({ name: `Struct B ${suffix}`, slug: `struct-b-${suffix}` }).returning();

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
      .values({ userId, refreshTokenHash: `f52-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    return row!.id;
  };

  // Institute A fixtures: one subject, one year, one class (offering targets).
  const [subjectA] = await db!.insert(subjects).values({ instituteId: instA!.id, name: `Subject ${suffix}`, slug: `struct-s-${suffix}` }).returning();
  const [yearA] = await db!.insert(academicYears).values({ instituteId: instA!.id, name: `Year ${suffix}` }).returning();
  const [classA] = await db!.insert(classes).values({ instituteId: instA!.id, name: `Class ${suffix}` }).returning();
  // Institute B fixture — proves institute scoping survives the permission layer.
  const [classB] = await db!.insert(classes).values({ instituteId: instB!.id, name: `Class B ${suffix}` }).returning();

  const admin = await makeUser('admin');
  const teacher = await makeUser('teacher');
  const student = await makeUser('student');
  const zeroRole = await makeUser('zerorole');
  const delegateRead = await makeUser('delegate_read');
  const delegateCreate = await makeUser('delegate_create');
  const delegateUpdate = await makeUser('delegate_update');
  const delegateDelete = await makeUser('delegate_delete');
  const delegateManage = await makeUser('delegate_manage');
  const crossDelegate = await makeUser('cross_delegate');

  await grantMembership(instA!.id, admin!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instA!.id, teacher!.id, ['TEACHER']);
  await grantMembership(instA!.id, student!.id, ['STUDENT']);
  await grantMembership(instA!.id, zeroRole!.id, []);
  for (const u of [delegateRead, delegateCreate, delegateUpdate, delegateDelete, delegateManage]) {
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
    delegateUpdate: await liveSession(delegateUpdate!.id),
    delegateDelete: await liveSession(delegateDelete!.id),
    delegateManage: await liveSession(delegateManage!.id),
    crossDelegate: await liveSession(crossDelegate!.id),
  };

  t.after(async () => {
    if (!db) return;
    const emails = [
      `admin-${suffix}`, `teacher-${suffix}`, `student-${suffix}`, `zerorole-${suffix}`,
      `delegate_read-${suffix}`, `delegate_create-${suffix}`, `delegate_update-${suffix}`,
      `delegate_delete-${suffix}`, `delegate_manage-${suffix}`, `cross_delegate-${suffix}`,
    ].map((e) => `${e}@example.test`);
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    const membershipIds = userIds.length
      ? (await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))).map((r) => r.id!)
      : [];
    if (membershipIds.length) {
      await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    }
    if (userIds.length) {
      await db.delete(memberships).where(inArray(memberships.userId, userIds));
      await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
      await db.delete(users).where(inArray(users.email, emails));
    }
    await db.delete(classSubjects).where(inArray(classSubjects.classId, [classA!.id, classB!.id]));
    await db.delete(divisions).where(inArray(divisions.instituteId, [instA!.id, instB!.id]));
    await db.delete(classes).where(inArray(classes.id, [classA!.id, classB!.id]));
    await db.delete(academicYears).where(eq(academicYears.id, yearA!.id));
    await db.delete(subjects).where(eq(subjects.id, subjectA!.id));
    // Custom institute roles (and their permission rows) cascade with the institute.
    await db.delete(institutes).where(inArray(institutes.slug, [`struct-a-${suffix}`, `struct-b-${suffix}`]));
  });

  async function userIdFor(label: keyof typeof sid): Promise<string> {
    const map: Record<keyof typeof sid, string> = {
      admin: admin!.id,
      teacher: teacher!.id,
      student: student!.id,
      zeroRole: zeroRole!.id,
      delegateRead: delegateRead!.id,
      delegateCreate: delegateCreate!.id,
      delegateUpdate: delegateUpdate!.id,
      delegateDelete: delegateDelete!.id,
      delegateManage: delegateManage!.id,
      crossDelegate: crossDelegate!.id,
    };
    return map[label];
  }

  const ctx = async (who: keyof typeof sid) => ({
    headers: { 'x-institute-id': instA!.id },
    cookies: { access_token: await sign(await userIdFor(who), sid[who]) },
  });

  // ── Metadata: the migration actually happened, and left no role residue ──

  await t.test('every structural handler declares exactly one academic-structure permission', () => {
    for (const handler of ALL_HANDLERS) {
      const declared = declaredPermission(handler);
      assert.ok(
        declared && declared.startsWith('academic-structure.'),
        `handler must declare one academic-structure permission, got ${JSON.stringify(declared)}`,
      );
    }
    // No role-based residue: neither the controller class nor any handler carries
    // @RequiredRoles metadata, so RolesGuard is now a no-op for this surface.
    assert.equal(roleMetadata(AcademicStructureController), undefined);
    for (const handler of ALL_HANDLERS) {
      assert.equal(roleMetadata(handler), undefined);
    }
  });

  await t.test('the operation→action mapping is read/create/update/delete, no OR widening', () => {
    assert.equal(declaredPermission(READ), 'academic-structure.read');
    assert.equal(declaredPermission(READ_CLASSES), 'academic-structure.read');
    assert.equal(declaredPermission(READ_CLASS_SUBJECTS), 'academic-structure.read');
    assert.equal(declaredPermission(READ_DIVISIONS), 'academic-structure.read');
    assert.equal(declaredPermission(CREATE), 'academic-structure.create');
    assert.equal(declaredPermission(OFFER_CREATE), 'academic-structure.create');
    assert.equal(declaredPermission(UPDATE), 'academic-structure.update');
    assert.equal(declaredPermission(DELETE), 'academic-structure.delete');
    assert.equal(declaredPermission(OFFER_DELETE), 'academic-structure.delete');
  });

  // ── Built-in roles ──

  await t.test('built-in INSTITUTE_ADMIN passes every structural route via academic-structure.manage', async () => {
    for (const handler of ALL_HANDLERS) {
      await runChain(handler, await ctx('admin'));
    }
  });

  await t.test('TEACHER/STUDENT/zero-role default-deny every structural route', async () => {
    for (const who of ['teacher', 'student', 'zeroRole'] as const) {
      for (const handler of ALL_HANDLERS) {
        await assert.rejects(
          runChain(handler, await ctx(who)),
          ForbiddenException,
          `${who} should be denied`,
        );
      }
    }
  });

  // ── Delegated custom institute roles ──

  const rolesSvc = new RolesService(db as unknown as Database);
  const assigner = new RoleAssignmentService(db as unknown as Database);
  const grantCustom = async (key: string, permissionKeys: string[]) => {
    const role = await rolesSvc.createRole(instA!.id, { key: `${key}_${suffix}`, name: key, description: undefined, permissionKeys });
    return role.id;
  };
  const assignTo = async (userId: string, roleId: string) => {
    const rows = await db!.select().from(memberships).where(eq(memberships.userId, userId)).limit(1);
    await assigner.assign(rows[0]!.id, roleId);
  };

  await t.test('delegated custom roles obey exactly their granted sub-actions', async () => {
    await assignTo(delegateRead!.id, await grantCustom('f52_ro', ['academic-structure.read']));
    await assignTo(delegateCreate!.id, await grantCustom('f52_co', ['academic-structure.create']));
    await assignTo(delegateUpdate!.id, await grantCustom('f52_uo', ['academic-structure.update']));
    await assignTo(delegateDelete!.id, await grantCustom('f52_do', ['academic-structure.delete']));
    await assignTo(delegateManage!.id, await grantCustom('f52_ma', ['academic-structure.manage']));

    // read: reads only — no write leaks through, and no write implies read.
    for (const handler of ALL_READS) await runChain(handler, await ctx('delegateRead'));
    for (const handler of [CREATE, UPDATE, DELETE, OFFER_CREATE, OFFER_DELETE]) {
      await assert.rejects(runChain(handler, await ctx('delegateRead')), ForbiddenException);
    }

    // create: creates only.
    for (const handler of [CREATE, OFFER_CREATE]) await runChain(handler, await ctx('delegateCreate'));
    for (const handler of [...ALL_READS, UPDATE, DELETE, OFFER_DELETE]) {
      await assert.rejects(runChain(handler, await ctx('delegateCreate')), ForbiddenException);
    }

    // update: updates only.
    await runChain(UPDATE, await ctx('delegateUpdate'));
    for (const handler of [...ALL_READS, CREATE, DELETE, OFFER_CREATE, OFFER_DELETE]) {
      await assert.rejects(runChain(handler, await ctx('delegateUpdate')), ForbiddenException);
    }

    // delete: deletes only.
    for (const handler of [DELETE, OFFER_DELETE]) await runChain(handler, await ctx('delegateDelete'));
    for (const handler of [...ALL_READS, CREATE, UPDATE, OFFER_CREATE]) {
      await assert.rejects(runChain(handler, await ctx('delegateDelete')), ForbiddenException);
    }
  });

  await t.test('academic-structure.manage implies every structural action', async () => {
    for (const handler of ALL_HANDLERS) {
      await runChain(handler, await ctx('delegateManage'));
    }
  });

  // ── Institute isolation is not replaced by the permission layer ──

  await t.test('cross-institute: an A-owned role never grants access through a B membership', async () => {
    const roleId = await grantCustom('f52_x', ['academic-structure.manage']);
    const membershipB = await db!.select().from(memberships).where(eq(memberships.userId, crossDelegate!.id)).limit(1);
    await assert.rejects(assigner.assign(membershipB[0]!.id, roleId), BadRequestException);

    // The B delegate has no A membership → no grant context in A at all.
    for (const handler of ALL_HANDLERS) {
      await assert.rejects(
        runChain(handler, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(crossDelegate!.id, sid.crossDelegate) } }),
        ForbiddenException,
      );
    }
  });

  await t.test('an authorized manage delegate still cannot touch another institute resource', async () => {
    // The guard chain passes; the service's institute scoping is what denies.
    // Proves the permission check authorizes the operation without replacing it.
    const service = new AcademicStructureService(db as unknown as Database);
    const controller = new AcademicStructureController(service);
    const ctxOk = await runChain(UPDATE, await ctx('delegateManage'));
    const tenant = (ctxOk.switchToHttp().getRequest() as Record<string, unknown>)['tenant'] as TenantContext;
    assert.equal(tenant.instituteId, instA!.id);

    await assert.rejects(
      UPDATE.call(controller, tenant, classB!.id, { name: 'hijacked' }),
      NotFoundException,
      'service must not find another institute class even for a fully-authorized caller',
    );

    // Same for the offering write path, which resolves the class first.
    await assert.rejects(
      OFFER_CREATE.call(controller, tenant, classB!.id, subjectA!.id),
      NotFoundException,
    );

    // And the institute-A resource the same caller legitimately owns is found.
    const { academicYear } = await UPDATE.call(controller, tenant, yearA!.id, {
      name: `Renamed ${suffix}`,
    });
    assert.equal(academicYear.name, `Renamed ${suffix}`);
  });
});
