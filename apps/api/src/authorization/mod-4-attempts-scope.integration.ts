import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  users,
  authSessions,
  memberships,
  membershipRoles,
  roles,
  subjects,
  classes,
  classSubjects,
  teacherAssignments,
  questions,
  assessments,
  assessmentQuestions,
  attempts,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { AcademicScopeService } from './academic-scope.service.ts';
import { ExaminationsService } from '../examinations/examinations.service.ts';
import { AttemptsService } from '../attempts/attempts.service.ts';
import { AttemptsController } from '../attempts/attempts.controller.ts';

// MOD-4 attempts-scope regression. Requires a live database: run with
// TEST_DATABASE_URL via the `test:mod-4-attempts-scope` script; skips when
// unset. Locks in: GET /assessments/:assessmentId/attempts and
// /assessments/:assessmentId/analytics resolve the assessment through
// ExaminationsService.getAssessment (the authoritative academic-scope gate),
// so a scoped TEACHER can no longer reach attempts/analytics for an
// assessment outside their assigned subject scope; INSTITUTE_ADMIN keeps
// whole-institute access; STUDENT keeps the intentional whole-institute
// availability on attemptable assessments (the attempt lifecycle is not
// subject-scoped by design) and stays refused on the teacher endpoints.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'mod-4-attempts-scope-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

type AnyHandler = (...args: never[]) => unknown;

function reqContext(handler: AnyHandler, request: Record<string, unknown>, method = 'GET') {
  const req = { headers: {}, method, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => AttemptsController,
  } as unknown as ExecutionContext;
}

async function authnAuthz(handler: AnyHandler, request: Record<string, unknown>) {
  const ctx = reqContext(handler, request);
  await new AccessTokenGuard(db as unknown as Database, JWT).canActivate(ctx);
  await new TenantGuard(new TenancyService(db as unknown as Database)).canActivate(ctx);
  return ctx;
}

