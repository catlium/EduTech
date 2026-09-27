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
  chapters,
  classes,
  classSubjects,
  academicYears,
  teacherAssignments,
  questions,
  questionTypes,
  paperPatterns,
  paperPatternSubjects,
} from '@catlium/database';
import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from '../authorization/permissions.guard.ts';
import { PERMISSIONS_KEY } from '../authorization/permissions.decorator.ts';
import { ROLES_KEY } from '../common/decorators/roles.decorator.ts';
import type { TenantContext } from '../common/decorators/tenant.decorator.ts';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from '../authorization/permission-check.service.ts';
import { PermissionSyncService } from '../authorization/permission-sync.service.ts';
import { RolesService } from '../authorization/roles.service.ts';
import { RoleAssignmentService } from '../authorization/role-assignment.service.ts';
import { AcademicScopeService } from '../authorization/academic-scope.service.ts';
import { QuestionsController } from './questions.controller.ts';
import { QuestionsService } from './questions.service.ts';
import { QuestionTypesController } from './question-types.controller.ts';
import { QuestionTypesService } from './question-types.service.ts';
import { QuestionExtractionController } from '../question-extraction/question-extraction.controller.ts';
import { PaperPatternsController } from '../paper-patterns/paper-patterns.controller.ts';
import { QuestionPapersController } from '../question-papers/question-papers.controller.ts';

// Phase F5.3 — Question + Paper guard matrix (§13 `questions` / `question-types`
// / `paper-patterns` / `question-papers`). Runs the REAL guard chain against the
// REAL controller handlers (their metadata) for all five controllers of the
// audited surface, proving the catalogued permissions declare exactly what the
// routes enforce:
//   - INSTITUTE_ADMIN passes every migrated route via the built-in R.manage grant
//     (implication rule); TEACHER passes via the recorded read/create/update/delete
//   - delegated custom roles obey exactly their granted sub-action, per resource,
//     with no OR widening and no cross-resource leakage
//   - STUDENT reaches only `GET /question-types` (the one read the documented
//     model permits) and is denied every authoring route; zero-role default-denies
//   - no stale @RequiredRoles metadata remains on the migrated handlers, and the
//     three deliberately deferred routes still carry exactly theirs
//   - a permission never substitutes for the service's institute / academic-scope
//     / staging-ownership checks: a fully-authorized delegate still misses another
//     institute's row, an out-of-scope subject, and another teacher's staged row
// Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
// unset. Permission/role seeds come from PermissionSyncService (idempotent).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'question-paper-authz-test-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

// ── The audited surface: all 65 routes on the five controllers ──────────
const PROTOS = {
  QuestionsController: QuestionsController.prototype,
  QuestionTypesController: QuestionTypesController.prototype,
  QuestionExtractionController: QuestionExtractionController.prototype,
  PaperPatternsController: PaperPatternsController.prototype,
  QuestionPapersController: QuestionPapersController.prototype,
} as const;
const CLASSES = {
  QuestionsController,
  QuestionTypesController,
  QuestionExtractionController,
  PaperPatternsController,
  QuestionPapersController,
} as const;
type SurfaceLabel = keyof typeof PROTOS;

interface Surface {
  readonly label: SurfaceLabel;
  /** [handler, declared key, or null when deliberately still role-based] */
  readonly routes: readonly (readonly [string, string | null])[];
}

