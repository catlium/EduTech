import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  roles,
  permissions,
  institutes,
  subjects,
  chapters,
  topics,
  classes,
  classSubjects,
  divisions,
  teacherAssignments,
  studentPlacements,
  academicYears,
  contentItems,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { ROLES_KEY } from '../common/decorators/roles.decorator.ts';
import { PermissionGuard } from './permissions.guard.ts';
import { PERMISSIONS_KEY, PERMISSIONS_ALL_KEY } from './permissions.decorator.ts';
import { PERMISSION_CATALOGUE, BUILT_IN_ROLE_PERMISSIONS } from './permission-catalogue.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from './permission-check.service.ts';
import { PermissionSyncService } from './permission-sync.service.ts';
import { RolesService } from './roles.service.ts';
import { RoleAssignmentService } from './role-assignment.service.ts';
import { AcademicScopeService } from './academic-scope.service.ts';
import { ContentService } from '../content/content.service.ts';
import { AcademicController } from '../academic/academic.controller.ts';
import { ContentController } from '../content/content.controller.ts';
import { GenerationController } from '../content/generation.controller.ts';
import { MaterialsController } from '../materials/materials.controller.ts';
import { SyllabusController } from '../syllabus/syllabus.controller.ts';
import { ExportController } from '../export/export.controller.ts';
import { JobsController } from '../jobs/jobs.controller.ts';
import { MaterialEnhancementController } from '../material-enhancement/enhancement.controller.ts';
import { UsersController } from '../users/users.controller.ts';
import { MembershipsController } from '../tenancy/memberships.controller.ts';

/**
 * Phase F5.5 — remaining-surface guard matrix (§13 `subjects` / `chapters` /
 * `topics` / `content` / `materials` / `syllabus` / `exports` / `jobs` /
 * `users`, plus the one new `jobs.create` action).
 *
 * Runs the REAL guard chain, in app.module's registration order, against the
 * REAL controller handlers and their real Reflect metadata, over all 83 audited
 * routes of the nine migrated controllers. It proves:
 *   - the migration is complete and consistent (one catalogue key per handler,
 *     no OR widening, no declared `manage`, no residual role metadata)
 *   - the catalogue grew by exactly one action and it reached the live DB
 *   - each built-in role reaches exactly what it reached before F5.5, with the
 *     single documented widening (`GET /users` for TEACHER) called out
 *   - a custom single-action delegate obeys exactly that sub-action — no sibling
 *     or cross-resource leakage, no implied `manage`
 *   - a zero-role membership and a cross-institute actor are default-denied
 *   - the three intentionally role-gated routes stay role-gated and are proved
 *     load-bearing (the cohort attempt ledger, its preview, role assignment)
 *   - the service layer still answers scope and ownership, not the guard
 * Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
 * unset. Catalogue seeds come from PermissionSyncService (idempotent).
 */

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({
  secret: 'remaining-surface-authz-secret',
  signOptions: { algorithm: 'HS256' },
});
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

// ── The audited surface: 83 routes on nine migrated controllers ─────────
const PROTOS = {
  AcademicController: AcademicController.prototype,
  ContentController: ContentController.prototype,
  GenerationController: GenerationController.prototype,
  MaterialsController: MaterialsController.prototype,
  SyllabusController: SyllabusController.prototype,
  ExportController: ExportController.prototype,
  JobsController: JobsController.prototype,
  MaterialEnhancementController: MaterialEnhancementController.prototype,
  UsersController: UsersController.prototype,
} as const;
const CLASSES = {
  AcademicController,
  ContentController,
  GenerationController,
  MaterialsController,
  SyllabusController,
  ExportController,
  JobsController,
  MaterialEnhancementController,
  UsersController,
} as const;
type SurfaceLabel = keyof typeof PROTOS;

interface Surface {
  readonly label: SurfaceLabel;
  /** [handlerName, declared key, or null when deliberately still role-gated] */
  readonly routes: readonly (readonly [string, string | null])[];
}