test('MOD-4: attempts/analytics reuse the authoritative assessment academic-scope gate', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const scope = new AcademicScopeService(svc);
  const examsSvc = new ExaminationsService(svc, scope);
  const attemptsSvc = new AttemptsService(svc, examsSvc);

  const roleIdOf = async (key: string) => {
    const [r] = await db!.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
    if (!r) throw new Error(`${key} role not seeded`);
    return r.id;
  };

  const scratchInstitutes: string[] = [];
  const scratchUsers: string[] = [];

  const makeInstitute = async (name: string) => {
    const [inst] = await db!.insert(institutes).values({ name, slug: `${name}-${randomUUID()}` }).returning();
    scratchInstitutes.push(inst!.id);
    return inst!.id;
  };

  const makeUser = async (name: string) => {
    const [user] = await db!.insert(users).values({ email: randomUUID(), name, passwordHash: 'x' }).returning();
    scratchUsers.push(user!.id);
    return user!;
  };

  const makeMembership = async (userId: string, instituteId: string, roleKeys: string[]) => {
    const [m] = await db!.insert(memberships).values({ userId, instituteId, status: 'active' }).returning();
    for (const key of roleKeys) {
      await db!.insert(membershipRoles).values({ membershipId: m!.id, roleId: await roleIdOf(key) });
    }
    return m!;
  };

  const makeSession = async (userId: string) => {
    const [row] = await db!.insert(authSessions).values({
      userId,
      refreshTokenHash: `mod-4-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    return row!.id;
  };

  const seed = {
    subject: async (instituteId: string) => {
      const [s] = await db!.insert(subjects).values({ instituteId, name: randomUUID(), slug: randomUUID() }).returning();
      return s!.id;
    },
    assessment: async (instituteId: string, subjectId: string, status: string, createdBy: string) => {
      const [a] = await db!.insert(assessments).values({
        instituteId, subjectId, title: randomUUID(), status, createdBy, updatedBy: createdBy,
      }).returning();
      return a!.id;
    },
    linkQuestion: async (assessmentId: string, questionId: string) => {
      await db!.insert(assessmentQuestions).values({ assessmentId, questionId, sortOrder: 1, marks: 5 });
    },
  };

  try {
    // ── Institute A: t1 → s1, t2 → s2, admin whole-institute, a student.
    const instA = await makeInstitute('mod-4-scope-a');
    const s1 = await seed.subject(instA);
    const s2 = await seed.subject(instA);
    const adminUser = await makeUser('MOD-4 Admin');
    const t1User = await makeUser('MOD-4 T1');
    const t2User = await makeUser('MOD-4 T2');
    const studentUser = await makeUser('MOD-4 Student');
    const adminMem = await makeMembership(adminUser.id, instA, ['INSTITUTE_ADMIN']);
    const t1Mem = await makeMembership(t1User.id, instA, ['TEACHER']);
    const t2Mem = await makeMembership(t2User.id, instA, ['TEACHER']);
    await makeMembership(studentUser.id, instA, ['STUDENT']);
    const adminSid = await makeSession(adminUser.id);
    const studentSid = await makeSession(studentUser.id);

    const [cls] = await db!.insert(classes).values({ instituteId: instA, name: 'MOD-4 Class' }).returning();
    const [off1] = await db!.insert(classSubjects).values({ classId: cls!.id, subjectId: s1 }).returning();
    const [off2] = await db!.insert(classSubjects).values({ classId: cls!.id, subjectId: s2 }).returning();
    await db!.insert(teacherAssignments).values({ instituteId: instA, classSubjectId: off1!.id, membershipId: t1Mem.id });
    await db!.insert(teacherAssignments).values({ instituteId: instA, classSubjectId: off2!.id, membershipId: t2Mem.id });
    assert.deepEqual(await scope.resolveScope(instA, t1Mem.id), { kind: 'subject-set', subjectIds: [s1] });
    assert.deepEqual(await scope.resolveScope(instA, t2Mem.id), { kind: 'subject-set', subjectIds: [s2] });

    const [q] = await db!.insert(questions).values({
      instituteId: instA, subjectId: s1, stem: 'MOD-4-Q', questionType: 'MCQ_SINGLE',
      answerFormat: 'single-choice', difficulty: 'EASY', payload: { options: ['a', 'b'], correctIndex: 0 },
      approvalStatus: 'APPROVED', status: 'ACTIVE', createdBy: t1User.id, updatedBy: t1User.id,
    }).returning();

    const aS1 = await seed.assessment(instA, s1, 'ACTIVE', t1User.id);
    const aS2 = await seed.assessment(instA, s2, 'ACTIVE', t1User.id);
    const aT2DraftS1 = await seed.assessment(instA, s1, 'DRAFT', t2User.id);
    await seed.linkQuestion(aS1, q!.id);
    await seed.linkQuestion(aS2, q!.id);

    // A submitted attempt on aS1 keeps the ledger + analytics non-empty.
    await db!.insert(attempts).values({
      instituteId: instA, assessmentId: aS1, studentId: studentUser.id, status: 'SUBMITTED',
      submittedAt: new Date(), score: 5, totalMarks: 10,
    });

    // ── MOD-4 Test 1: INSTITUTE_ADMIN reaches attempts/analytics across the
    //    whole institute (in-scope DRAFT staging bypass included).
    const adminLedger = await attemptsSvc.listForAssessment(instA, adminMem.id, adminUser.id, aS1);
    assert.equal(adminLedger.attempts.length, 1);
    const adminAnalytics = await attemptsSvc.getAnalytics(instA, adminMem.id, adminUser.id, aS1);
    assert.equal(adminAnalytics.analytics.summary.evaluatedAttempts, 1);
    await assert.ok((await attemptsSvc.listForAssessment(instA, adminMem.id, adminUser.id, aT2DraftS1)).attempts.length === 0);
    assert.equal((await attemptsSvc.getAnalytics(instA, adminMem.id, adminUser.id, aT2DraftS1)).analytics.summary.evaluatedAttempts, 0);

    // ── MOD-4 Test 2: TEACHER in-scope reaches attempts/analytics.
    const t1Ledger = await attemptsSvc.listForAssessment(instA, t1Mem.id, t1User.id, aS1);
    assert.equal(t1Ledger.attempts.length, 1);
    assert.equal(t1Ledger.attempts[0]!.studentId, studentUser.id);
    const t1Analytics = await attemptsSvc.getAnalytics(instA, t1Mem.id, t1User.id, aS1);
    assert.equal(t1Analytics.analytics.summary.evaluatedAttempts, 1);

    // ── MOD-4 Test 3: TEACHER out-of-scope is 404 on both endpoints, and a
    //    foreign teacher's in-scope DRAFT is 404 too.
    await assert.rejects(attemptsSvc.listForAssessment(instA, t1Mem.id, t1User.id, aS2), NotFoundException);
    await assert.rejects(attemptsSvc.getAnalytics(instA, t1Mem.id, t1User.id, aS2), NotFoundException);
    await assert.rejects(attemptsSvc.listForAssessment(instA, t1Mem.id, t1User.id, aT2DraftS1), NotFoundException);
    await assert.rejects(attemptsSvc.getAnalytics(instA, t1Mem.id, t1User.id, aT2DraftS1), NotFoundException);

    // ── MOD-4 Test 4: TEACHER on the other scope sees their own assessment.
    const t2Analytics = await attemptsSvc.getAnalytics(instA, t2Mem.id, t2User.id, aS2);
    assert.equal(t2Analytics.analytics.summary.evaluatedAttempts, 0);

    // ── MOD-4 Test 5: cross-institute denial on both endpoints.
    const instB = await makeInstitute('mod-4-isolation-b');
    const sB = await seed.subject(instB);
    const bAdmin = await makeUser('MOD-4 B Admin');
    await makeMembership(bAdmin.id, instB, ['INSTITUTE_ADMIN']);
    const bAssess = await seed.assessment(instB, sB, 'ACTIVE', bAdmin.id);
    await assert.rejects(attemptsSvc.listForAssessment(instA, adminMem.id, adminUser.id, bAssess), NotFoundException);
    await assert.rejects(attemptsSvc.getAnalytics(instA, adminMem.id, adminUser.id, bAssess), NotFoundException);

    // ── MOD-4 Test 6: STUDENT semantics — intentional whole-institute
    //    availability on attemptable assessments (the attempt lifecycle is not
    //    subject-scoped by design): a student can start an attempt on aS2 even
    //    though the s1-scoped teacher cannot reach it. STUDENT is refused the
    //    teacher endpoints (RolesGuard).
    const started = await attemptsSvc.start(instA, studentUser.id, aS2);
    assert.equal(started.attempt.status, 'IN_PROGRESS');
    assert.equal(started.attempt.assessmentId, aS2);
    const submitted = await attemptsSvc.submit(instA, started.attempt.id, studentUser.id);
    assert.equal(submitted.status, 'SUBMITTED');
    const result = await attemptsSvc.result(instA, started.attempt.id, studentUser.id);
    assert.equal(result.result.assessmentId, aS2);
    assert.equal(result.result.questions.length, 1);
    const myHistory = await attemptsSvc.listMine(instA, studentUser.id);
    assert.ok(myHistory.attempts.some((a) => a.assessmentId === aS2));

    const roles = new RolesGuard(new Reflector());
    const asStudent = async (handler: AnyHandler) =>
      authnAuthz(handler, {
        headers: { 'x-institute-id': instA },
        cookies: { access_token: await sign(studentUser.id, studentSid) },
      });
    const asAdmin = async (handler: AnyHandler) =>
      authnAuthz(handler, {
        headers: { 'x-institute-id': instA },
        cookies: { access_token: await sign(adminUser.id, adminSid) },
      });
    for (const handler of [
      AttemptsController.prototype.listForAssessment as AnyHandler,
      AttemptsController.prototype.analytics as AnyHandler,
    ]) {
      const studentCtx = await asStudent(handler);
      assert.throws(() => roles.canActivate(studentCtx), ForbiddenException, `${handler.name} refused to student`);
      const adminCtx = await asAdmin(handler);
      assert.equal(roles.canActivate(adminCtx), true, `${handler.name} allowed for admin`);
    }

    // ── MOD-4 Test 7: existing valid behavior — analytics on aS1 counts the
    //    student's submitted attempt with a score (evaluated only).
    const finalAnalytics = await attemptsSvc.getAnalytics(instA, adminMem.id, adminUser.id, aS1);
    assert.equal(finalAnalytics.analytics.summary.evaluatedAttempts, 1);
  } finally {
    if (scratchInstitutes.length > 0) {
      await db!.delete(attempts).where(inArray(attempts.instituteId, scratchInstitutes));
      await db!.delete(questions).where(inArray(questions.instituteId, scratchInstitutes));
    }
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstitutes));
    await db!.delete(users).where(inArray(users.id, scratchUsers));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});