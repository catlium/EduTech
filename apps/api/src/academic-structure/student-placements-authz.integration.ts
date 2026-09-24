import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  roles,
  institutes,
  academicYears,
  classes,
  divisions,
  studentPlacements,
} from '@catlium/database';
import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from '../authorization/permissions.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RolesService } from '../authorization/roles.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { StudentPlacementsController } from './student-placements.controller.ts';
import { StudentPlacementsService } from './student-placements.service.ts';

// Phase Q.4.1 + Q.4.2 — student-placement guard matrix AND end-to-end behavior
// (D-Q4.2, academic-student-placement.md §5/§13). Runs the REAL guard chain
// against the REAL StudentPlacementsController handlers, proving the
// catalogued `assignments.*` permission declares exactly what the routes
// enforce and that an authorized caller's request actually reaches the DB:
//   - INSTITUTE_ADMIN passes via the built-in assignments.manage grant
//   - delegated custom roles obey exactly their granted sub-actions
//   - transfer (archive + insert, one call) requires BOTH assignments.create
//     AND assignments.delete (AND rule, @RequiredPermissions)
//   - TEACHER/STUDENT default-deny (placement data never reaches class users)
//   - no stale @RequiredRoles('INSTITUTE_ADMIN') metadata remains
//   - cross-institute isolation of custom-role grants
//   - real handler execution: place / conflict / inactive-student / deactivate /
//     transfer / history retention through the guard chain (Q.4.2)
// Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
// unset. Permission/role seeds come from PermissionSyncService (idempotent).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'student-placements-authz-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

const LIST = StudentPlacementsController.prototype.listStudentPlacements;
const GET = StudentPlacementsController.prototype.getStudentPlacement;
const CREATE = StudentPlacementsController.prototype.createStudentPlacement;
const DELETE = StudentPlacementsController.prototype.deactivateStudentPlacement;
const TRANSFER = StudentPlacementsController.prototype.transferStudentPlacement;
const CARRY_PREVIEW = StudentPlacementsController.prototype.previewCarryForward;
const CARRY_COMMIT = StudentPlacementsController.prototype.commitCarryForward;

function reqContext(handler: unknown, request: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const req = { headers: {}, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler as unknown as (...args: unknown[]) => unknown,
    getClass: () => StudentPlacementsController,
  } as unknown as ExecutionContext;
}

const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const rolesGuard = () => new RolesGuard(new Reflector());
const permGuard = () => new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

async function runChain(handler: unknown, request: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const ctx = reqContext(handler, request);
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  rolesGuard().canActivate(ctx); // stale-role check: must be a no-op now
  await permGuard().canActivate(ctx);
  return ctx.switchToHttp().getRequest() as Record<string, unknown>;
}

