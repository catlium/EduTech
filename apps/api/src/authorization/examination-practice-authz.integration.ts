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
  BadRequestException,
} from '@nestjs/common';

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
  divisions,
  teacherAssignments,
  studentPlacements,
  academicYears,
  questions,
  questionTypes,
  questionPapers,
  questionPaperQuestions,
  paperPatterns,
  paperPatternSubjects,
  assessments,
  assessmentQuestions,
  attempts,
  attemptQuestions,
  practiceSessions,
  practiceSessionItems,
} from '@catlium/database';
import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { PermissionGuard } from './permissions.guard.ts';
import { PERMISSIONS_KEY } from './permissions.decorator.ts';
import { ROLES_KEY } from '../common/decorators/roles.decorator.ts';
import type { TenantContext } from '../common/decorators/tenant.decorator.ts';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { PermissionCheckService } from './permission-check.service.ts';
import { PermissionSyncService } from './permission-sync.service.ts';
import { RolesService } from './roles.service.ts';
import { RoleAssignmentService } from './role-assignment.service.ts';
import { AcademicScopeService } from './academic-scope.service.ts';
import { ExaminationsService } from '../examinations/examinations.service.ts';
import { AttemptsService } from '../attempts/attempts.service.ts';
import { PracticeService } from '../practice/practice.service.ts';
import { PaperPatternsService } from '../paper-patterns/paper-patterns.service.ts';
import { QuestionPapersService } from '../question-papers/question-papers.service.ts';
import { QuestionTypesController } from '../questions/question-types.controller.ts';
import { QuestionTypesService } from '../questions/question-types.service.ts';
import { PaperPatternsController } from '../paper-patterns/paper-patterns.controller.ts';
import { QuestionPapersController } from '../question-papers/question-papers.controller.ts';
import { ExaminationsController } from '../examinations/examinations.controller.ts';
import { AttemptsController } from '../attempts/attempts.controller.ts';
import { PracticeController } from '../practice/practice.controller.ts';

// Phase F5.4 — Examination + Attempt + Practice guard matrix (§13 `assessments`
// / `attempts` / `practice` / `question-types.create`) plus the two `assessment`
// bridges F5.3 deferred. Runs the REAL guard chain against the REAL controller
// handlers (their metadata) for all 32 audited routes:
//   - INSTITUTE_ADMIN passes every migrated route via the built-in R.manage grant;
//     TEACHER passes through the recorded defaults, including the two defaults
//     F5.4 added (question-types.create, practice.create/update) and the ones it
//     deliberately did not (attempts.create/update)
//   - one single-action delegate per action obeys exactly its sub-action, per
//     resource, with no OR widening, no explicit `manage`, no sibling leakage,
//     and no cross-resource leak into the `assessment` bridges
//   - STUDENT reaches its learning surface (attempts + practice + assessments.read
//     + question-types.read) and is denied every authoring/teaching route
//   - the attempt LEDGER + analytics stay intentionally role-gated (documented)
//   - a permission never substitutes for the service's institute / academic-scope
//     / ownership / assessment-resolution checks (MOD-4 + D6/O1/O2), and the
//     `coverage.covered` bank gate on the pattern bridge still runs
// Requires a live database: TEST_DATABASE_URL (see .env). Skips cleanly when
// unset. Permission/role seeds come from PermissionSyncService (idempotent).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({
  secret: 'examination-practice-authz-secret',
  signOptions: { algorithm: 'HS256' },
});
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

// ── The audited surface: 32 routes on six controllers ─────────────────
const PROTOS = {
  ExaminationsController: ExaminationsController.prototype,
  AttemptsController: AttemptsController.prototype,
  PracticeController: PracticeController.prototype,
  QuestionTypesController: QuestionTypesController.prototype,
  PaperPatternsController: PaperPatternsController.prototype,
  QuestionPapersController: QuestionPapersController.prototype,
} as const;
const CLASSES = {
  ExaminationsController,
  AttemptsController,
  PracticeController,
  QuestionTypesController,
  PaperPatternsController,
  QuestionPapersController,
} as const;
type SurfaceLabel = keyof typeof PROTOS;

interface Surface {
  readonly label: SurfaceLabel;
  /** [handler, declared key, or null when deliberately still role-gated] */
  readonly routes: readonly (readonly [string, string | null])[];
}

const SURFACE: readonly Surface[] = [
  {
    label: 'ExaminationsController',
    routes: [
      ['create', 'assessments.create'],
      ['list', 'assessments.read'],
      ['get', 'assessments.read'],
      ['update', 'assessments.update'],
      ['delete', 'assessments.delete'],
      ['setScope', 'assessments.update'],
      ['publish', 'assessments.update'],
      ['activate', 'assessments.update'],
      ['complete', 'assessments.update'],
      ['unpublish', 'assessments.update'],
      ['listQuestions', 'assessments.read'],
      ['addQuestions', 'assessments.update'],
      ['patternCoverage', 'assessments.read'],
      ['selectFromPattern', 'assessments.update'],
      // remove-one-link = remove from the active surface → `delete` (§13)
      ['removeQuestion', 'assessments.delete'],
    ],
  },
  {
    label: 'AttemptsController',
    routes: [
      ['listAvailable', 'attempts.read'],
      ['history', 'attempts.read'],
      ['start', 'attempts.create'],
      ['get', 'attempts.read'],
      ['save', 'attempts.update'],
      ['submit', 'attempts.update'],
      ['result', 'attempts.read'],
      // INTENTIONALLY ROLE-GATED — the ledger exposes OTHER students' attempts and
      // `attempts.read` (held by STUDENT too) cannot express that distinction.
      ['listForAssessment', null],
      ['analytics', null],
    ],
  },
  {
    label: 'PracticeController',
    routes: [
      ['start', 'practice.create'],
      ['history', 'practice.read'],
      ['get', 'practice.read'],
      ['save', 'practice.update'],
      ['complete', 'practice.update'],
    ],
  },
  {
    label: 'QuestionTypesController',
    routes: [
      ['list', 'question-types.read'],
      // F5.4 resolved the F5.3 catalogue gap: `create` is now catalogued.
      ['create', 'question-types.create'],
    ],
  },
  {
    label: 'PaperPatternsController',
    // F5.4: creates an `assessments` row → `assessments.create`, the same key
    // `POST /assessments` requires (never `paper-patterns.create`).
    routes: [['createAssessment', 'assessments.create']],
  },
  {
    label: 'QuestionPapersController',
    routes: [['createAssessment', 'assessments.create']],
  },
];