const SURFACE: readonly Surface[] = [
  {
    label: 'AcademicController',
    routes: [
      ['listSubjects', 'subjects.read'],
      ['listDeletedSubjects', 'subjects.read'],
      ['createSubject', 'subjects.create'],
      ['getSubject', 'subjects.read'],
      ['updateSubject', 'subjects.update'],
      ['deleteSubject', 'subjects.delete'],
      // restore clears deletedAt on the existing row — the inverse of delete.
      ['restoreSubject', 'subjects.update'],
      ['getDependents', 'subjects.read'],
      ['listChapters', 'chapters.read'],
      ['createChapter', 'chapters.create'],
      ['getChapter', 'chapters.read'],
      ['updateChapter', 'chapters.update'],
      ['listTopics', 'topics.read'],
      ['createTopic', 'topics.create'],
      ['getTopic', 'topics.read'],
      ['updateTopic', 'topics.update'],
    ],
  },
  {
    label: 'ContentController',
    routes: [
      ['create', 'content.create'],
      ['list', 'content.read'],
      ['get', 'content.read'],
      ['update', 'content.update'],
      ['listVersions', 'content.read'],
      ['getVersion', 'content.read'],
      ['archive', 'content.update'],
      ['activate', 'content.update'],
    ],
  },
  {
    label: 'GenerationController',
    routes: [
      ['generate', 'content.create'],
      ['generateStarterMaterial', 'content.create'],
      ['generatePackage', 'content.create'],
      // The generation-status read carried the WRITE role gate even though it
      // only reports job state, so it takes `jobs.read` (STUDENT excluded)
      // rather than `content.read` (STUDENT would gain it).
      ['getGenerationStatus', 'jobs.read'],
      ['generateBatch', 'content.create'],
      ['regenerateResource', 'content.update'],
      ['getBatch', 'jobs.read'],
      ['cancelBatch', 'jobs.update'],
    ],
  },
  {
    label: 'MaterialsController',
    routes: [
      ['createText', 'materials.create'],
      ['upload', 'materials.create'],
      ['list', 'materials.read'],
      ['ocrPages', 'materials.read'],
      ['saveCorrection', 'materials.update'],
      // Removing one correction from the active surface is a delete (§13).
      ['clearCorrection', 'materials.delete'],
      ['get', 'materials.read'],
      ['update', 'materials.update'],
      ['process', 'materials.update'],
      ['retry', 'materials.update'],
      ['archive', 'materials.update'],
      ['activate', 'materials.update'],
    ],
  },
  {
    label: 'SyllabusController',
    routes: [
      ['createText', 'syllabus.create'],
      ['upload', 'syllabus.create'],
      ['list', 'syllabus.read'],
      ['get', 'syllabus.read'],
      ['versions', 'syllabus.read'],
      ['update', 'syllabus.update'],
      ['process', 'syllabus.update'],
      ['retry', 'syllabus.update'],
      ['analyze', 'syllabus.update'],
      ['confirm', 'syllabus.update'],
      ['unlock', 'syllabus.update'],
      ['lock', 'syllabus.update'],
      ['archive', 'syllabus.update'],
      ['remove', 'syllabus.delete'],
    ],
  },
  {
    label: 'ExportController',
    routes: [
      ['exportContent', 'exports.read'],
      ['previewContent', 'exports.read'],
      ['exportQuestions', 'exports.read'],
      ['previewQuestions', 'exports.read'],
      ['exportAssessment', 'exports.read'],
      ['previewAssessment', 'exports.read'],
      // INTENTIONALLY ROLE-GATED — the attempt LEDGER and the aggregate
      // analytics over it are cohort-wide, and no catalogued key can express
      // that boundary (STUDENT must keep `content.read` for its own material).
      ['exportAssessmentResults', null],
      ['previewAssessmentResults', null],
      ['exportPaperPattern', 'exports.read'],
      ['previewPaperPattern', 'exports.read'],
      ['exportQuestionPaper', 'exports.read'],
      ['previewQuestionPaper', 'exports.read'],
    ],
  },
  {
    label: 'JobsController',
    routes: [
      // The one new F5.5 catalogue action.
      ['create', 'jobs.create'],
      ['list', 'jobs.read'],
      ['findOne', 'jobs.read'],
      ['retry', 'jobs.update'],
      ['cancel', 'jobs.update'],
    ],
  },
  {
    label: 'MaterialEnhancementController',
    routes: [
      ['latest', 'materials.read'],
      ['versions', 'materials.read'],
      ['segments', 'materials.read'],
      ['enhance', 'materials.update'],
    ],
  },
  {
    label: 'UsersController',
    routes: [
      ['list', 'users.read'],
      ['create', 'users.create'],
      ['updateStatus', 'users.update'],
      // INTENTIONALLY ROLE-GATED — handing out a role hands out a permission
      // bundle, so `users.update` stays an AND requirement, never a substitute.
      ['setMembershipRoles', null],
    ],
  },
];

type Row = { s: Surface; h: unknown; key: string | null };
const ROWS: readonly Row[] = SURFACE.flatMap((s) =>
  s.routes.map(([name, key]) => ({ s, h: PROTOS[s.label][name as never], key })),
);
const MIGRATED = ROWS.filter((r) => r.key !== null);
const ROLE_GATED = ROWS.filter((r) => r.key === null);
const has = (key: string) => MIGRATED.filter((r) => r.key === key);
const resource = (key: string) => key.split('.')[0]!;
const route = (label: SurfaceLabel, name: string) =>
  ROWS.find((r) => r.s.label === label && nameOf(r) === `${label}.${name}`)!;
const nameOf = (r: Row) =>
  `${r.s.label}.${Object.getOwnPropertyNames(PROTOS[r.s.label]).find((n) => PROTOS[r.s.label][n as never] === r.h) ?? 'unknown'}`;