const SURFACE: readonly Surface[] = [
  {
    label: 'QuestionsController',
    routes: [
      ['create', 'questions.create'],
      ['list', 'questions.read'],
      ['get', 'questions.read'],
      ['update', 'questions.update'],
      ['delete', 'questions.delete'],
      ['generate', 'questions.create'],
      ['getGeneration', 'questions.read'],
      ['bankGenerate', 'questions.create'],
      ['bankBatch', 'questions.read'],
      ['cancelBankBatch', 'questions.update'],
      ['retryFailedBankBatch', 'questions.update'],
      ['bankSets', 'questions.read'],
      ['bankStats', 'questions.read'],
      ['generateMore', 'questions.create'],
      ['bankStarter', 'questions.create'],
      ['deriveDistribution', 'questions.read'],
      ['bankGenerateFromBlueprint', 'questions.create'],
      ['batchApprove', 'questions.update'],
      ['batchReject', 'questions.update'],
      ['approve', 'questions.update'],
      ['reject', 'questions.update'],
      // archive is `delete` per §13 action granularity ("delete/archive/discard")
      ['archive', 'questions.delete'],
      ['activate', 'questions.update'],
    ],
  },
  {
    label: 'QuestionTypesController',
    routes: [
      ['list', 'question-types.read'],
      // CATALOGUE GAP: no `question-types.create` — stays role-based (reported).
      ['create', null],
    ],
  },
  {
    label: 'QuestionExtractionController',
    routes: [
      ['extract', 'questions.create'],
      ['extractSourceText', 'questions.create'],
      ['extractSourceFile', 'questions.create'],
      ['status', 'questions.read'],
      ['candidates', 'questions.read'],
      ['updateCandidate', 'questions.update'],
      ['acceptCandidate', 'questions.update'],
      ['generateAnswer', 'questions.update'],
      ['discardCandidate', 'questions.delete'],
      ['importAll', 'questions.update'],
      ['discardAll', 'questions.delete'],
    ],
  },
  {
    label: 'PaperPatternsController',
    routes: [
      ['create', 'paper-patterns.create'],
      ['extractText', 'paper-patterns.create'],
      ['extractFile', 'paper-patterns.create'],
      ['extractionStatus', 'paper-patterns.read'],
      ['list', 'paper-patterns.read'],
      ['get', 'paper-patterns.read'],
      ['update', 'paper-patterns.update'],
      ['remove', 'paper-patterns.delete'],
      ['analyze', 'paper-patterns.update'],
      ['getAnalysis', 'paper-patterns.read'],
      ['validate', 'paper-patterns.read'],
      ['approve', 'paper-patterns.update'],
      ['unlock', 'paper-patterns.update'],
      ['lock', 'paper-patterns.update'],
      // F5.4: creates an `assessments` row — that key is not F5.3's to add.
      ['createAssessment', null],
    ],
  },
  {
    label: 'QuestionPapersController',
    routes: [
      ['create', 'question-papers.create'],
      ['extractText', 'question-papers.create'],
      ['extractFile', 'question-papers.create'],
      ['extractionStatus', 'question-papers.read'],
      ['list', 'question-papers.read'],
      ['get', 'question-papers.read'],
      ['rename', 'question-papers.update'],
      ['delete', 'question-papers.delete'],
      ['listQuestions', 'question-papers.read'],
      ['selectFromPattern', 'question-papers.update'],
      ['patternCoverage', 'question-papers.read'],
      ['setScope', 'question-papers.update'],
      ['generateMissing', 'question-papers.update'],
      // F5.4: creates an `assessments` row.
      ['createAssessment', null],
    ],
  },
];

const handler = (label: SurfaceLabel, name: string) => PROTOS[label][name as never] as unknown;
const nameOf = (label: SurfaceLabel, h: unknown) =>
  `${label}.${Object.getOwnPropertyNames(PROTOS[label]).find((n) => PROTOS[label][n as never] === h) ?? 'unknown'}`;
/** Flat [surface, handler, key] rows; `key === null` marks a deferred route. */
const ROWS = SURFACE.flatMap((s) => s.routes.map(([name, key]) => ({ s, h: handler(s.label, name), key })));
const MIGRATED = ROWS.filter((r) => r.key !== null);
const DEFERRED = ROWS.filter((r) => r.key === null);
/** Every migrated route except the single student-readable one. */
const AUTHORING = MIGRATED.filter((r) => r.h !== PROTOS.QuestionTypesController.list);
const has = (key: string) => MIGRATED.filter((r) => r.key === key);
const resource = (key: string) => key.split('.')[0]!;

function reqContext(r: (typeof ROWS)[number], request: { headers: Record<string, string>; cookies: Record<string, string> }) {
  const req = { ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => r.h as (...args: unknown[]) => unknown,
    getClass: () => CLASSES[r.s.label],
  } as unknown as ExecutionContext;
}

const reflector = () => new Reflector();
const accessGuard = () => new AccessTokenGuard(db as unknown as Database, JWT);
const tenantGuard = () => new TenantGuard(new TenancyService(db as unknown as Database));
const permGuard = () => new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

/** The single permission key a handler declares, as the guards read it. */
function declared(r: (typeof ROWS)[number]): string | undefined {
  const keys = reflector().getAllAndOverride<string[]>(PERMISSIONS_KEY, [
    r.h as (...args: unknown[]) => unknown,
    CLASSES[r.s.label],
  ]);
  return keys?.length === 1 ? keys[0] : undefined;
}