const handler = (label: SurfaceLabel, name: string) => PROTOS[label][name as never] as unknown;
const nameOf = (label: SurfaceLabel, h: unknown) =>
  `${label}.${Object.getOwnPropertyNames(PROTOS[label]).find((n) => PROTOS[label][n as never] === h) ?? 'unknown'}`;
/** Flat [surface, handler, key] rows; `key === null` marks an intentionally role-gated route. */
const ROWS = SURFACE.flatMap((s) =>
  s.routes.map(([name, key]) => ({ s, h: handler(s.label, name), key })),
);
const MIGRATED = ROWS.filter((r) => r.key !== null);
const ROLE_GATED = ROWS.filter((r) => r.key === null);
const has = (key: string) => MIGRATED.filter((r) => r.key === key);
const resource = (key: string) => key.split('.')[0]!;
const BRIDGES = MIGRATED.filter(
  (r) => r.key === 'assessments.create' && r.s.label !== 'ExaminationsController',
);
/** Everything a STUDENT must be denied: the whole authoring + teaching surface. */
const STUDENT_DENIED = MIGRATED.filter(
  (r) =>
    !/^(attempts\.(read|create|update)|practice\.(read|create|update)|assessments\.read|question-types\.read)$/.test(
      r.key!,
    ),
);