/**
 * Resources whose `read` STUDENT holds in the built-in map, i.e. the learning
 * reads it must keep. Everything else on the migrated surface is denied.
 */
const STUDENT_READS = new Set([
  'subjects.read',
  'chapters.read',
  'topics.read',
  'content.read',
  'materials.read',
  'syllabus.read',
]);
/** The single documented widening: TEACHER holds `users.read` in the built-in map. */
const TEACHER_NEW = has('users.read');
/** The two user mutations the legacy `INSTITUTE_ADMIN` role gate never opened to TEACHER. */
const TEACHER_DENIED = MIGRATED.filter((r) => ['users.create', 'users.update'].includes(r.key!));

/** A Nest metadata target: a route handler or a controller class. */
type MetaTarget = (...args: never[]) => unknown;
const asTarget = (value: unknown) => value as MetaTarget;

const reflector = () => new Reflector();
const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const permGuard = () =>
  new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

/** Exactly the keys the guards read, resolved handler-then-class like Nest does. */
function declared(r: Row): string[] {
  return [
    ...(reflector().get<string[]>(PERMISSIONS_KEY, asTarget(r.h)) ?? []),
    ...(reflector().get<string[]>(PERMISSIONS_ALL_KEY, asTarget(r.h)) ?? []),
    ...(reflector().get<string[]>(PERMISSIONS_KEY, asTarget(CLASSES[r.s.label])) ?? []),
    ...(reflector().get<string[]>(PERMISSIONS_ALL_KEY, asTarget(CLASSES[r.s.label])) ?? []),
  ];
}
function roleMeta(target: MetaTarget[]): string[] | undefined {
  return reflector().getAllAndOverride<string[]>(ROLES_KEY, target);
}

function ctx(
  r: Row,
  request: { headers: Record<string, string>; cookies: Record<string, string> },
) {
  const req = { ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => r.h as (...args: unknown[]) => unknown,
    getClass: () => CLASSES[r.s.label],
  } as unknown as ExecutionContext;
}

/** The production chain, in the order app.module registers the guards. */
async function chain(
  r: Row,
  request: { headers: Record<string, string>; cookies: Record<string, string> },
) {
  const c = ctx(r, request);
  await accessGuard().canActivate(c);
  await tenantGuard().canActivate(c);
  new RolesGuard(reflector()).canActivate(c);
  await permGuard().canActivate(c);
  return c;
}