/** Any residual @RequiredRoles metadata. */
function roleMeta(r: (typeof ROWS)[number]): string[] | undefined {
  return reflector().getAllAndOverride<string[]>(ROLES_KEY, [
    r.h as (...args: unknown[]) => unknown,
    CLASSES[r.s.label],
  ]);
}

/** The full production chain, in the order app.module registers the guards. */
async function runChain(r: (typeof ROWS)[number], request: { headers: Record<string, string>; cookies: Record<string, string> }) {
  const ctx = reqContext(r, request);
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  new RolesGuard(reflector()).canActivate(ctx); // stale-role check: must be a no-op now
  await permGuard().canActivate(ctx);
  return ctx;
}

test('F5.3 question + paper guard matrix', { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' }, async (t) => {
  await new PermissionSyncService(db as unknown as Database).sync();
  const roleRows = await db!.select().from(roles).where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']));
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));

  const suffix = randomUUID().slice(0, 8);
  const [instA] = await db!.insert(institutes).values({ name: `QP A ${suffix}`, slug: `qp-a-${suffix}` }).returning();
  const [instB] = await db!.insert(institutes).values({ name: `QP B ${suffix}`, slug: `qp-b-${suffix}` }).returning();

  const makeUser = async (label: string) => {
    const [u] = await db!.insert(users).values({ email: `${label}-${suffix}@example.test`, name: label, passwordHash: 'x' }).returning();
    return u!;
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
      .values({ userId, refreshTokenHash: `f53-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    return row!.id;
  };

  // Institute A fixtures. s1 + its offering is `teacher1`'s academic reach, s2 +
  // its offering is `teacher2`'s; neither reaches the other's subject.
  const [s1] = await db!.insert(subjects).values({ instituteId: instA!.id, name: `S1 ${suffix}`, slug: `qp-s1-${suffix}` }).returning();
  const [s2] = await db!.insert(subjects).values({ instituteId: instA!.id, name: `S2 ${suffix}`, slug: `qp-s2-${suffix}` }).returning();
  const [sB] = await db!.insert(subjects).values({ instituteId: instB!.id, name: `SB ${suffix}`, slug: `qp-sb-${suffix}` }).returning();
  const [ch1] = await db!.insert(chapters).values({ subjectId: s1!.id, name: `Ch1 ${suffix}`, slug: `qp-ch1-${suffix}` }).returning();
  const [ch2] = await db!.insert(chapters).values({ subjectId: s2!.id, name: `Ch2 ${suffix}`, slug: `qp-ch2-${suffix}` }).returning();
  const [chB] = await db!.insert(chapters).values({ subjectId: sB!.id, name: `ChB ${suffix}`, slug: `qp-chb-${suffix}` }).returning();
  const [yearA] = await db!.insert(academicYears).values({ instituteId: instA!.id, name: `Year ${suffix}` }).returning();
  const [cls1] = await db!.insert(classes).values({ instituteId: instA!.id, name: `Class 1 ${suffix}` }).returning();
  const [cls2] = await db!.insert(classes).values({ instituteId: instA!.id, name: `Class 2 ${suffix}` }).returning();
  const [off1] = await db!.insert(classSubjects).values({ classId: cls1!.id, subjectId: s1!.id }).returning();
  const [off2] = await db!.insert(classSubjects).values({ classId: cls2!.id, subjectId: s2!.id }).returning();

  const admin = await makeUser('qp_admin');
  const teacher1 = await makeUser('qp_teacher1');
  const teacher2 = await makeUser('qp_teacher2');
  const student = await makeUser('qp_student');
  const zeroRole = await makeUser('qp_zerorole');
  const dRead = await makeUser('qp_d_read');
  const dCreate = await makeUser('qp_d_create');
  const dUpdate = await makeUser('qp_d_update');
  const dDelete = await makeUser('qp_d_delete');
  const dPattern = await makeUser('qp_d_pattern');
  const dPaper = await makeUser('qp_d_paper');
  const dManage = await makeUser('qp_d_manage');
  const crossDelegate = await makeUser('qp_d_cross');

  await grantMembership(instA!.id, admin!.id, ['INSTITUTE_ADMIN']);
  const t1Mem = await grantMembership(instA!.id, teacher1!.id, ['TEACHER']);
  await grantMembership(instA!.id, teacher2!.id, ['TEACHER']);
  await grantMembership(instA!.id, student!.id, ['STUDENT']);
  await grantMembership(instA!.id, zeroRole!.id, []);
  // Delegates hold NO built-in role: the custom role below is their only grant, so
  // a "read-only delegate" really is read-only. (TEACHER already carries all four
  // questions.* keys, so a TEACHER base would union them back in.)
  for (const u of [dRead, dCreate, dUpdate, dDelete, dPattern, dPaper, dManage]) {
    await grantMembership(instA!.id, u!.id, []);
  }
  await grantMembership(instB!.id, crossDelegate!.id, ['TEACHER']);

  await db!.insert(teacherAssignments).values({ instituteId: instA!.id, classSubjectId: off1!.id, membershipId: t1Mem.id });
  await db!.insert(teacherAssignments).values({ instituteId: instA!.id, classSubjectId: off2!.id, membershipId: (await db!.select().from(memberships).where(eq(memberships.userId, teacher2!.id)).limit(1))[0]!.id });
  // dManage's only role is a custom questions.manage role (no built-in TEACHER), so
  // it needs its own class assignment or its academic scope would be empty and the
  // in-institute read would be denied by scope rather than by permissions.
  await db!.insert(teacherAssignments).values({ instituteId: instA!.id, classSubjectId: off1!.id, membershipId: (await db!.select().from(memberships).where(eq(memberships.userId, dManage!.id)).limit(1))[0]!.id });

  // Bank rows: an APPROVED s1 question, plus PENDING staging rows owned by
  // teacher1 (O1: only the owner or an admin may ever see them) and by teacher2
  // in teacher2's own subject. A foreign-institute question proves institute
  // scoping survives the permission layer.
  const mkQuestion = async (instituteId: string, subjectId: string | null, chapterId: string | null, createdBy: string, over: Record<string, unknown> = {}) => {
    const [row] = await db!.insert(questions).values({
      instituteId, subjectId, chapterId, topicId: null,
      stem: `Q ${suffix}`, questionType: 'MCQ', difficulty: 'MEDIUM',
      status: 'ACTIVE', approvalStatus: 'APPROVED',
      payload: { stem: `Q ${suffix}`, options: ['a', 'b'], correctAnswer: 'a' },
      createdBy, updatedBy: createdBy, ...over,
    } as never).returning();
    return row!;
  };
  const approvedInS1 = await mkQuestion(instA!.id, s1!.id, ch1!.id, admin!.id);
  const stagedByT1 = await mkQuestion(instA!.id, s1!.id, ch1!.id, teacher1!.id, { approvalStatus: 'PENDING', status: 'DRAFT' });
  const approvedInS2 = await mkQuestion(instA!.id, s2!.id, ch2!.id, teacher2!.id);
  const foreignQuestion = await mkQuestion(instB!.id, sB!.id, chB!.id, admin!.id);

  const patternIds: string[] = [];
  const [patternA] = await db!.insert(paperPatterns).values({ instituteId: instA!.id, title: `Pattern A ${suffix}`, createdBy: admin!.id, updatedBy: admin!.id }).returning();
  patternIds.push(patternA!.id);
  await db!.insert(paperPatternSubjects).values({ patternId: patternA!.id, subjectId: s1!.id });
  const [typeA] = await db!.insert(questionTypes).values({ instituteId: instA!.id, name: `Type ${suffix}`, code: `QT-${suffix}`, answerFormat: 'MCQ', kind: 'OBJECTIVE' }).returning();

  const ACTORS = {
    admin: admin!, teacher: teacher1!, teacher2: teacher2!, student: student!, zeroRole: zeroRole!,
    dRead: dRead!, dCreate: dCreate!, dUpdate: dUpdate!, dDelete: dDelete!,
    dPattern: dPattern!, dPaper: dPaper!, dManage: dManage!, cross: crossDelegate!,
  } as const;
  type Actor = keyof typeof ACTORS;
  const session: Partial<Record<Actor, string>> = {};
  for (const [name, u] of Object.entries(ACTORS)) session[name as Actor] = await liveSession(u.id);
  const token: Partial<Record<Actor, string>> = {};
  for (const [name, u] of Object.entries(ACTORS)) token[name as Actor] = await sign(u.id, session[name as Actor]!);

  t.after(async () => {
    if (!db) return;
    const emails = Object.values(ACTORS).map((u) => u.email);
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id!);
    const membershipIds = userIds.length
      ? (await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))).map((r) => r.id!)
      : [];
    // Content first (its created_by rows reference users), then the tenancy rows,
    // then the users, then the structural rows the scope fixtures hang off.
    await db.delete(questions).where(inArray(questions.instituteId, [instA!.id, instB!.id]));
    await db.delete(paperPatternSubjects).where(inArray(paperPatternSubjects.patternId, patternIds));
    await db.delete(paperPatterns).where(inArray(paperPatterns.instituteId, [instA!.id, instB!.id]));
    await db.delete(questionTypes).where(inArray(questionTypes.instituteId, [instA!.id, instB!.id]));
    if (membershipIds.length) {
      await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
      await db.delete(teacherAssignments).where(inArray(teacherAssignments.membershipId, membershipIds));
    }
    if (userIds.length) {
      await db.delete(memberships).where(inArray(memberships.userId, userIds));
      await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
      await db.delete(users).where(inArray(users.email, emails));
    }
    await db.delete(classSubjects).where(inArray(classSubjects.id, [off1!.id, off2!.id]));
    await db.delete(chapters).where(inArray(chapters.id, [ch1!.id, ch2!.id, chB!.id]));
    await db.delete(subjects).where(inArray(subjects.id, [s1!.id, s2!.id, sB!.id]));
    await db.delete(classes).where(inArray(classes.id, [cls1!.id, cls2!.id]));
    await db.delete(academicYears).where(eq(academicYears.id, yearA!.id));
    // Custom institute roles (and their permission rows) cascade with the institute.
    await db.delete(institutes).where(inArray(institutes.slug, [`qp-a-${suffix}`, `qp-b-${suffix}`]));
  });

  const asUser = (u: { id: string }): AuthenticatedUser => ({ userId: u.id });
  const req = (who: Actor, instituteId = instA!.id) => ({
    headers: { 'x-institute-id': instituteId },
    cookies: { access_token: token[who]! },
  });
  const chain = (r: (typeof ROWS)[number], who: Actor, instituteId = instA!.id) => runChain(r, req(who, instituteId));
  const tenantOf = async (r: (typeof ROWS)[number], who: Actor) =>
    (await chain(r, who)).switchToHttp().getRequest()['tenant'] as TenantContext;

  // ── Metadata: the migration happened, and left exactly the intended residue ──

  await t.test('all 65 audited routes are accounted for: 62 migrated, 3 deferred', () => {
    assert.equal(ROWS.length, 65);
    assert.equal(MIGRATED.length, 62);
    assert.equal(DEFERRED.length, 3);
    assert.deepEqual(
      DEFERRED.map((r) => nameOf(r.s.label, r.h)).sort(),
      ['PaperPatternsController.createAssessment', 'QuestionPapersController.createAssessment', 'QuestionTypesController.create'],
      'the deferred set is exactly the audited trio',
    );
  });

  await t.test('every migrated handler declares exactly one catalogue permission and no role metadata', () => {
    for (const r of MIGRATED) {
      assert.equal(declared(r), r.key, nameOf(r.s.label, r.h));
      assert.equal(roleMeta(r), undefined, `${nameOf(r.s.label, r.h)} must carry no @RequiredRoles`);
    }
    for (const s of SURFACE) {
      assert.equal(roleMeta({ s, h: CLASSES[s.label], key: null }), undefined, `${s.label} class must carry no @RequiredRoles`);
    }
  });

  await t.test('the deferred routes still authorize by role, and by no permission', () => {
    for (const r of DEFERRED) {
      assert.equal(declared(r), undefined, nameOf(r.s.label, r.h));
      assert.deepEqual(roleMeta(r), ['INSTITUTE_ADMIN', 'TEACHER'], nameOf(r.s.label, r.h));
    }
  });

  await t.test('every key used is catalogued, and no route declares OR widening or an explicit manage', () => {
    for (const r of MIGRATED) {
      const key = r.key!;
      assert.match(key, /^(questions|question-types|paper-patterns|question-papers)\.(read|create|update|delete)$/, nameOf(r.s.label, r.h));
    }
    // A `manage` grantee is satisfied through implication, never by declaration.
    assert.ok(!MIGRATED.some((r) => r.key!.endsWith('.manage')));
  });

  await t.test('the single student-readable route is exactly GET /question-types', () => {
    const studentReachable = MIGRATED.filter((r) => !AUTHORING.includes(r));
    assert.deepEqual(studentReachable.map((r) => nameOf(r.s.label, r.h)), ['QuestionTypesController.list']);
    assert.deepEqual(studentReachable.map((r) => r.key), ['question-types.read']);
  });

  // ── Built-in roles ──

  await t.test('built-in INSTITUTE_ADMIN passes every migrated route via R.manage', async () => {
    for (const r of MIGRATED) await chain(r, 'admin');
  });

  await t.test('built-in TEACHER passes every migrated route through the recorded defaults', async () => {
    // No behaviour change: TEACHER holds read/create/update/delete on questions,
    // paper-patterns and question-papers, plus question-types.read.
    for (const r of MIGRATED) await chain(r, 'teacher');
  });

  await t.test('STUDENT reads question types and is denied every authoring route', async () => {
    await chain({ s: SURFACE[1]!, h: PROTOS.QuestionTypesController.list, key: 'question-types.read' }, 'student');
    for (const r of AUTHORING) {
      await assert.rejects(chain(r, 'student'), ForbiddenException, `${nameOf(r.s.label, r.h)} must deny STUDENT`);
    }
  });

  await t.test('a zero-role membership default-denies every migrated route', async () => {
    for (const r of MIGRATED) await assert.rejects(chain(r, 'zeroRole'), ForbiddenException);
  });

  // ── Delegated custom institute roles ──

  const rolesSvc = new RolesService(db as unknown as Database);
  const assigner = new RoleAssignmentService(db as unknown as Database);
  const grantCustom = async (key: string, permissionKeys: string[]) =>
    (await rolesSvc.createRole(instA!.id, { key: `${key}_${suffix}`, name: key, description: undefined, permissionKeys })).id;
  const assignTo = async (who: Actor, roleId: string) => {
    const row = await db!.select().from(memberships).where(eq(memberships.userId, ACTORS[who].id)).limit(1);
    await assigner.assign(row[0]!.id, roleId);
  };

  await t.test('a read-only delegate reads — and nothing else (no create/update/delete, no sibling resource)', async () => {
    await assignTo('dRead', await grantCustom('f53_qro', ['questions.read']));
    for (const r of has('questions.read')) await chain(r, 'dRead');
    for (const r of MIGRATED.filter((x) => resource(x.key!) !== 'questions')) {
      await assert.rejects(chain(r, 'dRead'), ForbiddenException, nameOf(r.s.label, r.h));
    }
    for (const r of MIGRATED.filter((x) => resource(x.key!) === 'questions' && x.key !== 'questions.read')) {
      await assert.rejects(chain(r, 'dRead'), ForbiddenException, nameOf(r.s.label, r.h));
    }
  });

  await t.test('a create-only delegate creates — a read grant does not imply write, and write does not imply read', async () => {
    await assignTo('dCreate', await grantCustom('f53_qco', ['questions.create']));
    for (const r of has('questions.create')) await chain(r, 'dCreate');
    for (const r of MIGRATED.filter((x) => resource(x.key!) === 'questions' && x.key !== 'questions.create')) {
      await assert.rejects(chain(r, 'dCreate'), ForbiddenException, nameOf(r.s.label, r.h));
    }
  });

  await t.test('an update-only delegate updates — including cancel/retry, but not discard or archive', async () => {
    await assignTo('dUpdate', await grantCustom('f53_quo', ['questions.update']));
    for (const r of has('questions.update')) await chain(r, 'dUpdate');
    // The batch cancel/retry + import/accept/answer routes are `update`, so they pass.
    for (const n of ['cancelBankBatch', 'retryFailedBankBatch', 'acceptCandidate', 'importAll', 'generateAnswer']) {
      assert.ok(has('questions.update').some((r) => nameOf(r.s.label, r.h).endsWith(`.${n}`)), `${n} must be questions.update`);
    }
    for (const r of MIGRATED.filter((x) => resource(x.key!) === 'questions' && x.key !== 'questions.update')) {
      await assert.rejects(chain(r, 'dUpdate'), ForbiddenException, nameOf(r.s.label, r.h));
    }
  });

  await t.test('a delete-only delegate deletes/archives only', async () => {
    await assignTo('dDelete', await grantCustom('f53_qdo', ['questions.delete']));
    for (const r of has('questions.delete')) await chain(r, 'dDelete');
    for (const n of ['delete', 'archive', 'discardCandidate', 'discardAll']) {
      assert.ok(has('questions.delete').some((r) => nameOf(r.s.label, r.h).endsWith(`.${n}`)), `${n} must be questions.delete`);
    }
    for (const r of MIGRATED.filter((x) => resource(x.key!) === 'questions' && x.key !== 'questions.delete')) {
      await assert.rejects(chain(r, 'dDelete'), ForbiddenException, nameOf(r.s.label, r.h));
    }
  });

  await t.test('a paper-patterns.create grant stays inside paper-patterns, and question-papers.update inside question-papers', async () => {
    await assignTo('dPattern', await grantCustom('f53_pp', ['paper-patterns.create']));
    for (const r of has('paper-patterns.create')) await chain(r, 'dPattern');
    for (const r of MIGRATED.filter((x) => resource(x.key!) !== 'paper-patterns')) {
      await assert.rejects(chain(r, 'dPattern'), ForbiddenException, nameOf(r.s.label, r.h));
    }

    await assignTo('dPaper', await grantCustom('f53_qp', ['question-papers.update']));
    for (const r of has('question-papers.update')) await chain(r, 'dPaper');
    for (const r of MIGRATED.filter((x) => resource(x.key!) !== 'question-papers')) {
      await assert.rejects(chain(r, 'dPaper'), ForbiddenException, nameOf(r.s.label, r.h));
    }
  });

  await t.test('questions.manage implies every questions action — and nothing else', async () => {
    await assignTo('dManage', await grantCustom('f53_qma', ['questions.manage']));
    for (const r of MIGRATED.filter((x) => resource(x.key!) === 'questions')) await chain(r, 'dManage');
    for (const r of MIGRATED.filter((x) => resource(x.key!) !== 'questions')) {
      await assert.rejects(chain(r, 'dManage'), ForbiddenException, nameOf(r.s.label, r.h));
    }
  });

  // ── Institute isolation is not replaced by the permission layer ──

  await t.test('cross-institute: an A-owned role never grants access through a B membership', async () => {
    const roleId = await grantCustom('f53_x', ['questions.manage', 'paper-patterns.manage', 'question-papers.manage']);
    const membershipB = await db!.select().from(memberships).where(eq(memberships.userId, crossDelegate!.id)).limit(1);
    await assert.rejects(assigner.assign(membershipB[0]!.id, roleId), BadRequestException);
    // The B delegate holds no A membership → no grant context in A at all.
    for (const r of AUTHORING) await assert.rejects(chain(r, 'cross'), ForbiddenException);
  });

  // ── Service-level scope + ownership is preserved behind the guard ──

  await t.test('a permission never replaces institute scoping, subject scope or staging ownership (O1/O2)', async () => {
    const svc = db as unknown as Database;
    const scope = new AcademicScopeService(svc);
    const controller = new QuestionsController(
      new QuestionsService(svc, new QuestionTypesService(svc), scope),
      {} as never,
    );
    // A `questions.read` delegate passes the guard chain (Permissions resolved
    // DB-fresh), so everything below is the service's own enforcement talking.
    const manageTenant = await tenantOf({ s: SURFACE[0]!, h: PROTOS.QuestionsController.get, key: 'questions.read' }, 'dManage');
    assert.equal(manageTenant.instituteId, instA!.id);

    // (a) institute scoping: another institute's question is NotFound.
    await assert.rejects(
      PROTOS.QuestionsController.get.call(controller, manageTenant, asUser(dManage), foreignQuestion!.id),
      NotFoundException,
      'another institute question must not resolve',
    );
    // …while the caller legitimately owns the institute-A one.
    const own = await PROTOS.QuestionsController.get.call(controller, manageTenant, asUser(dManage), approvedInS1!.id);
    assert.equal(own.question.id, approvedInS1!.id);

    // (b) subject scoping + (c) O1 staging ownership, via teacher1 whose academic
    // reach is exactly s1. SQL-level filter on the list (§18.4).
    const t1 = await db!.select().from(memberships).where(eq(memberships.userId, teacher1!.id)).limit(1);
    const t1Tenant: TenantContext = { instituteId: instA!.id, membershipId: t1[0]!.id, roles: ['TEACHER'] } as TenantContext;
    const listed = await PROTOS.QuestionsController.list.call(
      controller, t1Tenant, asUser(teacher1), undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    );
    const visible = new Set(listed.questions.map((q) => q.id));
    assert.ok(visible.has(approvedInS1!.id), 'an in-scope s1 question is visible');
    assert.ok(!visible.has(approvedInS2!.id), 's2 is outside teacher1 reach and must never be listed');
    assert.ok(visible.has(stagedByT1!.id), 'an owner sees their own PENDING staging row');

    // Out-of-scope detail read is NotFound, never Forbidden (no existence leak).
    await assert.rejects(
      PROTOS.QuestionsController.get.call(controller, t1Tenant, asUser(teacher1), approvedInS2!.id),
      NotFoundException,
    );
    // Another actor's PENDING row inside teacher1's own subject is also NotFound (O1).
    const [t2Staged] = await db!.insert(questions).values({
      instituteId: instA!.id, subjectId: s1!.id, chapterId: ch1!.id, topicId: null,
      stem: 'x', questionType: 'MCQ', difficulty: 'MEDIUM', status: 'DRAFT', approvalStatus: 'PENDING',
      payload: { stem: 'x', options: ['a', 'b'], correctAnswer: 'a' },
      createdBy: teacher2!.id, updatedBy: teacher2!.id,
    } as never).returning();
    await assert.rejects(
      PROTOS.QuestionsController.get.call(controller, t1Tenant, asUser(teacher1), t2Staged!.id),
      NotFoundException,
      "another teacher's staged row must stay hidden",
    );
    await db!.delete(questions).where(eq(questions.id, t2Staged!.id));
  });

  await t.test('the question-type catalogue is still institute-scoped behind question-types.read', async () => {
    const types = new QuestionTypesService(db as unknown as Database);
    assert.ok((await types.list(instA!.id)).some((tp) => tp.id === typeA!.id));
    const [typeB] = await db!
      .insert(questionTypes)
      .values({ instituteId: instB!.id, name: `TypeB ${suffix}`, code: `QTB-${suffix}`, answerFormat: 'MCQ', kind: 'OBJECTIVE' })
      .returning();
    assert.ok(!(await types.list(instA!.id)).some((tp) => tp.id === typeB!.id), 'a foreign custom type must not leak');
    await db!.delete(questionTypes).where(eq(questionTypes.id, typeB!.id));
  });

  // ── Negative probe: the migration's guards are load-bearing ──

  await t.test('NEGATIVE PROBE: deleting a RequiredPermission decorator reopens the route', async () => {
    const row = MIGRATED.find((r) => r.s.label === 'QuestionsController' && r.h === PROTOS.QuestionsController.update)!;
    const target = PROTOS.QuestionsController.update as object;
    const saved = Reflect.getMetadata(PERMISSIONS_KEY, target);
    assert.equal(declared(row), 'questions.update', 'baseline: the decorator is present');

    try {
      Reflect.deleteMetadata(PERMISSIONS_KEY, target);
      assert.ok(!declared(row), 'probe: the decorator really is gone');
      // With no declared permission PermissionGuard is a no-op, so the route stops
      // being gated at all — a membership with zero roles walks straight through.
      // This is the bug the migration exists to prevent, so the probe must see it;
      // if it ever throws instead, the guard is no longer metadata-driven and the
      // whole matrix above is vacuous.
      await chain(row, 'zeroRole');
    } finally {
      Reflect.defineMetadata(PERMISSIONS_KEY, saved, target);
    }

    assert.equal(declared(row), 'questions.update', 'probe: the decorator is restored');
    await assert.rejects(chain(row, 'zeroRole'), ForbiddenException, 'restored route is guarded again');
  });

  // ── The deferred routes are behaviourally unchanged ──

  await t.test('INSTITUTE_ADMIN and TEACHER still reach the deferred routes by role', async () => {
    for (const who of ['admin', 'teacher'] as const) {
      for (const r of DEFERRED) await chain(r, who);
    }
    await assert.rejects(chain(DEFERRED[0]!, 'student'), ForbiddenException);
    await assert.rejects(chain(DEFERRED[0]!, 'dManage'), ForbiddenException);
  });
});