test('Q.4.1 student-placement guard matrix', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  const roleRows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']));
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));

  const suffix = randomUUID().slice(0, 8);
  const [instA] = await db!.insert(institutes).values({ name: `SP A ${suffix}`, slug: `sp-a-${suffix}` }).returning();
  const [instB] = await db!.insert(institutes).values({ name: `SP B ${suffix}`, slug: `sp-b-${suffix}` }).returning();

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
      .values({ userId, refreshTokenHash: `q4-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    return row!.id;
  };

  const admin = await makeUser('sp_admin');
  const teacher = await makeUser('sp_teacher');
  const student = await makeUser('sp_student');
  const zeroRole = await makeUser('sp_zerorole');
  const delegateRead = await makeUser('sp_delegate_read');
  const delegateCreate = await makeUser('sp_delegate_create');
  const delegateDelete = await makeUser('sp_delegate_delete');
  const delegateBoth = await makeUser('sp_delegate_both');
  const delegateManage = await makeUser('sp_delegate_manage');
  const crossDelegate = await makeUser('sp_cross_delegate');

  await grantMembership(instA!.id, admin!.id, ['INSTITUTE_ADMIN']);
  await grantMembership(instA!.id, teacher!.id, ['TEACHER']);
  await grantMembership(instA!.id, student!.id, ['STUDENT']);
  await grantMembership(instA!.id, zeroRole!.id, []);
  for (const u of [delegateRead, delegateCreate, delegateDelete, delegateBoth, delegateManage]) {
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
    delegateDelete: await liveSession(delegateDelete!.id),
    delegateBoth: await liveSession(delegateBoth!.id),
    delegateManage: await liveSession(delegateManage!.id),
    crossDelegate: await liveSession(crossDelegate!.id),
  };

  t.after(async () => {
    if (!db) return;
    const emails = [
      `sp_admin-${suffix}`, `sp_teacher-${suffix}`, `sp_student-${suffix}`, `sp_zerorole-${suffix}`,
      `sp_delegate_read-${suffix}`, `sp_delegate_create-${suffix}`, `sp_delegate_delete-${suffix}`,
      `sp_delegate_both-${suffix}`, `sp_delegate_manage-${suffix}`, `sp_cross_delegate-${suffix}`,
      `sp_beh_studentA-${suffix}`, `sp_beh_studentB-${suffix}`, `sp_beh_studentX-${suffix}`,
      `sp_beh_studentC-${suffix}`, `sp_beh_studentD-${suffix}`,
    ].map((e) => `${e}@example.test`);
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    if (userIds.length === 0) return;
    const membershipIds = (await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))).map((r) => r.id!);
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db.delete(memberships).where(inArray(memberships.userId, userIds));
    await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(institutes).where(inArray(institutes.slug, [`sp-a-${suffix}`, `sp-b-${suffix}`]));
  });

  async function userIdFor(label: keyof typeof sid): Promise<string> {
    const map: Record<keyof typeof sid, string> = {
      admin: admin!.id,
      teacher: teacher!.id,
      student: student!.id,
      zeroRole: zeroRole!.id,
      delegateRead: delegateRead!.id,
      delegateCreate: delegateCreate!.id,
      delegateDelete: delegateDelete!.id,
      delegateBoth: delegateBoth!.id,
      delegateManage: delegateManage!.id,
      crossDelegate: crossDelegate!.id,
    };
    return map[label];
  }

  const ctx = async (who: keyof typeof sid) => ({
    headers: { 'x-institute-id': instA!.id },
    cookies: { access_token: await sign(await userIdFor(who), sid[who]) },
  });

  // Academic structure + STUDENT memberships in instA for the end-to-end
  // behavior phase (Q.4.2): placement rows land in real divisions/years.
  const [yr1] = await db!.insert(academicYears).values({ instituteId: instA!.id, name: `Q4 Year 1 ${suffix}`, sortOrder: 1 }).returning();
  const [yr2] = await db!.insert(academicYears).values({ instituteId: instA!.id, name: `Q4 Year 2 ${suffix}`, sortOrder: 2 }).returning();
  const [cls] = await db!.insert(classes).values({ instituteId: instA!.id, name: `Q4 Class ${suffix}` }).returning();
  const [dvA] = await db!.insert(divisions).values({ instituteId: instA!.id, academicYearId: yr1!.id, classId: cls!.id, name: 'A' }).returning();
  const [dvY2] = await db!.insert(divisions).values({ instituteId: instA!.id, academicYearId: yr2!.id, classId: cls!.id, name: 'A' }).returning();

  const studentA = await makeUser('sp_beh_studentA');
  const studentB = await makeUser('sp_beh_studentB');
  const inactiveStudent = await makeUser('sp_beh_studentX');
  const studentC = await makeUser('sp_beh_studentC');
  const studentD = await makeUser('sp_beh_studentD');
  await grantMembership(instA!.id, studentA!.id, ['STUDENT']);
  await grantMembership(instA!.id, studentB!.id, ['STUDENT']);
  await grantMembership(instA!.id, studentC!.id, ['STUDENT']);
  await grantMembership(instA!.id, studentD!.id, ['STUDENT']);
  const [inactiveMembership] = await db!.insert(memberships).values({ userId: inactiveStudent!.id, instituteId: instA!.id, status: 'deactivated' }).returning();
  await db!.insert(membershipRoles).values({ membershipId: inactiveMembership!.id, roleId: roleIds.STUDENT! });

  await t.test('built-in INSTITUTE_ADMIN passes read/get/create/delete/transfer/carry-forward via assignments.manage', async () => {
    for (const handler of [LIST, GET, CREATE, DELETE, TRANSFER, CARRY_PREVIEW, CARRY_COMMIT]) {
      await runChain(handler, await ctx('admin'));
    }
  });

  await t.test('TEACHER/STUDENT/zero-role default-deny every placement route', async () => {
    for (const who of ['teacher', 'student', 'zeroRole'] as const) {
      for (const handler of [LIST, GET, CREATE, DELETE, TRANSFER, CARRY_PREVIEW, CARRY_COMMIT]) {
        await assert.rejects(
          runChain(handler, await ctx(who)),
          ForbiddenException,
          `${who} should be denied`,
        );
      }
    }
  });

  await t.test('delegated custom roles obey exactly their granted sub-actions', async () => {
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);

    const createCustom = async (key: string, permissionKeys: string[]) => {
      const role = await svc.createRole(instA!.id, { key, name: key, description: undefined, permissionKeys });
      return role.id;
    };

    const readOnly = await createCustom(`q4_${suffix}_ro`, ['assignments.read']);
    const createOnly = await createCustom(`q4_${suffix}_co`, ['assignments.create']);
    const deleteOnly = await createCustom(`q4_${suffix}_do`, ['assignments.delete']);
    const both = await createCustom(`q4_${suffix}_bo`, ['assignments.create', 'assignments.delete']);
    const manageAll = await createCustom(`q4_${suffix}_ma`, ['assignments.manage']);

    const membershipOf = async (userId: string) =>
      (await db!.select().from(memberships).where(eq(memberships.userId, userId)).limit(1))[0]!.id;

    await Promise.all([
      assigner.assign(await membershipOf(delegateRead!.id), readOnly),
      assigner.assign(await membershipOf(delegateCreate!.id), createOnly),
      assigner.assign(await membershipOf(delegateDelete!.id), deleteOnly),
      assigner.assign(await membershipOf(delegateBoth!.id), both),
      assigner.assign(await membershipOf(delegateManage!.id), manageAll),
    ]);

    // read-only: reads + carry-forward preview yes (read), mutations no.
    await runChain(LIST, await ctx('delegateRead'));
    await runChain(GET, await ctx('delegateRead'));
    await runChain(CARRY_PREVIEW, await ctx('delegateRead'));
    for (const handler of [CREATE, DELETE, TRANSFER, CARRY_COMMIT]) {
      await assert.rejects(runChain(handler, await ctx('delegateRead')), ForbiddenException);
    }

    // create-only: create yes, reads/delete no, transfer AND commit DENIED (lack delete).
    await assert.rejects(runChain(LIST, await ctx('delegateCreate')), ForbiddenException);
    await assert.rejects(runChain(GET, await ctx('delegateCreate')), ForbiddenException);
    await assert.rejects(runChain(CARRY_PREVIEW, await ctx('delegateCreate')), ForbiddenException);
    await runChain(CREATE, await ctx('delegateCreate'));
    await assert.rejects(runChain(DELETE, await ctx('delegateCreate')), ForbiddenException);
    await assert.rejects(runChain(TRANSFER, await ctx('delegateCreate')), ForbiddenException);
    await assert.rejects(runChain(CARRY_COMMIT, await ctx('delegateCreate')), ForbiddenException);

    // delete-only: delete yes, reads/create no, transfer AND commit DENIED (lack create).
    await assert.rejects(runChain(LIST, await ctx('delegateDelete')), ForbiddenException);
    await assert.rejects(runChain(GET, await ctx('delegateDelete')), ForbiddenException);
    await assert.rejects(runChain(CARRY_PREVIEW, await ctx('delegateDelete')), ForbiddenException);
    await assert.rejects(runChain(CREATE, await ctx('delegateDelete')), ForbiddenException);
    await runChain(DELETE, await ctx('delegateDelete'));
    await assert.rejects(runChain(TRANSFER, await ctx('delegateDelete')), ForbiddenException);
    await assert.rejects(runChain(CARRY_COMMIT, await ctx('delegateDelete')), ForbiddenException);

    // both create+delete: transfer AND commit (combined) pass, single ops pass,
    // reads (incl. preview) denied.
    await assert.rejects(runChain(LIST, await ctx('delegateBoth')), ForbiddenException);
    await assert.rejects(runChain(CARRY_PREVIEW, await ctx('delegateBoth')), ForbiddenException);
    await runChain(CREATE, await ctx('delegateBoth'));
    await runChain(DELETE, await ctx('delegateBoth'));
    await runChain(TRANSFER, await ctx('delegateBoth'));
    await runChain(CARRY_COMMIT, await ctx('delegateBoth'));

    // manage: every route passes via implication.
    for (const handler of [LIST, GET, CREATE, DELETE, TRANSFER, CARRY_PREVIEW, CARRY_COMMIT]) {
      await runChain(handler, await ctx('delegateManage'));
    }
  });

  await t.test('cross-institute: A-owned custom role never grants an A delegate through a B membership', async () => {
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);
    const roleId = await svc.createRole(instA!.id, { key: `q4_${suffix}_x`, name: 'A only', description: undefined, permissionKeys: ['assignments.manage'] }).then((r) => r.id);

    const membershipB = await db!.select().from(memberships).where(eq(memberships.userId, crossDelegate!.id)).limit(1);
    await assert.rejects(assigner.assign(membershipB[0]!.id, roleId), BadRequestException);

    // The B delegate has no A membership → no grant context in A at all.
    await assert.rejects(
      runChain(TRANSFER, { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(crossDelegate!.id, sid.crossDelegate) } }),
      ForbiddenException,
    );
  });

  await t.test('Q.4.2 end-to-end: real handlers place/deactivate/transfer through the guard chain, with conflicts and history retention', async () => {
    const ctl = new StudentPlacementsController(new StudentPlacementsService(db as unknown as Database));
    const membershipOf = async (userId: string) =>
      (await db!.select().from(memberships).where(eq(memberships.userId, userId)).limit(1))[0]!.id;

    // Grant the delegates their catalogued keys via fresh custom roles
    // (distinct keys from the guard-matrix roles above).
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);
    const behaviorRole = async (key: string, permissionKeys: string[]) =>
      (await svc.createRole(instA!.id, { key, name: key, description: undefined, permissionKeys })).id;
    const roleCreate = await behaviorRole(`q4b_${suffix}_co`, ['assignments.create']);
    const roleDelete = await behaviorRole(`q4b_${suffix}_do`, ['assignments.delete']);
    const roleBoth = await behaviorRole(`q4b_${suffix}_bo`, ['assignments.create', 'assignments.delete']);
    await assigner.assign(await membershipOf(delegateCreate!.id), roleCreate);
    await assigner.assign(await membershipOf(delegateDelete!.id), roleDelete);
    await assigner.assign(await membershipOf(delegateBoth!.id), roleBoth);

    const studentAM = await membershipOf(studentA!.id);
    const studentBM = await membershipOf(studentB!.id);
    const inactiveM = await membershipOf(inactiveStudent!.id);

    const invoke = async (who: keyof typeof sid, handler: unknown, ...args: unknown[]) => {
      const request = { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(await userIdFor(who), sid[who]) } };
      const req = await runChain(handler, request);
      return (handler as (...h: unknown[]) => unknown).apply(ctl, [req.tenant, ...args]);
    };

    // successful placement (INSTITUTE_ADMIN via assignments.manage); year derived server-side
    const placed = (await invoke('admin', CREATE, { membershipId: studentAM, divisionId: dvA!.id })) as {
      placement: { id: string; status: string; academicYearId: string };
    };
    assert.equal(placed.placement.status, 'active');
    assert.equal(placed.placement.academicYearId, yr1!.id);

    // duplicate active placement in the same year → 409
    await assert.rejects(
      invoke('admin', CREATE, { membershipId: studentAM, divisionId: dvA!.id }),
      ConflictException,
    );

    // inactive (deactivated) student membership → 400
    await assert.rejects(
      invoke('admin', CREATE, { membershipId: inactiveM, divisionId: dvA!.id }),
      BadRequestException,
    );

    // default-deny STUDENT caller → 403
    await assert.rejects(
      invoke('student', CREATE, { membershipId: studentBM, divisionId: dvA!.id }),
      ForbiddenException,
    );

    // delete-only delegate cannot create → 403
    await assert.rejects(
      invoke('delegateDelete', CREATE, { membershipId: studentBM, divisionId: dvA!.id }),
      ForbiddenException,
    );

    // cross-institute: B-only delegate cannot operate on A → 403
    await assert.rejects(
      invoke('crossDelegate', CREATE, { membershipId: studentBM, divisionId: dvA!.id }),
      ForbiddenException,
    );

    // deactivation by delete-only delegate → soft flip, row retained as history
    await invoke('delegateDelete', DELETE, placed.placement.id);
    const afterDeactivate = (await db!.select({ status: studentPlacements.status }).from(studentPlacements).where(eq(studentPlacements.id, placed.placement.id)))[0];
    assert.equal(afterDeactivate!.status, 'inactive');

    // re-placement after deactivation → fresh ACTIVE row next to the retained history
    const replaced = (await invoke('admin', CREATE, { membershipId: studentAM, divisionId: dvA!.id })) as {
      placement: { id: string; status: string };
    };
    assert.equal(replaced.placement.status, 'active');

    // create-only delegate can place…
    const pB = (await invoke('delegateCreate', CREATE, { membershipId: studentBM, divisionId: dvA!.id })) as {
      placement: { id: string; status: string };
    };
    assert.equal(pB.placement.status, 'active');

    // …but cannot transfer (AND rule: lacks assignments.delete) → 403, before any service work
    await assert.rejects(
      invoke('delegateCreate', TRANSFER, pB.placement.id, { divisionId: dvY2!.id }),
      ForbiddenException,
    );

    // transfer into a year where the student already holds an ACTIVE placement → 409,
    // and the source placement stays active (archive+insert transaction rolled back)
    const pB2 = (await invoke('admin', CREATE, { membershipId: studentBM, divisionId: dvY2!.id })) as {
      placement: { id: string; academicYearId: string };
    };
    assert.equal(pB2.placement.academicYearId, yr2!.id);
    await assert.rejects(
      invoke('delegateBoth', TRANSFER, pB.placement.id, { divisionId: dvY2!.id }),
      ConflictException,
    );
    assert.equal(
      (await db!.select({ status: studentPlacements.status }).from(studentPlacements).where(eq(studentPlacements.id, pB.placement.id)))[0]!.status,
      'active',
    );

    // transfer by a create+delete delegate → source archived, fresh ACTIVE row at the target year
    const moved = (await invoke('delegateBoth', TRANSFER, replaced.placement.id, { divisionId: dvY2!.id })) as {
      placement: { id: string; status: string; academicYearId: string; divisionId: string };
    };
    assert.equal(moved.placement.status, 'active');
    assert.equal(moved.placement.academicYearId, yr2!.id);
    assert.equal(moved.placement.divisionId, dvY2!.id);

    // history retention: nothing deleted; exactly one ACTIVE placement per (student, year)
    const rows = await db!
      .select({ status: studentPlacements.status, membershipId: studentPlacements.membershipId })
      .from(studentPlacements)
      .where(inArray(studentPlacements.membershipId, [studentAM, studentBM]));
    const rowsFor = (membershipId: string) => rows.filter((r) => r.membershipId === membershipId);
    assert.equal(rowsFor(studentAM).filter((r) => r.status === 'active').length, 1);
    assert.equal(rowsFor(studentAM).filter((r) => r.status === 'inactive').length, 2);
    assert.equal(rowsFor(studentBM).filter((r) => r.status === 'active').length, 2); // yr1 + yr2
  });

  await t.test('Q.4.2 carry-forward: real controller preview (read) + commit (create AND delete) through the guard chain', async () => {
    const ctl = new StudentPlacementsController(new StudentPlacementsService(db as unknown as Database));
    const membershipOf = async (userId: string) =>
      (await db!.select().from(memberships).where(eq(memberships.userId, userId)).limit(1))[0]!.id;
    const invoke = async (who: keyof typeof sid, handler: unknown, ...args: unknown[]) => {
      const request = { headers: { 'x-institute-id': instA!.id }, cookies: { access_token: await sign(await userIdFor(who), sid[who]) } };
      const req = await runChain(handler, request);
      return (handler as (...h: unknown[]) => unknown).apply(ctl, [req.tenant, ...args]);
    };
    const studentCM = await membershipOf(studentC!.id);
    const studentDM = await membershipOf(studentD!.id);
    const studentBM = await membershipOf(studentB!.id);

    const pC = ((await invoke('admin', CREATE, { membershipId: studentCM, divisionId: dvA!.id })) as {
      placement: { id: string };
    }).placement;
    const pD = ((await invoke('admin', CREATE, { membershipId: studentDM, divisionId: dvA!.id })) as {
      placement: { id: string };
    }).placement;
    // studentBM already holds an ACTIVE yr1 placement (pB from the prior sub-test)
    const pBm = (await db!
      .select({ id: studentPlacements.id })
      .from(studentPlacements)
      .where(and(eq(studentPlacements.membershipId, studentBM), eq(studentPlacements.academicYearId, yr1!.id), eq(studentPlacements.status, 'active'))))[0]!;

    const activeCount = async () =>
      (await db!.select({ id: studentPlacements.id }).from(studentPlacements)
        .where(and(eq(studentPlacements.instituteId, instA!.id), eq(studentPlacements.status, 'active')))).length;

    // preview is read-only: no mutation, and proposes the same-class destination
    const before = await activeCount();
    const preview = (await invoke('admin', CARRY_PREVIEW, {
      sourceAcademicYearId: yr1!.id,
      destinationAcademicYearId: yr2!.id,
    })) as { preview: { proposals: Array<{ placementId: string; proposedDivisionId: string | null; flags: string[] }> } };
    assert.equal(await activeCount(), before, 'preview must not mutate placements');
    const proposalC = preview.preview.proposals.find((p) => p.placementId === pC.id)!;
    assert.equal(proposalC.proposedDivisionId, dvY2!.id);
    assert.deepEqual(proposalC.flags, []);
    const proposalB = preview.preview.proposals.find((p) => p.placementId === pBm.id)!;
    assert.ok(proposalB.flags.includes('already-active-in-destination-year'));

    // commit denied for a create-only delegate (AND rule: lacks delete) before any service work
    await assert.rejects(
      invoke('delegateCreate', CARRY_COMMIT, {
        destinationAcademicYearId: yr2!.id,
        items: [{ placementId: pC.id, destinationDivisionId: dvY2!.id }],
      }),
      ForbiddenException,
    );

    // cross-institute (B-only) delegate denied on commit
    await assert.rejects(
      invoke('crossDelegate', CARRY_COMMIT, {
        destinationAcademicYearId: yr2!.id,
        items: [{ placementId: pC.id, destinationDivisionId: dvY2!.id }],
      }),
      ForbiddenException,
    );

    // INSTITUTE_ADMIN (assignments.manage) commits: source archived, fresh ACTIVE at destination
    const committed = (await invoke('admin', CARRY_COMMIT, {
      destinationAcademicYearId: yr2!.id,
      items: [{ placementId: pC.id, destinationDivisionId: dvY2!.id }],
    })) as { result: { placements: Array<{ id: string; status: string; academicYearId: string }> } };
    assert.equal(committed.result.placements.length, 1);
    assert.equal(committed.result.placements[0]!.status, 'active');
    assert.equal(committed.result.placements[0]!.academicYearId, yr2!.id);
    assert.equal(
      (await db!.select({ status: studentPlacements.status }).from(studentPlacements).where(eq(studentPlacements.id, pC.id)))[0]!.status,
      'inactive',
    );

    // conflicting plan (pD valid + pBm already occupied in yr2) → 409 and FULL rollback
    await assert.rejects(
      invoke('admin', CARRY_COMMIT, {
        destinationAcademicYearId: yr2!.id,
        items: [
          { placementId: pD.id, destinationDivisionId: dvY2!.id },
          { placementId: pBm.id, destinationDivisionId: dvY2!.id },
        ],
      }),
      ConflictException,
    );
    assert.equal(
      (await db!.select({ status: studentPlacements.status }).from(studentPlacements).where(eq(studentPlacements.id, pD.id)))[0]!.status,
      'active',
      'rollback: valid item source must stay active',
    );
    assert.equal(
      (await db!.select({ status: studentPlacements.status }).from(studentPlacements).where(eq(studentPlacements.id, pBm.id)))[0]!.status,
      'active',
      'rollback: occupied source must stay active',
    );
    const dYr2 = await db!
      .select({ id: studentPlacements.id })
      .from(studentPlacements)
      .where(and(eq(studentPlacements.membershipId, studentDM), eq(studentPlacements.academicYearId, yr2!.id)));
    assert.equal(dYr2.length, 0, 'rollback: no destination placement for the valid item');
  });
});