test(
  'F5.5 remaining-surface guard matrix',
  { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' },
  async (t) => {
    const svc = db as unknown as Database;
    const sync = await new PermissionSyncService(svc).sync();
    const roleIds = Object.fromEntries(
      (
        await db!
          .select()
          .from(roles)
          .where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']))
      ).map((r) => [r.key, r.id]),
    );

    const suffix = randomUUID().slice(0, 8);
    const [instA] = await db!
      .insert(institutes)
      .values({ name: `RS A ${suffix}`, slug: `rs-a-${suffix}` })
      .returning();
    const [instB] = await db!
      .insert(institutes)
      .values({ name: `RS B ${suffix}`, slug: `rs-b-${suffix}` })
      .returning();
    const instAId = instA!.id;
    const instBId = instB!.id;

    // Institute A academic structure: `s1` is inside teacher1's reach, `s2` is
    // not, so every out-of-scope probe below is a real miss.
    const [s1] = await db!
      .insert(subjects)
      .values({ instituteId: instAId, name: `S1 ${suffix}`, slug: `rs-s1-${suffix}` })
      .returning();
    const [s2] = await db!
      .insert(subjects)
      .values({ instituteId: instAId, name: `S2 ${suffix}`, slug: `rs-s2-${suffix}` })
      .returning();
    const [sB] = await db!
      .insert(subjects)
      .values({ instituteId: instBId, name: `SB ${suffix}`, slug: `rs-sb-${suffix}` })
      .returning();
    const [ch1] = await db!
      .insert(chapters)
      .values({ subjectId: s1!.id, name: `Ch1 ${suffix}`, slug: `rs-ch1-${suffix}` })
      .returning();
    const [top1] = await db!
      .insert(topics)
      .values({ chapterId: ch1!.id, name: `T1 ${suffix}`, slug: `rs-t1-${suffix}` })
      .returning();
    const [yearA] = await db!
      .insert(academicYears)
      .values({ instituteId: instAId, name: `Year ${suffix}` })
      .returning();
    const [cls1] = await db!
      .insert(classes)
      .values({ instituteId: instAId, name: `Class ${suffix}` })
      .returning();
    const [off1] = await db!
      .insert(classSubjects)
      .values({ classId: cls1!.id, subjectId: s1!.id })
      .returning();
    // A second offering in s2 belongs to the out-of-scope teacher, whose scope
    // is therefore {s2} — a precise miss against content in s1, not an empty one.
    const [cls2] = await db!
      .insert(classes)
      .values({ instituteId: instAId, name: `Class2 ${suffix}` })
      .returning();
    const [off2] = await db!
      .insert(classSubjects)
      .values({ classId: cls2!.id, subjectId: s2!.id })
      .returning();
    const [div1] = await db!
      .insert(divisions)
      .values({
        instituteId: instAId,
        academicYearId: yearA!.id,
        classId: cls1!.id,
        name: `Div ${suffix}`,
      })
      .returning();

    const scratchUsers: { id: string; email: string }[] = [];
    const makeUser = async (label: string) => {
      const [u] = await db!
        .insert(users)
        .values({ email: `${label}-${suffix}@example.test`, name: label, passwordHash: 'x' })
        .returning();
      scratchUsers.push(u!);
      return u!;
    };
    const grant = async (instituteId: string, userId: string, roleKeys: string[]) => {
      const [membership] = await db!
        .insert(memberships)
        .values({ userId, instituteId })
        .returning();
      for (const key of roleKeys) {
        await db!
          .insert(membershipRoles)
          .values({ membershipId: membership!.id, roleId: roleIds[key]! });
      }
      return membership!;
    };
    const liveSession = async (userId: string) => {
      const [row] = await db!
        .insert(authSessions)
        .values({
          userId,
          refreshTokenHash: `f55-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning();
      return row!.id;
    };

    const admin = await makeUser('rs_admin');
    const teacher = await makeUser('rs_teacher');
    const student = await makeUser('rs_student');
    const zeroRole = await makeUser('rs_zero');
    const outOfScope = await makeUser('rs_oos');
    const crossAdmin = await makeUser('rs_cross');
    // Holds `users.update` — the very permission role assignment declares — and
    // must still be refused, or a delegate could grant itself INSTITUTE_ADMIN.
    const escalator = await makeUser('rs_escalator');
    // One delegate per declared action, holding NO built-in role: the custom
    // role below is their only grant, so each really is single-action.
    const DELEGATE_KEYS = [...new Set(MIGRATED.map((r) => r.key!))];
    const delegates = new Map<string, { id: string }>();
    for (const key of DELEGATE_KEYS)
      delegates.set(key, await makeUser(`rs_d${key.replace('.', '-')}`));

    const adminMem = await grant(instAId, admin!.id, ['INSTITUTE_ADMIN']);
    const teacherMem = await grant(instAId, teacher!.id, ['TEACHER']);
    const studentMem = await grant(instAId, student!.id, ['STUDENT']);
    await grant(instAId, zeroRole!.id, []);
    const oosMem = await grant(instAId, outOfScope!.id, ['TEACHER']);
    const escMem = await grant(instAId, escalator!.id, []);
    for (const u of delegates.values()) await grant(instAId, u.id, []);
    // A full-permission admin of ANOTHER institute: holds every `R.manage` key
    // but has no membership here, so TenantGuard must refuse first.
    const crossMem = await grant(instBId, crossAdmin!.id, ['INSTITUTE_ADMIN']);

    await db!
      .insert(teacherAssignments)
      .values({ instituteId: instAId, classSubjectId: off1!.id, membershipId: adminMem.id });
    await db!
      .insert(teacherAssignments)
      .values({ instituteId: instAId, classSubjectId: off1!.id, membershipId: teacherMem.id });
    await db!
      .insert(teacherAssignments)
      .values({ instituteId: instAId, classSubjectId: off2!.id, membershipId: oosMem.id });
    await db!.insert(studentPlacements).values({
      instituteId: instAId,
      membershipId: studentMem.id,
      academicYearId: yearA!.id,
      divisionId: div1!.id,
    });

    // One ACTIVE item the teacher created in s1, and one DRAFT item the admin
    // created in the same subject: the second is the ownership probe.
    const [contentActive] = await db!
      .insert(contentItems)
      .values({
        instituteId: instAId,
        subjectId: s1!.id,
        type: 'NOTE',
        title: `Active ${suffix}`,
        status: 'ACTIVE',
        source: 'MANUAL',
        createdBy: teacher!.id,
        updatedBy: teacher!.id,
      })
      .returning();
    const [contentDraft] = await db!
      .insert(contentItems)
      .values({
        instituteId: instAId,
        subjectId: s1!.id,
        type: 'NOTE',
        title: `Draft ${suffix}`,
        status: 'DRAFT',
        source: 'MANUAL',
        createdBy: admin!.id,
        updatedBy: admin!.id,
      })
      .returning();

    // ── custom institute roles: one action each ──
    const rolesSvc = new RolesService(svc);
    const assigner = new RoleAssignmentService(svc);
    const customRoles = new Set<string>();
    const grantCustom = async (key: string, permissionKeys: string[]) => {
      const created = await rolesSvc.createRole(instAId, {
        key: `f55-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
        name: `f55 ${key}`,
        permissionKeys,
      });
      customRoles.add(created.id);
      return created.id;
    };
    for (const key of DELEGATE_KEYS) {
      const d = delegates.get(key)!;
      await assigner.assign(
        (await db!.select().from(memberships).where(eq(memberships.userId, d.id)).limit(1))[0]!.id,
        await grantCustom(key, [key]),
      );
    }
    await assigner.assign(escMem.id, await grantCustom('escalator', ['users.update']));
    // The sibling delegate holds `materials.create` only: it must not reach
    // `materials.read`, `materials.update` or `materials.delete`.
    const siblingKey = 'materials.create';
    const sibling = delegates.get(siblingKey)!;

    t.after(async () => {
      const conn = db!;
      const emails = scratchUsers.map((u) => u.email);
      const userIds = (
        await conn.select({ id: users.id }).from(users).where(inArray(users.email, emails))
      ).map((r) => r.id!);
      const membershipIds = (
        await conn
          .select({ id: memberships.id })
          .from(memberships)
          .where(inArray(memberships.userId, userIds))
      ).map((r) => r.id!);
      if (membershipIds.length) {
        await conn
          .delete(membershipRoles)
          .where(inArray(membershipRoles.membershipId, membershipIds));
        await conn
          .delete(teacherAssignments)
          .where(inArray(teacherAssignments.membershipId, membershipIds));
      }
      await conn.delete(studentPlacements).where(eq(studentPlacements.instituteId, instAId));
      await conn.delete(contentItems).where(eq(contentItems.instituteId, instAId));
      if (userIds.length) {
        await conn.delete(memberships).where(inArray(memberships.userId, userIds));
        await conn.delete(authSessions).where(inArray(authSessions.userId, userIds));
        await conn.delete(users).where(inArray(users.email, emails));
      }
      await conn.delete(divisions).where(eq(divisions.id, div1!.id));
      await conn.delete(classSubjects).where(inArray(classSubjects.id, [off1!.id, off2!.id]));
      await conn.delete(topics).where(eq(topics.id, top1!.id));
      await conn.delete(chapters).where(eq(chapters.id, ch1!.id));
      await conn.delete(classes).where(inArray(classes.id, [cls1!.id, cls2!.id]));
      await conn.delete(academicYears).where(eq(academicYears.id, yearA!.id));
      // Custom roles + their role_permissions rows cascade with the institute.
      await conn.delete(institutes).where(eq(institutes.slug, `rs-a-${suffix}`));
      await conn.delete(institutes).where(eq(institutes.slug, `rs-b-${suffix}`));
      (conn as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
    });

    // ── request factories ──
    const tokens = new Map<string, string>();
    const asUser = async (userId: string) => {
      let tok = tokens.get(userId);
      if (!tok) {
        tok = await sign(userId, await liveSession(userId));
        tokens.set(userId, tok);
      }
      return tok;
    };
    const TOK = {
      admin: await asUser(admin!.id),
      teacher: await asUser(teacher!.id),
      student: await asUser(student!.id),
      zero: await asUser(zeroRole!.id),
      oos: await asUser(outOfScope!.id),
      cross: await asUser(crossAdmin!.id),
      escalator: await asUser(escalator!.id),
      sibling: await asUser(sibling!.id),
    };
    const DELEGATE_TOK = new Map<string, string>();
    for (const [key, u] of delegates) DELEGATE_TOK.set(key, await asUser(u.id));

    type Who = keyof typeof TOK;
    const req = (who: Who, instituteId = instAId) => ({
      headers: { 'x-institute-id': instituteId },
      cookies: { access_token: TOK[who] },
    });
    const run = (r: Row, who: Who, instituteId = instAId) => chain(r, req(who, instituteId));
    const runAs = (r: Row, key: string, instituteId = instAId) =>
      chain(r, {
        headers: { 'x-institute-id': instituteId },
        cookies: { access_token: DELEGATE_TOK.get(key)! },
      });

    // ── the catalogue change ──

    await t.test('the catalogue grew by exactly one action, and it reached the DB', async () => {
      assert.equal(PERMISSION_CATALOGUE.length, 98, 'F5.5 adds an action, not a resource');
      const added = PERMISSION_CATALOGUE.find((p) => p.key === 'jobs.create');
      assert.equal(added?.domain, 'institute');
      // No endpoint deletes a job, so `jobs.delete` must stay uncatalogued.
      assert.ok(!PERMISSION_CATALOGUE.some((p) => p.key === 'jobs.delete'));
      const [row] = await db!.select().from(permissions).where(eq(permissions.key, 'jobs.create'));
      assert.ok(row, 'PermissionSyncService must have seeded jobs.create');
      assert.equal(sync.insertedPermissions <= 1, true, 'sync is incremental, not a re-seed');
    });

    await t.test('TEACHER holds `jobs.create`, so the legacy job gate is preserved', () => {
      assert.ok(BUILT_IN_ROLE_PERMISSIONS.TEACHER.includes('jobs.create'));
      assert.ok(
        !BUILT_IN_ROLE_PERMISSIONS.STUDENT.includes('jobs.create'),
        'STUDENT must gain nothing on jobs',
      );
      // INSTITUTE_ADMIN is not granted it literally — `jobs.manage` implies it.
      assert.ok(!BUILT_IN_ROLE_PERMISSIONS.INSTITUTE_ADMIN.includes('jobs.create'));
      assert.ok(BUILT_IN_ROLE_PERMISSIONS.INSTITUTE_ADMIN.includes('jobs.manage'));
    });

    // ── metadata: the migration happened and left exactly the intended residue ──

    await t.test('all 83 audited routes are accounted for: 80 migrated, 3 role-gated', () => {
      assert.equal(ROWS.length, 83);
      assert.equal(MIGRATED.length, 80);
      assert.equal(ROLE_GATED.length, 3);
      assert.deepEqual(
        ROLE_GATED.map(nameOf).sort(),
        [
          'ExportController.exportAssessmentResults',
          'ExportController.previewAssessmentResults',
          'UsersController.setMembershipRoles',
        ],
        'the role-gated set is exactly the cohort ledger, its preview, and role assignment',
      );
    });

    await t.test('every migrated handler declares exactly one catalogue key and no role', () => {
      for (const r of MIGRATED) {
        assert.deepEqual(declared(r), [r.key], nameOf(r));
        assert.equal(
          roleMeta([asTarget(r.h), asTarget(CLASSES[r.s.label])]),
          undefined,
          `${nameOf(r)} must carry no @RequiredRoles`,
        );
      }
      for (const s of SURFACE) {
        assert.equal(
          roleMeta([asTarget(CLASSES[s.label])]),
          undefined,
          `${s.label} class must carry no @RequiredRoles`,
        );
      }
    });

    await t.test(
      'the three role-gated routes keep a role gate the catalogue cannot replace',
      () => {
        // A role-gated route is one whose boundary NO `R.action` key can express.
        // The cohort results exports therefore declare no permission at all, and
        // role assignment declares `users.update` as an AND requirement on top of
        // the role — never as a substitute for it.
        for (const r of ROLE_GATED.filter((x) => x.s.label === 'ExportController')) {
          assert.deepEqual(declared(r), [], `${nameOf(r)} must authorize by role alone`);
          assert.deepEqual(roleMeta([asTarget(r.h)]), ['INSTITUTE_ADMIN', 'TEACHER']);
        }
        const setRoles = route('UsersController', 'setMembershipRoles');
        assert.deepEqual(roleMeta([asTarget(setRoles.h)]), ['INSTITUTE_ADMIN']);
        assert.deepEqual(
          [
            ...(reflector().get<string[]>(PERMISSIONS_KEY, asTarget(setRoles.h)) ?? []),
            ...(reflector().get<string[]>(PERMISSIONS_KEY, asTarget(UsersController)) ?? []),
          ],
          ['users.update'],
          'the AND requirement: users.update AND the INSTITUTE_ADMIN role',
        );
      },
    );

    await t.test('no declared key is a manage, an OR pair, or an AND group', () => {
      for (const r of MIGRATED) {
        assert.match(
          r.key!,
          /^(subjects|chapters|topics|content|materials|syllabus|exports|jobs|users)\.(read|create|update|delete)$/,
          nameOf(r),
        );
        assert.equal(
          r.key!.endsWith('.manage'),
          false,
          'a manage grantee is satisfied by implication, never by declaration',
        );
        assert.equal(
          reflector().get<string[]>(PERMISSIONS_ALL_KEY, asTarget(r.h)),
          undefined,
          `${nameOf(r)} must not declare an AND group`,
        );
      }
    });

    await t.test('every migrated controller registers the four guards in order', () => {
      for (const s of SURFACE) {
        const guards = (
          (Reflect.getMetadata('__guards__', CLASSES[s.label]) as { name: string }[] | undefined) ??
          []
        ).map((g) => g.name);
        assert.deepEqual(
          guards,
          ['AccessTokenGuard', 'TenantGuard', 'RolesGuard', 'PermissionGuard'],
          `${s.label} guard chain`,
        );
      }
    });

    // ── built-in roles ──

    await t.test('built-in INSTITUTE_ADMIN passes all 83 routes', async () => {
      for (const r of ROWS) await run(r, 'admin');
    });

    await t.test('built-in TEACHER reaches exactly what the legacy role gate reached', async () => {
      assert.deepEqual(
        TEACHER_DENIED.map(nameOf).sort(),
        ['UsersController.create', 'UsersController.updateStatus'],
        'create + set status are the two admin-only user mutations',
      );
      for (const r of MIGRATED.filter((x) => !TEACHER_DENIED.includes(x))) await run(r, 'teacher');
      for (const r of TEACHER_DENIED) {
        await assert.rejects(run(r, 'teacher'), ForbiddenException, nameOf(r));
      }
      // The two role gates that name TEACHER…
      for (const r of ROLE_GATED.filter((x) => roleMeta([asTarget(x.h)])?.includes('TEACHER')))
        await run(r, 'teacher');
      // …and not the INSTITUTE_ADMIN-only role assignment.
      await assert.rejects(run(route('UsersController', 'setMembershipRoles'), 'teacher'));
    });

    await t.test('the single deliberate widening: TEACHER now reads `GET /users`', async () => {
      // Documented, not accidental: TEACHER already holds `users.read` in the
      // built-in map and the web app already gates `/users` on that key, so the
      // shipped teacher rosters were calling this route and getting 403.
      assert.equal(TEACHER_NEW.length, 1);
      assert.equal(nameOf(TEACHER_NEW[0]!), 'UsersController.list');
      await run(TEACHER_NEW[0]!, 'teacher');
      // The widening stops at TEACHER: STUDENT holds no `users.read`.
      await assert.rejects(run(TEACHER_NEW[0]!, 'student'), ForbiddenException);
    });

    await t.test('STUDENT keeps its learning reads and is denied every mutation', async () => {
      const allowed = MIGRATED.filter((r) => STUDENT_READS.has(r.key!));
      const denied = MIGRATED.filter((r) => !STUDENT_READS.has(r.key!));
      assert.ok(allowed.length > 0 && denied.length > 0);
      for (const r of allowed) await run(r, 'student');
      for (const r of denied)
        await assert.rejects(run(r, 'student'), ForbiddenException, nameOf(r));
      // `exports` and `jobs` are denied outright, at every action.
      for (const r of MIGRATED.filter((x) => ['exports', 'jobs'].includes(resource(x.key!)))) {
        await assert.rejects(run(r, 'student'), ForbiddenException, nameOf(r));
      }
    });

    await t.test('a zero-role membership default-denies every migrated route', async () => {
      for (const r of MIGRATED) await assert.rejects(run(r, 'zero'), ForbiddenException, nameOf(r));
    });

    await t.test('no token is refused before any grant is consulted', async () => {
      for (const r of ROWS) {
        const c = ctx(r, { headers: { 'x-institute-id': instAId }, cookies: {} });
        await assert.rejects(accessGuard().canActivate(c), UnauthorizedException, nameOf(r));
      }
    });

    // ── delegated custom institute roles ──

    await t.test('a single-action delegate reaches only its own sub-action', async () => {
      for (const key of DELEGATE_KEYS) {
        const own = has(key);
        assert.ok(own.length > 0, `${key} must be declared by at least one route`);
        for (const r of own) await runAs(r, key);
        // Every other route on the SAME resource is refused…
        for (const r of MIGRATED.filter(
          (x) => resource(x.key!) === resource(key) && x.key !== key,
        )) {
          await assert.rejects(runAs(r, key), ForbiddenException, `${nameOf(r)} ← ${key} only`);
        }
        // …and so is every route on any other resource.
        for (const r of MIGRATED.filter((x) => resource(x.key!) !== resource(key))) {
          await assert.rejects(
            runAs(r, key),
            ForbiddenException,
            `${nameOf(r)} ← ${key} only (x-res)`,
          );
        }
      }
    });

    await t.test('a sibling-action delegate does not inherit its neighbour', async () => {
      await runAs(route('MaterialsController', 'createText'), siblingKey);
      for (const name of ['clearCorrection', 'update', 'list']) {
        await assert.rejects(
          runAs(route('MaterialsController', name), siblingKey),
          ForbiddenException,
          `MaterialsController.${name} must deny a materials.create-only delegate`,
        );
      }
    });

    // ── institute boundary ──

    await t.test('a full-permission admin of another institute is refused here', async () => {
      const list = route('AcademicController', 'listSubjects');
      // `cross` holds INSTITUTE_ADMIN in B and every `R.manage` key, but has no
      // membership in A: TenantGuard must refuse on the membership, before any
      // grant is consulted.
      await assert.rejects(run(list, 'cross'), ForbiddenException);
      // With the header naming its own institute, the same actor resolves.
      await run(list, 'cross', instBId);
      // A missing header is refused outright.
      const c = ctx(list, { headers: {}, cookies: { access_token: TOK.cross } });
      await assert.rejects(tenantGuard().canActivate(c), ForbiddenException);
      assert.equal(crossMem.instituteId, instBId);
      assert.ok(sB!.instituteId === instBId);
    });

    await t.test('an institute-A custom role grants nothing in institute B', async () => {
      await assert.rejects(
        runAs(route('AcademicController', 'listSubjects'), 'subjects.read', instBId),
        ForbiddenException,
      );
    });

    // ── the documented role-gated exceptions are load-bearing ──

    await t.test('the results exports stay teacher-only for a real reason', async () => {
      // The service layer alone would hand a placed student the cohort ledger,
      // because the MOD-4 `getAssessment` gate passes for a subject-set scope.
      // That is exactly why no catalogue key can express this boundary, and why
      // the role gate must stay.
      assert.deepEqual(await new AcademicScopeService(svc).resolveScope(instAId, studentMem.id), {
        kind: 'subject-set',
        subjectIds: [s1!.id],
      });
      assert.ok(
        !BUILT_IN_ROLE_PERMISSIONS.STUDENT.some((k) => k.startsWith('exports.')),
        'STUDENT holds no exports.* key, so exports.read cannot express the cohort boundary',
      );
      for (const r of ROLE_GATED.filter((x) => x.s.label === 'ExportController')) {
        await assert.rejects(run(r, 'student'), ForbiddenException, nameOf(r));
        await assert.rejects(run(r, 'zero'), ForbiddenException, nameOf(r));
        await run(r, 'teacher');
        await run(r, 'admin');
      }
    });

    await t.test(
      'role assignment stays INSTITUTE_ADMIN-only — no permission substitutes',
      async () => {
        const setRoles = route('UsersController', 'setMembershipRoles');
        // A custom role holding `users.update` — the permission this route
        // declares — must still be refused, or a delegate could grant itself
        // INSTITUTE_ADMIN and take the whole institute.
        await assert.rejects(run(setRoles, 'escalator'), ForbiddenException);
        await assert.rejects(run(setRoles, 'teacher'), ForbiddenException);
        await assert.rejects(run(setRoles, 'student'), ForbiddenException);
        await run(setRoles, 'admin');
        assert.ok(customRoles.size > 0);
      },
    );

    // ── a permission never replaces a service-layer scope/ownership check ──

    await t.test('the service layer still answers scope and ownership, not the guard', async () => {
      const contentSvc = new ContentService(svc, new AcademicScopeService(svc));
      // The teacher's own ACTIVE item in a subject it teaches: readable.
      const own = await contentSvc.getContent(
        instAId,
        teacherMem.id,
        teacher!.id,
        contentActive!.id,
      );
      assert.equal(own.item.id, contentActive!.id);
      // A TEACHER outside that academic scope holds `content.read` and is still
      // refused — with 404, never 403, so the route cannot be used to probe for
      // the existence of another teacher's content.
      await assert.rejects(
        contentSvc.getContent(instAId, oosMem.id, outOfScope!.id, contentActive!.id),
        NotFoundException,
      );
      // Ownership: a DRAFT item in the teacher's own subject, created by the
      // admin. Read is 404, mutate is 403 — the creator rule survives.
      await assert.rejects(
        contentSvc.getContent(instAId, teacherMem.id, teacher!.id, contentDraft!.id),
        NotFoundException,
      );
      await assert.rejects(
        contentSvc.updateContent(instAId, teacherMem.id, teacher!.id, contentDraft!.id, {
          payload: { blocks: [{ id: `b-${suffix}`, type: 'paragraph', content: 'x' }] },
        }),
        ForbiddenException,
      );
      // The admin created it and administers the institute: both allowed.
      assert.equal(
        (await contentSvc.getContent(instAId, adminMem.id, admin!.id, contentDraft!.id)).item.id,
        contentDraft!.id,
      );
      // Cross-institute: institute B cannot see institute A's item at all.
      await assert.rejects(
        contentSvc.getContent(instBId, crossMem.id, crossAdmin!.id, contentActive!.id),
        NotFoundException,
      );
    });

    // ── memberships: deliberately outside F5.5 ──

    await t.test('the two self-scoped membership routes stay outside the migration', () => {
      // `GET /memberships` lists the CALLER's own institutes (it must run before
      // an x-institute-id is chosen) and `GET /memberships/scope` returns the
      // caller's own scope. Neither is an institute resource, so no `R.action`
      // key applies: they are identity endpoints, not permission-gated ones.
      const classGuards = (
        (Reflect.getMetadata('__guards__', MembershipsController) as { name: string }[]) ?? []
      ).map((g) => g.name);
      assert.deepEqual(
        classGuards,
        ['AccessTokenGuard'],
        'F5.5 did not touch MembershipsController',
      );
      assert.deepEqual(
        (
          Reflect.getMetadata('__guards__', MembershipsController.prototype.scope) as {
            name: string;
          }[]
        ).map((g) => g.name),
        ['TenantGuard'],
        'GET /memberships/scope keeps its method-level TenantGuard',
      );
      assert.equal(
        Reflect.getMetadata('__guards__', MembershipsController.prototype.list),
        undefined,
        'GET /memberships has no method-level guard — it resolves the caller itself',
      );
    });
  },
);