function reqContext(
  r: (typeof ROWS)[number],
  request: { headers: Record<string, string>; cookies: Record<string, string> },
) {
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
const permGuard = () =>
  new PermissionGuard(new Reflector(), new PermissionCheckService(db as unknown as Database));

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
async function runChain(
  r: (typeof ROWS)[number],
  request: { headers: Record<string, string>; cookies: Record<string, string> },
) {
  const ctx = reqContext(r, request);
  await accessGuard().canActivate(ctx);
  await tenantGuard().canActivate(ctx);
  new RolesGuard(reflector()).canActivate(ctx);
  await permGuard().canActivate(ctx);
  return ctx;
}

test(
  'F5.4 examination + attempt + practice guard matrix',
  { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' },
  async (t) => {
    const svc = db as unknown as Database;
    await new PermissionSyncService(svc).sync();
    const roleRows = await db!
      .select()
      .from(roles)
      .where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']));
    const roleIds = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));

    const suffix = randomUUID().slice(0, 8);
    const [instA] = await db!
      .insert(institutes)
      .values({ name: `EP A ${suffix}`, slug: `ep-a-${suffix}` })
      .returning();
    const [instB] = await db!
      .insert(institutes)
      .values({ name: `EP B ${suffix}`, slug: `ep-b-${suffix}` })
      .returning();

    const makeUser = async (label: string) => {
      const [u] = await db!
        .insert(users)
        .values({ email: `${label}-${suffix}@example.test`, name: label, passwordHash: 'x' })
        .returning();
      return u!;
    };
    const grantMembership = async (instituteId: string, userId: string, roleKeys: string[]) => {
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
          refreshTokenHash: `f54-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning();
      return row!.id;
    };

    // Institute A fixtures. s1 + its offering is `teacher1`'s academic reach, s2 +
    // its offering is `teacher2`'s; neither reaches the other's subject. `student`
    // is PLACED in s1's class, which is what makes the attempt-ledger leak real
    // (a placed student resolves a subject-set scope, not whole-institute).
    const [s1] = await db!
      .insert(subjects)
      .values({ instituteId: instA!.id, name: `S1 ${suffix}`, slug: `ep-s1-${suffix}` })
      .returning();
    const [s2] = await db!
      .insert(subjects)
      .values({ instituteId: instA!.id, name: `S2 ${suffix}`, slug: `ep-s2-${suffix}` })
      .returning();
    const [sB] = await db!
      .insert(subjects)
      .values({ instituteId: instB!.id, name: `SB ${suffix}`, slug: `ep-sb-${suffix}` })
      .returning();
    const [ch1] = await db!
      .insert(chapters)
      .values({ subjectId: s1!.id, name: `Ch1 ${suffix}`, slug: `ep-ch1-${suffix}` })
      .returning();
    const [chB] = await db!
      .insert(chapters)
      .values({ subjectId: sB!.id, name: `ChB ${suffix}`, slug: `ep-chb-${suffix}` })
      .returning();
    const [yearA] = await db!
      .insert(academicYears)
      .values({ instituteId: instA!.id, name: `Year ${suffix}` })
      .returning();
    const [cls1] = await db!
      .insert(classes)
      .values({ instituteId: instA!.id, name: `Class 1 ${suffix}` })
      .returning();
    const [cls2] = await db!
      .insert(classes)
      .values({ instituteId: instA!.id, name: `Class 2 ${suffix}` })
      .returning();
    const [off1] = await db!
      .insert(classSubjects)
      .values({ classId: cls1!.id, subjectId: s1!.id })
      .returning();
    const [off2] = await db!
      .insert(classSubjects)
      .values({ classId: cls2!.id, subjectId: s2!.id })
      .returning();

    const admin = await makeUser('ep_admin');
    const teacher1 = await makeUser('ep_teacher1');
    const teacher2 = await makeUser('ep_teacher2');
    const student = await makeUser('ep_student');
    const zeroRole = await makeUser('ep_zerorole');
    const dAsmRead = await makeUser('ep_d_asmread');
    const dAsmCreate = await makeUser('ep_d_asmcreate');
    const dAsmUpdate = await makeUser('ep_d_asmupdate');
    const dAsmDelete = await makeUser('ep_d_asmdelete');
    const dAsmManage = await makeUser('ep_d_asmmanage');
    const dPatternCreate = await makeUser('ep_d_patcreate');
    const dPaperCreate = await makeUser('ep_d_papcreate');
    const dAttemptRead = await makeUser('ep_d_attread');
    const dAttemptCreate = await makeUser('ep_d_attcreate');
    const dPracticeUpdate = await makeUser('ep_d_pracupd');
    const dTypeCreate = await makeUser('ep_d_typecreate');
    const crossDelegate = await makeUser('ep_d_cross');

    const adminMem = await grantMembership(instA!.id, admin!.id, ['INSTITUTE_ADMIN']);
    const t1Mem = await grantMembership(instA!.id, teacher1!.id, ['TEACHER']);
    const t2Mem = await grantMembership(instA!.id, teacher2!.id, ['TEACHER']);
    const studentMem = await grantMembership(instA!.id, student!.id, ['STUDENT']);
    await grantMembership(instA!.id, zeroRole!.id, []);
    // Delegates hold NO built-in role: the custom role below is their only grant, so
    // a "read-only delegate" really is read-only.
    const delegateUsers = [
      dAsmRead,
      dAsmCreate,
      dAsmUpdate,
      dAsmDelete,
      dAsmManage,
      dPatternCreate,
      dPaperCreate,
      dAttemptRead,
      dAttemptCreate,
      dPracticeUpdate,
      dTypeCreate,
    ];
    for (const u of delegateUsers) await grantMembership(instA!.id, u!.id, []);
    await grantMembership(instB!.id, crossDelegate!.id, ['INSTITUTE_ADMIN']);

    await db!
      .insert(teacherAssignments)
      .values({ instituteId: instA!.id, classSubjectId: off1!.id, membershipId: t1Mem.id });
    await db!
      .insert(teacherAssignments)
      .values({ instituteId: instA!.id, classSubjectId: off2!.id, membershipId: t2Mem.id });
    // dAsmManage needs its own class assignment or its academic scope would be empty.
    const dAsmManageMem = (
      await db!.select().from(memberships).where(eq(memberships.userId, dAsmManage!.id)).limit(1)
    )[0]!;
    await db!
      .insert(teacherAssignments)
      .values({ instituteId: instA!.id, classSubjectId: off1!.id, membershipId: dAsmManageMem.id });
    // The student is placed in class 1's division → their academic scope is exactly s1.
    // This is what makes the attempt-ledger leak real: a placed student resolves a
    // subject-set scope covering s1, so the MOD-4 `getAssessment` gate would pass.
    const [div1] = await db!
      .insert(divisions)
      .values({
        instituteId: instA!.id,
        academicYearId: yearA!.id,
        classId: cls1!.id,
        name: `Div ${suffix}`,
      })
      .returning();
    await db!
      .insert(studentPlacements)
      .values({
        instituteId: instA!.id,
        membershipId: studentMem.id,
        academicYearId: yearA!.id,
        divisionId: div1!.id,
      });

    const mkQuestion = async (
      instituteId: string,
      subjectId: string,
      chapterId: string,
      createdBy: string,
    ) => {
      const [row] = await db!
        .insert(questions)
        .values({
          instituteId,
          subjectId,
          chapterId,
          topicId: null,
          stem: `Q ${suffix}`,
          questionType: 'MCQ',
          difficulty: 'MEDIUM',
          status: 'ACTIVE',
          approvalStatus: 'APPROVED',
          payload: { stem: `Q ${suffix}`, options: ['a', 'b'], correctAnswer: 'a' },
          createdBy,
          updatedBy: createdBy,
        } as never)
        .returning();
      return row!;
    };
    const questionS1 = await mkQuestion(instA!.id, s1!.id, ch1!.id, admin!.id);
    const questionB = await mkQuestion(instB!.id, sB!.id, chB!.id, admin!.id);

    const mkAssessment = async (
      instituteId: string,
      subjectId: string,
      status: string,
      createdBy: string,
    ) => {
      const [a] = await db!
        .insert(assessments)
        .values({
          instituteId,
          subjectId,
          title: `A ${suffix}`,
          status,
          createdBy,
          updatedBy: createdBy,
        })
        .returning();
      return a!;
    };
    // A PUBLISHED/attemptable s1 assessment (in teacher1's AND the student's scope),
    // a finalized s2 one (outside both), a DRAFT one owned by teacher2 but in s1
    // (O1 staging ownership), and a foreign-institute one.
    const assessmentS1 = await mkAssessment(instA!.id, s1!.id, 'PUBLISHED', teacher1!.id);
    const assessmentS2 = await mkAssessment(instA!.id, s2!.id, 'PUBLISHED', teacher2!.id);
    const assessmentDraft = await mkAssessment(instA!.id, s1!.id, 'DRAFT', teacher2!.id);
    const assessmentB = await mkAssessment(instB!.id, sB!.id, 'PUBLISHED', admin!.id);
    for (const a of [assessmentS1, assessmentS2, assessmentDraft, assessmentB]) {
      await db!
        .insert(assessmentQuestions)
        .values({
          assessmentId: a.id,
          questionId: a.id === assessmentB!.id ? questionB!.id : questionS1!.id,
          sortOrder: 1,
          marks: 5,
        });
    }
    // A submitted attempt so the ledger + analytics are non-empty.
    const [attemptS1] = await db!
      .insert(attempts)
      .values({
        instituteId: instA!.id,
        assessmentId: assessmentS1!.id,
        studentId: student!.id,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        score: 5,
        totalMarks: 10,
      })
      .returning();
    const [practiceOwn] = await db!
      .insert(practiceSessions)
      .values({
        instituteId: instA!.id,
        studentId: student!.id,
        mode: 'QUESTION',
        status: 'IN_PROGRESS',
      })
      .returning();

    // The two assessment bridges' source rows: an APPROVED, valid s1 pattern and an
    // s1-scoped paper with one question, so a permitted caller really can convert.
    const PATTERN_STRUCTURE = {
      totalMarks: 5,
      durationMinutes: 30,
      instructions: ['Answer all'],
      sections: [
        {
          id: randomUUID(),
          name: 'Section A',
          questionTypes: [
            { id: randomUUID(), questionType: 'MCQ', count: 1, marksPerQuestion: 5, totalMarks: 5 },
          ],
        },
      ],
    };
    const [patternS1] = await db!
      .insert(paperPatterns)
      .values({
        instituteId: instA!.id,
        title: `Pattern ${suffix}`,
        status: 'APPROVED',
        isLocked: true,
        structure: PATTERN_STRUCTURE,
        createdBy: teacher1!.id,
        updatedBy: teacher1!.id,
      })
      .returning();
    await db!.insert(paperPatternSubjects).values({ patternId: patternS1!.id, subjectId: s1!.id });
    const [paperS1] = await db!
      .insert(questionPapers)
      .values({
        instituteId: instA!.id,
        title: `Paper ${suffix}`,
        subjectId: s1!.id,
        chapterId: ch1!.id,
        blueprintId: patternS1!.id,
        createdBy: teacher1!.id,
        updatedBy: teacher1!.id,
      })
      .returning();
    await db!
      .insert(questionPaperQuestions)
      .values({
        paperId: paperS1!.id,
        questionId: questionS1!.id,
        sortOrder: 1,
        marks: 5,
        section: 'A',
      });
    await db!
      .insert(questionTypes)
      .values({
        instituteId: instA!.id,
        name: `Type ${suffix}`,
        code: `QT-${suffix}`,
        answerFormat: 'MCQ',
        kind: 'OBJECTIVE',
      });

    const ACTORS = {
      admin: admin!,
      teacher: teacher1!,
      teacher2: teacher2!,
      student: student!,
      zeroRole: zeroRole!,
      dAsmRead,
      dAsmCreate,
      dAsmUpdate,
      dAsmDelete,
      dAsmManage,
      dPatternCreate,
      dPaperCreate,
      dAttemptRead,
      dAttemptCreate,
      dPracticeUpdate,
      dTypeCreate,
      cross: crossDelegate!,
    } as const;
    type Actor = keyof typeof ACTORS;
    const session: Partial<Record<Actor, string>> = {};
    const token: Partial<Record<Actor, string>> = {};
    for (const [name, u] of Object.entries(ACTORS) as [Actor, { id: string }][]) {
      session[name] = await liveSession(u.id);
      token[name] = await sign(u.id, session[name]!);
    }

    t.after(async () => {
      if (!db) return;
      const emails = Object.values(ACTORS).map((u) => u.email);
      const userIds = (
        await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))
      ).map((r) => r.id!);
      const membershipIds = userIds.length
        ? (
            await db
              .select({ id: memberships.id })
              .from(memberships)
              .where(inArray(memberships.userId, userIds))
          ).map((r) => r.id!)
        : [];
      const instIds = [instA!.id, instB!.id];
      // Content first (its created_by rows reference users), then tenancy, then the
      // structural rows the scope fixtures hang off.
      await db.delete(attemptQuestions).where(inArray(attemptQuestions.attemptId, [attemptS1!.id]));
      await db.delete(attempts).where(inArray(attempts.instituteId, instIds));
      await db
        .delete(practiceSessionItems)
        .where(inArray(practiceSessionItems.sessionId, [practiceOwn!.id]));
      await db.delete(practiceSessions).where(inArray(practiceSessions.instituteId, instIds));
      await db
        .delete(assessmentQuestions)
        .where(
          inArray(assessmentQuestions.assessmentId, [
            assessmentS1!.id,
            assessmentS2!.id,
            assessmentDraft!.id,
            assessmentB!.id,
          ]),
        );
      await db.delete(assessments).where(inArray(assessments.instituteId, instIds));
      await db
        .delete(questionPaperQuestions)
        .where(inArray(questionPaperQuestions.paperId, [paperS1!.id]));
      await db.delete(questionPapers).where(inArray(questionPapers.instituteId, instIds));
      await db
        .delete(paperPatternSubjects)
        .where(inArray(paperPatternSubjects.patternId, [patternS1!.id]));
      await db.delete(paperPatterns).where(inArray(paperPatterns.instituteId, instIds));
      await db.delete(questions).where(inArray(questions.instituteId, instIds));
      await db.delete(questionTypes).where(inArray(questionTypes.instituteId, instIds));
      if (membershipIds.length) {
        await db
          .delete(membershipRoles)
          .where(inArray(membershipRoles.membershipId, membershipIds));
        await db
          .delete(teacherAssignments)
          .where(inArray(teacherAssignments.membershipId, membershipIds));
        await db.delete(studentPlacements).where(inArray(studentPlacements.instituteId, instIds));
      }
      if (userIds.length) {
        await db.delete(memberships).where(inArray(memberships.userId, userIds));
        await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
        await db.delete(users).where(inArray(users.email, emails));
      }
      await db.delete(divisions).where(inArray(divisions.id, [div1!.id]));
      await db.delete(classSubjects).where(inArray(classSubjects.id, [off1!.id, off2!.id]));
      await db.delete(chapters).where(inArray(chapters.id, [ch1!.id, chB!.id]));
      await db.delete(subjects).where(inArray(subjects.id, [s1!.id, s2!.id, sB!.id]));
      await db.delete(classes).where(inArray(classes.id, [cls1!.id, cls2!.id]));
      await db.delete(academicYears).where(eq(academicYears.id, yearA!.id));
      // Custom institute roles + their permission rows cascade with the institute.
      await db
        .delete(institutes)
        .where(inArray(institutes.slug, [`ep-a-${suffix}`, `ep-b-${suffix}`]));
      (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
    });

    const asUser = (u: { id: string }): AuthenticatedUser => ({ userId: u.id });
    const req = (who: Actor, instituteId = instA!.id) => ({
      headers: { 'x-institute-id': instituteId },
      cookies: { access_token: token[who]! },
    });
    const chain = (r: (typeof ROWS)[number], who: Actor, instituteId = instA!.id) =>
      runChain(r, req(who, instituteId));
    const tenantOf = async (r: (typeof ROWS)[number], who: Actor) =>
      (await chain(r, who)).switchToHttp().getRequest()['tenant'] as TenantContext;

    const rolesSvc = new RolesService(svc);
    const assigner = new RoleAssignmentService(svc);
    const grantCustom = async (key: string, permissionKeys: string[]) =>
      (
        await rolesSvc.createRole(instA!.id, {
          key: `${key}_${suffix}`,
          name: key,
          description: undefined,
          permissionKeys,
        })
      ).id;
    const assignTo = async (who: Actor, roleId: string) => {
      const row = await db!
        .select()
        .from(memberships)
        .where(eq(memberships.userId, ACTORS[who].id))
        .limit(1);
      await assigner.assign(row[0]!.id, roleId);
    };

    // ── Metadata: the migration happened, and left exactly the intended residue ──

    await t.test(
      'all 33 asserted routes are accounted for: 31 migrated, 2 intentionally role-gated',
      () => {
        // 32 routes are F5.4's own surface (15 examinations + 9 attempts + 5 practice
        // + the 3 F5.3 deferred); the 33rd is `GET /question-types`, already migrated
        // by F5.3 and re-asserted here only to prove the new `question-types.create`
        // grant stays isolated from it.
        assert.equal(ROWS.length, 33);
        assert.equal(MIGRATED.length, 31);
        assert.equal(ROLE_GATED.length, 2);
        assert.deepEqual(
          ROLE_GATED.map((r) => nameOf(r.s.label, r.h)).sort(),
          ['AttemptsController.analytics', 'AttemptsController.listForAssessment'],
          'the role-gated set is exactly the attempt ledger + analytics',
        );
      },
    );

    await t.test(
      'every migrated handler declares exactly one catalogue permission and no role metadata',
      () => {
        for (const r of MIGRATED) {
          assert.equal(declared(r), r.key, nameOf(r.s.label, r.h));
          assert.equal(
            roleMeta(r),
            undefined,
            `${nameOf(r.s.label, r.h)} must carry no @RequiredRoles`,
          );
        }
        for (const s of SURFACE) {
          assert.equal(
            roleMeta({ s, h: CLASSES[s.label], key: null }),
            undefined,
            `${s.label} class must carry no @RequiredRoles`,
          );
        }
      },
    );

    await t.test('the two role-gated routes authorize by role and by no permission', () => {
      for (const r of ROLE_GATED) {
        assert.equal(declared(r), undefined, nameOf(r.s.label, r.h));
        assert.deepEqual(roleMeta(r), ['INSTITUTE_ADMIN', 'TEACHER'], nameOf(r.s.label, r.h));
      }
    });

    await t.test(
      'every key used is catalogued, and no route declares OR widening or an explicit manage',
      () => {
        for (const r of MIGRATED) {
          const key = r.key!;
          assert.match(
            key,
            /^(assessments|attempts|practice|question-types)\.(read|create|update|delete)$/,
            nameOf(r.s.label, r.h),
          );
        }
        assert.ok(
          !MIGRATED.some((r) => r.key!.endsWith('.manage')),
          'a manage grantee is satisfied by implication, never by declaration',
        );
        // `assessments.delete` is reachable; the sibling `attempts`/`practice` delete
        // must remain uncatalogued (no such endpoint exists) so nobody can be granted it.
        for (const key of [
          'attempts.delete',
          'practice.delete',
          'question-types.update',
          'question-types.delete',
        ]) {
          assert.ok(!MIGRATED.some((r) => r.key === key), `${key} must not be declared`);
        }
      },
    );

    await t.test('both assessment bridges are protected, and both take assessments.create', () => {
      assert.equal(BRIDGES.length, 2);
      assert.deepEqual(BRIDGES.map((r) => nameOf(r.s.label, r.h)).sort(), [
        'PaperPatternsController.createAssessment',
        'QuestionPapersController.createAssessment',
      ]);
      for (const r of BRIDGES)
        assert.equal(declared(r), 'assessments.create', nameOf(r.s.label, r.h));
    });

    // ── Built-in roles ──

    await t.test('built-in INSTITUTE_ADMIN passes every migrated route via R.manage', async () => {
      for (const r of MIGRATED) await chain(r, 'admin');
    });

    await t.test(
      'built-in TEACHER passes every migrated route through the recorded defaults',
      async () => {
        // The two STUDENT-only attempt mutations are the recorded exception, asserted
        // separately below so this loop documents the rest of the surface.
        const studentOnly = MIGRATED.filter(
          (r) => r.key === 'attempts.create' || r.key === 'attempts.update',
        );
        assert.equal(
          studentOnly.length,
          3,
          'POST /attempts, save-answer and submit are the attempt mutations',
        );
        for (const r of MIGRATED.filter((x) => !studentOnly.includes(x))) await chain(r, 'teacher');
        // And still reaches the two role-gated ledger endpoints.
        for (const r of ROLE_GATED) await chain(r, 'teacher');
      },
    );

    await t.test(
      'TEACHER is denied the STUDENT-only attempt mutations (recorded defaults unchanged)',
      async () => {
        // TEACHER holds attempts.read only; the attempt lifecycle is STUDENT-only and
        // no teacher nav surface offers it. F5.4 did NOT widen TEACHER here.
        for (const r of MIGRATED.filter(
          (x) => x.key === 'attempts.create' || x.key === 'attempts.update',
        )) {
          await assert.rejects(chain(r, 'teacher'), ForbiddenException, nameOf(r.s.label, r.h));
        }
        // …while its practice capability is preserved by the F5.4 defaults.
        for (const r of MIGRATED.filter((x) => resource(x.key!) === 'practice'))
          await chain(r, 'teacher');
      },
    );

    await t.test(
      'STUDENT reaches its learning surface and is denied every authoring/teaching route',
      async () => {
        for (const r of MIGRATED.filter((x) => !STUDENT_DENIED.includes(x)))
          await chain(r, 'student');
        for (const r of STUDENT_DENIED) {
          await assert.rejects(
            chain(r, 'student'),
            ForbiddenException,
            `${nameOf(r.s.label, r.h)} must deny STUDENT`,
          );
        }
      },
    );

    await t.test('a zero-role membership default-denies every migrated route', async () => {
      for (const r of MIGRATED) await assert.rejects(chain(r, 'zeroRole'), ForbiddenException);
    });

    // ── The documented role-gated exception is load-bearing ──

    await t.test(
      'the attempt ledger + analytics stay teacher-only even though STUDENT holds attempts.read',
      async () => {
        // A placed student resolves a subject-set scope covering s1, so the MOD-4
        // `getAssessment` gate would let them READ assessmentS1 — RolesGuard is the
        // only thing stopping the cohort read. Prove the leak is real at the service
        // layer and that the guard closes it.
        const examsSvc = new ExaminationsService(svc, new AcademicScopeService(svc));
        const attemptsSvc = new AttemptsService(svc, examsSvc);
        assert.deepEqual(
          await new AcademicScopeService(svc).resolveScope(instA!.id, studentMem.id),
          {
            kind: 'subject-set',
            subjectIds: [s1!.id],
          },
        );
        const studentLedger = await attemptsSvc.listForAssessment(
          instA!.id,
          studentMem.id,
          student!.id,
          assessmentS1!.id,
        );
        assert.equal(
          studentLedger.attempts.length,
          1,
          'the service alone WOULD expose the cohort ledger to a placed student',
        );
        // The production chain refuses before the service is ever reached.
        for (const r of ROLE_GATED) {
          await assert.rejects(chain(r, 'student'), ForbiddenException, nameOf(r.s.label, r.h));
        }
        // TEACHER in scope gets it; STUDENT does not.
        for (const r of ROLE_GATED) {
          await chain(r, 'teacher');
          await assert.rejects(chain(r, 'zeroRole'), ForbiddenException, nameOf(r.s.label, r.h));
        }
      },
    );

    // ── Delegated custom institute roles ──

    await t.test(
      'one single-action delegate per assessments action obeys exactly that sub-action',
      async () => {
        const cases: [Actor, string, string][] = [
          ['dAsmRead', 'assessments.read', 'f54_asmread'],
          ['dAsmCreate', 'assessments.create', 'f54_asmcreate'],
          ['dAsmUpdate', 'assessments.update', 'f54_asmupdate'],
          ['dAsmDelete', 'assessments.delete', 'f54_asmdelete'],
        ];
        for (const [who, key, roleKey] of cases) {
          await assignTo(who, await grantCustom(roleKey, [key]));
          for (const r of has(key)) await chain(r, who);
          // read never implies create/update/delete, and neither sibling leaks.
          for (const r of MIGRATED.filter(
            (x) => resource(x.key!) === 'assessments' && x.key !== key,
          )) {
            await assert.rejects(
              chain(r, who),
              ForbiddenException,
              `${who} on ${nameOf(r.s.label, r.h)}`,
            );
          }
          // …nor any other resource in this surface.
          for (const r of MIGRATED.filter((x) => resource(x.key!) !== 'assessments')) {
            await assert.rejects(
              chain(r, who),
              ForbiddenException,
              `${who} on ${nameOf(r.s.label, r.h)}`,
            );
          }
        }
      },
    );

    await t.test(
      'assessments.manage implies every assessments action — and nothing else',
      async () => {
        await assignTo('dAsmManage', await grantCustom('f54_asmmanage', ['assessments.manage']));
        for (const r of MIGRATED.filter((x) => resource(x.key!) === 'assessments'))
          await chain(r, 'dAsmManage');
        for (const r of MIGRATED.filter((x) => resource(x.key!) !== 'assessments')) {
          await assert.rejects(chain(r, 'dAsmManage'), ForbiddenException, nameOf(r.s.label, r.h));
        }
      },
    );

    await t.test(
      'attempts: read / create / update delegates are independent and never leak',
      async () => {
        await assignTo('dAttemptRead', await grantCustom('f54_attread', ['attempts.read']));
        for (const r of has('attempts.read')) await chain(r, 'dAttemptRead');
        for (const r of MIGRATED.filter(
          (x) => resource(x.key!) === 'attempts' && x.key !== 'attempts.read',
        )) {
          await assert.rejects(
            chain(r, 'dAttemptRead'),
            ForbiddenException,
            nameOf(r.s.label, r.h),
          );
        }

        await assignTo('dAttemptCreate', await grantCustom('f54_attcreate', ['attempts.create']));
        for (const r of has('attempts.create')) await chain(r, 'dAttemptCreate');
        for (const r of MIGRATED.filter(
          (x) => resource(x.key!) === 'attempts' && x.key !== 'attempts.create',
        )) {
          await assert.rejects(
            chain(r, 'dAttemptCreate'),
            ForbiddenException,
            nameOf(r.s.label, r.h),
          );
        }
      },
    );

    await t.test(
      'practice: an update-only delegate cannot create a session, and a create-only one cannot answer',
      async () => {
        await assignTo('dPracticeUpdate', await grantCustom('f54_pracupd', ['practice.update']));
        for (const r of has('practice.update')) await chain(r, 'dPracticeUpdate');
        for (const r of MIGRATED.filter(
          (x) => resource(x.key!) === 'practice' && x.key !== 'practice.update',
        )) {
          await assert.rejects(
            chain(r, 'dPracticeUpdate'),
            ForbiddenException,
            nameOf(r.s.label, r.h),
          );
        }
      },
    );

    await t.test(
      'question-types: read never implies create, and create implies read via nothing',
      async () => {
        await assignTo(
          'dTypeCreate',
          await grantCustom('f54_typecreate', ['question-types.create']),
        );
        await chain(
          {
            s: SURFACE[3]!,
            h: PROTOS.QuestionTypesController.create,
            key: 'question-types.create',
          },
          'dTypeCreate',
        );
        // A create-only grant does not grant the list read: default-deny, no sibling implication.
        await assert.rejects(
          chain(
            { s: SURFACE[3]!, h: PROTOS.QuestionTypesController.list, key: 'question-types.read' },
            'dTypeCreate',
          ),
          ForbiddenException,
        );
      },
    );

    await t.test(
      'a paper-patterns.create or question-papers.create grant cannot mint an examination',
      async () => {
        await assignTo(
          'dPatternCreate',
          await grantCustom('f54_patcreate', ['paper-patterns.create']),
        );
        await assignTo(
          'dPaperCreate',
          await grantCustom('f54_papcreate', ['question-papers.create']),
        );
        for (const r of BRIDGES) {
          await assert.rejects(
            chain(r, 'dPatternCreate'),
            ForbiddenException,
            `pattern author on ${nameOf(r.s.label, r.h)}`,
          );
          await assert.rejects(
            chain(r, 'dPaperCreate'),
            ForbiddenException,
            `paper author on ${nameOf(r.s.label, r.h)}`,
          );
        }
        // …while the assessment author can.
        for (const r of BRIDGES) await chain(r, 'dAsmCreate');
      },
    );

    // ── Institute isolation is not replaced by the permission layer ──

    await t.test(
      'cross-institute: an A-owned role never grants access through a B membership',
      async () => {
        const roleId = await grantCustom('f54_x', [
          'assessments.manage',
          'attempts.manage',
          'practice.manage',
          'question-types.manage',
        ]);
        const membershipB = await db!
          .select()
          .from(memberships)
          .where(eq(memberships.userId, crossDelegate!.id))
          .limit(1);
        await assert.rejects(assigner.assign(membershipB[0]!.id, roleId), BadRequestException);
        for (const r of MIGRATED)
          await assert.rejects(chain(r, 'cross'), ForbiddenException, nameOf(r.s.label, r.h));
      },
    );

    // ── Service-level scope + ownership is preserved behind the guard ──

    await t.test(
      'a permission never replaces institute scoping on the examination surface',
      async () => {
        const examsSvc = new ExaminationsService(svc, new AcademicScopeService(svc));
        const controller = new ExaminationsController(examsSvc);
        const dTenant = await tenantOf(
          { s: SURFACE[0]!, h: PROTOS.ExaminationsController.get, key: 'assessments.read' },
          'dAsmManage',
        );
        assert.equal(dTenant.instituteId, instA!.id);
        // A fully-authorized `assessments.manage` delegate reaches its own institute…
        const own = await PROTOS.ExaminationsController.get.call(
          controller,
          dTenant,
          asUser(dAsmManage),
          assessmentS1!.id,
        );
        assert.equal(own.assessment.id, assessmentS1!.id);
        // …and still gets NotFound (never Forbidden) for another institute's row.
        await assert.rejects(
          PROTOS.ExaminationsController.get.call(
            controller,
            dTenant,
            asUser(dAsmManage),
            assessmentB!.id,
          ),
          NotFoundException,
          'another institute assessment must not resolve',
        );
      },
    );

    await t.test(
      'academic subject scope and O1 staging ownership survive the permission layer',
      async () => {
        const scope = new AcademicScopeService(svc);
        const examsSvc = new ExaminationsService(svc, scope);
        const controller = new ExaminationsController(examsSvc);
        const t1Tenant: TenantContext = {
          instituteId: instA!.id,
          membershipId: t1Mem.id,
          roles: ['TEACHER'],
        } as TenantContext;
        assert.deepEqual(await scope.resolveScope(instA!.id, t1Mem.id), {
          kind: 'subject-set',
          subjectIds: [s1!.id],
        });

        // (a) SQL-level subject filter on the list (§18.4).
        const listed = await PROTOS.ExaminationsController.list.call(
          controller,
          t1Tenant,
          asUser(teacher1),
        );
        const visible = new Set(listed.assessments.map((a: { id: string }) => a.id));
        assert.ok(visible.has(assessmentS1!.id), 'an in-scope s1 assessment is visible');
        assert.ok(
          !visible.has(assessmentS2!.id),
          's2 is outside teacher1 reach and must never be listed',
        );
        assert.ok(
          !visible.has(assessmentDraft!.id),
          "another teacher's DRAFT must never be listed (O1)",
        );
        assert.ok(
          !visible.has(assessmentB!.id),
          'another institute assessment must never be listed',
        );

        // (b) out-of-scope detail read is NotFound, never Forbidden (no existence leak).
        await assert.rejects(
          PROTOS.ExaminationsController.get.call(
            controller,
            t1Tenant,
            asUser(teacher1),
            assessmentS2!.id,
          ),
          NotFoundException,
        );
        // (c) another author's DRAFT inside teacher1's OWN subject is still NotFound (O1).
        await assert.rejects(
          PROTOS.ExaminationsController.get.call(
            controller,
            t1Tenant,
            asUser(teacher1),
            assessmentDraft!.id,
          ),
          NotFoundException,
        );
      },
    );

    await t.test(
      'MOD-4 attempt authorization is intact: assessment resolution + attempt ownership',
      async () => {
        const scope = new AcademicScopeService(svc);
        const examsSvc = new ExaminationsService(svc, scope);
        const attemptsSvc = new AttemptsService(svc, examsSvc);

        // INSTITUTE_ADMIN reaches the ledger and analytics institute-wide.
        const adminLedger = await attemptsSvc.listForAssessment(
          instA!.id,
          adminMem.id,
          admin!.id,
          assessmentS1!.id,
        );
        assert.equal(adminLedger.attempts.length, 1);
        const adminAnalytics = await attemptsSvc.getAnalytics(
          instA!.id,
          adminMem.id,
          admin!.id,
          assessmentS1!.id,
        );
        assert.equal(adminAnalytics.analytics.summary.evaluatedAttempts, 1);

        // TEACHER in scope reaches them; out of scope is NotFound on BOTH endpoints.
        assert.equal(
          (await attemptsSvc.listForAssessment(instA!.id, t1Mem.id, teacher1!.id, assessmentS1!.id))
            .attempts.length,
          1,
        );
        await assert.rejects(
          attemptsSvc.listForAssessment(instA!.id, t1Mem.id, teacher1!.id, assessmentS2!.id),
          NotFoundException,
        );
        await assert.rejects(
          attemptsSvc.getAnalytics(instA!.id, t1Mem.id, teacher1!.id, assessmentS2!.id),
          NotFoundException,
        );
        await assert.rejects(
          attemptsSvc.listForAssessment(instA!.id, t1Mem.id, teacher1!.id, assessmentB!.id),
          NotFoundException,
        );
        await assert.rejects(
          attemptsSvc.getAnalytics(instA!.id, t1Mem.id, teacher1!.id, assessmentB!.id),
          NotFoundException,
        );

        // The student lifecycle is self-scoped: loadOwn matches institute + studentId,
        // so a delegate can only ever touch their OWN attempt.
        const controller = new AttemptsController(attemptsSvc);
        const studentTenant: TenantContext = {
          instituteId: instA!.id,
          membershipId: studentMem.id,
          roles: ['STUDENT'],
        } as TenantContext;
        const mine = await PROTOS.AttemptsController.get.call(
          controller,
          studentTenant,
          asUser(student),
          attemptS1!.id,
        );
        assert.equal(mine.attempt.id, attemptS1!.id);
        const dTenant = await tenantOf(
          { s: SURFACE[1]!, h: PROTOS.AttemptsController.get, key: 'attempts.read' },
          'dAttemptRead',
        );
        await assert.rejects(
          PROTOS.AttemptsController.get.call(
            controller,
            dTenant,
            asUser(dAttemptRead),
            attemptS1!.id,
          ),
          NotFoundException,
          "another member's attempt must not resolve even with attempts.read",
        );
      },
    );

    await t.test(
      'practice authorization stays enforced: sessions are self-scoped and cross-institute closed',
      async () => {
        const practice = new PracticeService(svc);
        const controller = new PracticeController(practice);
        const mine = await PROTOS.PracticeController.get.call(
          controller,
          {
            instituteId: instA!.id,
            membershipId: studentMem.id,
            roles: ['STUDENT'],
          } as TenantContext,
          asUser(student),
          practiceOwn!.id,
        );
        assert.equal(mine.session.id, practiceOwn!.id);
        // A delegate holding `practice.read` still cannot read someone else's session.
        const dTenant = await tenantOf(
          { s: SURFACE[2]!, h: PROTOS.PracticeController.save, key: 'practice.update' },
          'dPracticeUpdate',
        );
        await assert.rejects(
          PROTOS.PracticeController.get.call(
            controller,
            dTenant,
            asUser(dPracticeUpdate),
            practiceOwn!.id,
          ),
          NotFoundException,
          "another member's practice session must not resolve even with practice.update",
        );
        // And institute B's membership cannot see institute A's session.
        const bTenant: TenantContext = {
          instituteId: instB!.id,
          membershipId: (
            await db!
              .select()
              .from(memberships)
              .where(eq(memberships.userId, crossDelegate!.id))
              .limit(1)
          )[0]!.id,
          roles: ['INSTITUTE_ADMIN'],
        } as TenantContext;
        await assert.rejects(
          PROTOS.PracticeController.get.call(
            controller,
            bTenant,
            asUser(crossDelegate),
            practiceOwn!.id,
          ),
          NotFoundException,
        );
      },
    );

    await t.test(
      'question-type creation stays institute-scoped, and TEACHER keeps the capability',
      async () => {
        const types = new QuestionTypesService(svc);
        const controller = new QuestionTypesController(types);
        const bMembership = (
          await db!
            .select()
            .from(memberships)
            .where(eq(memberships.userId, crossDelegate!.id))
            .limit(1)
        )[0]!;
        const bTenant: TenantContext = {
          instituteId: instB!.id,
          membershipId: bMembership.id,
          roles: ['INSTITUTE_ADMIN'],
        } as TenantContext;

        // TEACHER still creates a custom question type through the new permission —
        // the shipped custom-type panel is unchanged.
        const t1Tenant = await tenantOf(
          {
            s: SURFACE[3]!,
            h: PROTOS.QuestionTypesController.create,
            key: 'question-types.create',
          },
          'teacher',
        );
        const created = await PROTOS.QuestionTypesController.create.call(
          controller,
          t1Tenant,
          asUser(teacher1),
          { name: `Custom ${suffix}`, answerFormat: 'MCQ', kind: 'OBJECTIVE' } as never,
        );
        assert.ok(
          created.type.id,
          'TEACHER still creates a custom question type through the new permission',
        );
        assert.ok(
          (await types.list(instA!.id)).some((tp) => tp.id === created.type.id),
          'the new type lands in institute A',
        );
        // A B membership cannot see or collide with A's custom type, and its own
        // creation lands in B.
        assert.ok(
          !(await types.list(instB!.id)).some((tp) => tp.id === created.type.id),
          'a foreign custom type must not leak',
        );
        const bCreated = await PROTOS.QuestionTypesController.create.call(
          controller,
          bTenant,
          asUser(crossDelegate),
          { name: `B ${suffix}`, answerFormat: 'MCQ', kind: 'OBJECTIVE' } as never,
        );
        assert.ok(
          (await types.list(instB!.id)).some((tp) => tp.id === bCreated.type.id),
          'B creates into B',
        );
        assert.ok(
          !(await types.list(instA!.id)).some((tp) => tp.id === bCreated.type.id),
          "B's type must not land in A",
        );
      },
    );

    await t.test(
      'both assessment bridges still enforce academic scope, and the bank-coverage gate still runs',
      async () => {
        const scope = new AcademicScopeService(svc);
        const examsSvc = new ExaminationsService(svc, scope);
        // `generation.ensurePatternCoverage` is the only generation touch on the
        // pattern bridge, so a stub proves the gate is consulted — and that a
        // NOT-covered bank refuses to mint an assessment.
        let covered: boolean = true;
        const generation = {
          ensurePatternCoverage: async () =>
            covered
              ? { covered: true, status: 'READY' }
              : { covered: false, status: 'INSUFFICIENT' },
        };
        const patternSvc = new PaperPatternsService(
          svc,
          {} as never,
          {} as never,
          examsSvc,
          generation as never,
          scope,
        );
        const paperSvc = new QuestionPapersService(svc, examsSvc, {} as never, scope);

        // Paper bridge: in-scope s1 paper converts; another institute's is NotFound.
        const fromPaper = await paperSvc.createAssessmentFromPaper(
          instA!.id,
          t1Mem.id,
          teacher1!.id,
          paperS1!.id,
        );
        assert.equal(
          fromPaper.subjectId,
          s1!.id,
          'the paper bridge creates an assessment inside the paper scope',
        );
        // Pattern bridge: the coverage gate still runs and can refuse.
        const fromPattern = (await patternSvc.createAssessmentFromBlueprint(
          instA!.id,
          t1Mem.id,
          teacher1!.id,
          patternS1!.id,
          { subjectId: s1!.id },
        )) as { blueprintId?: string | null };
        assert.equal(
          fromPattern.blueprintId,
          patternS1!.id,
          'the pattern bridge creates an assessment from the approved pattern',
        );
        covered = false;
        await assert.rejects(
          patternSvc.createAssessmentFromBlueprint(
            instA!.id,
            t1Mem.id,
            teacher1!.id,
            patternS1!.id,
            { subjectId: s1!.id },
          ),
          BadRequestException,
          'an uncovered question bank must still refuse to mint an assessment',
        );
        // teacher2's reach is s2 only: the out-of-scope paper is NotFound, never
        // Forbidden, so the bridge leaks no existence information.
        await assert.rejects(
          paperSvc.createAssessmentFromPaper(instA!.id, t2Mem.id, teacher2!.id, paperS1!.id),
          NotFoundException,
        );
        // …and `createAssessment`'s own `requireWritableSubject` still refuses a
        // subject outside the caller's scope (403 is correct for a *write* denial).
        await assert.rejects(
          examsSvc.createAssessment(instA!.id, t2Mem.id, teacher2!.id, {
            title: `X ${suffix}`,
            subjectId: s1!.id,
          } as never),
          ForbiddenException,
        );
      },
    );

    // ── Negative probe: the migration's guards are load-bearing ──

    await t.test(
      'NEGATIVE PROBE: deleting a RequiredPermission decorator reopens the route',
      async () => {
        const row = MIGRATED.find(
          (r) =>
            r.s.label === 'ExaminationsController' && r.h === PROTOS.ExaminationsController.delete,
        )!;
        const target = PROTOS.ExaminationsController.delete as object;
        const saved = Reflect.getMetadata(PERMISSIONS_KEY, target);
        assert.equal(declared(row), 'assessments.delete', 'baseline: the decorator is present');

        try {
          Reflect.deleteMetadata(PERMISSIONS_KEY, target);
          assert.ok(!declared(row), 'probe: the decorator really is gone');
          // With no declared permission PermissionGuard is a no-op, so the route stops
          // being gated at all — a membership with zero roles walks straight through.
          await chain(row, 'zeroRole');
        } finally {
          Reflect.defineMetadata(PERMISSIONS_KEY, saved, target);
        }

        assert.equal(declared(row), 'assessments.delete', 'probe: the decorator is restored');
        await assert.rejects(
          chain(row, 'zeroRole'),
          ForbiddenException,
          'restored route is guarded again',
        );
      },
    );
  },
);
