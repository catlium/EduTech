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
  contentItems,
  contentVersions,
  questions,
  paperPatterns,
  paperPatternSubjects,
  questionPapers,
  assessments,
  attempts,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { AcademicScopeService } from './academic-scope.service.ts';
import { ContentService } from '../content/content.service.ts';
import { ExaminationsService } from '../examinations/examinations.service.ts';
import { PaperPatternsService } from '../paper-patterns/paper-patterns.service.ts';
import { QuestionPapersService } from '../question-papers/question-papers.service.ts';
import type { JobsService } from '../jobs/jobs.service.ts';
import type { MaterialsService } from '../materials/materials.service.ts';
import type { QuestionGenerationService } from '../questions/question-generation.service.ts';
import { ExportService } from '../export/export.service.ts';
import { PuppeteerService } from '../export/puppeteer.service.ts';
import { ExportController } from '../export/export.controller.ts';
import type { DocumentModel } from '../export/export.content-blocks.ts';

// MOD-3 export academic-scope regression. Requires a live database: run with
// TEST_DATABASE_URL via the `test:mod-3-export-scope` script; skips when unset.
// Locks in: export/content uses gateContent, export/paper-pattern uses
// gatePatternAccess, export/question-paper uses gatePaper, and assessment
// results/analytics resolve through ExaminationsService.getAssessment — the
// same authoritative scope gates as the underlying read paths. STUDENT is
// refused on the content/preview routes (which now carry @RequiredRoles), and
// tenant isolation is unchanged.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'mod-3-export-scope-secret', signOptions: { algorithm: 'HS256' } });
const sign = (sub: string, sid: string) => JWT.signAsync({ sub, sid }, { expiresIn: '15m' });

type AnyHandler = (...args: never[]) => unknown;

function reqContext(handler: AnyHandler, request: Record<string, unknown>, method = 'GET') {
  const req = { headers: {}, method, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => ExportController,
  } as unknown as ExecutionContext;
}

async function authnAuthz(handler: AnyHandler, request: Record<string, unknown>) {
  const ctx = reqContext(handler, request);
  await new AccessTokenGuard(db as unknown as Database, JWT).canActivate(ctx);
  await new TenantGuard(new TenancyService(db as unknown as Database)).canActivate(ctx);
  return ctx;
}

function stemsOf(doc: DocumentModel): string[] {
  return doc.blocks
    .filter((b) => b.kind === 'question' && 'stem' in b)
    .map((b) => (b as Extract<DocumentModel['blocks'][number], { stem: string }>).stem);
}

test('MOD-3: export builders reuse the authoritative academic-scope gates', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const scope = new AcademicScopeService(svc);
  const examsSvc = new ExaminationsService(svc, scope);
  const contentSvc = new ContentService(svc, scope);
  const genStub = {} as unknown as QuestionGenerationService;
  const patternsSvc = new PaperPatternsService(
    svc,
    {} as unknown as JobsService,
    {} as unknown as MaterialsService,
    examsSvc,
    genStub,
    scope,
  );
  const papersSvc = new QuestionPapersService(svc, examsSvc, genStub, scope);
  const puppetStub = { pdf: async () => Buffer.alloc(0) } as unknown as PuppeteerService;
  const exportSvc = new ExportService(
    svc,
    puppetStub,
    scope,
    examsSvc,
    contentSvc,
    patternsSvc,
    papersSvc,
  );

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
      refreshTokenHash: `mod-3-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    return row!.id;
  };

  const seed = {
    subject: async (instituteId: string) => {
      const [s] = await db!.insert(subjects).values({ instituteId, name: randomUUID(), slug: randomUUID() }).returning();
      return s!.id;
    },
    content: async (instituteId: string, subjectId: string | null, status: string, createdBy: string) => {
      const [item] = await db!.insert(contentItems).values({
        instituteId, subjectId, type: 'NOTE', title: randomUUID(), source: 'MANUAL',
        currentVersion: 1, status, createdBy, updatedBy: createdBy,
      }).returning();
      await db!.insert(contentVersions).values({
        contentId: item!.id, version: 1, payload: { blocks: [{ type: 'paragraph', content: 'x' }] },
        changeType: 'CREATION', createdBy,
      });
      return item!.id;
    },
    pattern: async (instituteId: string, subjectId: string | null, status: string, createdBy: string) => {
      const [p] = await db!.insert(paperPatterns).values({
        instituteId, title: randomUUID(), status, createdBy,
      }).returning();
      if (subjectId) {
        await db!.insert(paperPatternSubjects).values({ patternId: p!.id, subjectId });
      }
      return p!.id;
    },
    paper: async (instituteId: string, subjectId: string | null, createdBy: string) => {
      const [p] = await db!.insert(questionPapers).values({
        instituteId, subjectId, title: randomUUID(), createdBy, updatedBy: createdBy,
      }).returning();
      return p!.id;
    },
    assessment: async (instituteId: string, subjectId: string, status: string, createdBy: string) => {
      const [a] = await db!.insert(assessments).values({
        instituteId, subjectId, title: randomUUID(), status, createdBy, updatedBy: createdBy,
      }).returning();
      return a!.id;
    },
  };

  try {
    // ── Institute A: t1 → s1, t2 → s2, admin whole-institute, a student.
    const instA = await makeInstitute('mod-3-scope-a');
    const s1 = await seed.subject(instA);
    const s2 = await seed.subject(instA);
    const adminUser = await makeUser('MOD-3 Admin');
    const t1User = await makeUser('MOD-3 T1');
    const t2User = await makeUser('MOD-3 T2');
    const studentUser = await makeUser('MOD-3 Student');
    const adminMem = await makeMembership(adminUser.id, instA, ['INSTITUTE_ADMIN']);
    const t1Mem = await makeMembership(t1User.id, instA, ['TEACHER']);
    const t2Mem = await makeMembership(t2User.id, instA, ['TEACHER']);
    await makeMembership(studentUser.id, instA, ['STUDENT']);
    const adminSid = await makeSession(adminUser.id);
    const studentSid = await makeSession(studentUser.id);

    const [cls] = await db!.insert(classes).values({ instituteId: instA, name: 'MOD-3 Class' }).returning();
    const [off1] = await db!.insert(classSubjects).values({ classId: cls!.id, subjectId: s1 }).returning();
    const [off2] = await db!.insert(classSubjects).values({ classId: cls!.id, subjectId: s2 }).returning();
    await db!.insert(teacherAssignments).values({ instituteId: instA, classSubjectId: off1!.id, membershipId: t1Mem.id });
    await db!.insert(teacherAssignments).values({ instituteId: instA, classSubjectId: off2!.id, membershipId: t2Mem.id });
    assert.deepEqual(await scope.resolveScope(instA, t1Mem.id), { kind: 'subject-set', subjectIds: [s1] });
    assert.deepEqual(await scope.resolveScope(instA, t2Mem.id), { kind: 'subject-set', subjectIds: [s2] });

    const cS1 = await seed.content(instA, s1, 'ACTIVE', t1User.id);
    const cS2 = await seed.content(instA, s2, 'ACTIVE', t1User.id);
    const cT1Draft = await seed.content(instA, s1, 'DRAFT', t1User.id);
    const cT2DraftS1 = await seed.content(instA, s1, 'DRAFT', t2User.id);
    const pS1Approved = await seed.pattern(instA, s1, 'APPROVED', t1User.id);
    const pS2Approved = await seed.pattern(instA, s2, 'APPROVED', t1User.id);
    const pT2DraftS1 = await seed.pattern(instA, s1, 'DRAFT', t2User.id);
    const qpS1 = await seed.paper(instA, s1, t1User.id);
    const qpS2 = await seed.paper(instA, s2, t1User.id);
    const aS1 = await seed.assessment(instA, s1, 'ACTIVE', t1User.id);
    const aS2 = await seed.assessment(instA, s2, 'ACTIVE', t1User.id);
    const aT2DraftS1 = await seed.assessment(instA, s1, 'DRAFT', t2User.id);
    await db!.insert(attempts).values({
      instituteId: instA, assessmentId: aS1, studentId: studentUser.id, status: 'SUBMITTED',
      submittedAt: new Date(), score: 7, totalMarks: 10,
    });
    // A bank question in s1 keeps the question-bank export path pinned.
    await db!.insert(questions).values({
      instituteId: instA, subjectId: s1, stem: 'MOD-3-Q-S1', questionType: 'MCQ_SINGLE',
      answerFormat: 'single-choice', difficulty: 'EASY', payload: { options: ['a', 'b'], correctIndex: 0 },
      approvalStatus: 'APPROVED', status: 'ACTIVE', createdBy: t1User.id, updatedBy: t1User.id,
    });

    const titleOf = async (table: typeof contentItems | typeof paperPatterns | typeof questionPapers | typeof assessments, id: string) => {
      const [r] = await db!.select({ title: table.title }).from(table).where(eq(table.id, id)).limit(1);
      return r!.title;
    };

    // ── MOD-3 Test 1: INSTITUTE_ADMIN exports within the whole institute.
    assert.equal((await exportSvc.buildContentDoc(instA, adminMem.id, adminUser.id, cS1)).title, await titleOf(contentItems, cS1));
    assert.equal((await exportSvc.buildPaperPatternDoc(instA, adminMem.id, adminUser.id, pS2Approved)).title, await titleOf(paperPatterns, pS2Approved));
    assert.equal((await exportSvc.buildQuestionPaperDoc(instA, adminMem.id, adminUser.id, qpS2)).title, await titleOf(questionPapers, qpS2));
    assert.equal((await exportSvc.buildAssessmentResultsDoc(instA, adminMem.id, adminUser.id, aS2)).title, (await titleOf(assessments, aS2)) + ' — Results');
    // Admin bypasses staging (O1 carve-out) too.
    assert.ok((await exportSvc.buildContentDoc(instA, adminMem.id, adminUser.id, cT2DraftS1)).blocks.length >= 0);
    await assert.rejects(exportSvc.buildAssessmentResultsDoc(instA, adminMem.id, adminUser.id, randomUUID()), NotFoundException);

    // ── MOD-3 Test 2: TEACHER exports resources within their academic scope.
    assert.ok((await exportSvc.buildContentDoc(instA, t1Mem.id, t1User.id, cS1)).blocks.length > 0);
    assert.equal((await exportSvc.buildPaperPatternDoc(instA, t1Mem.id, t1User.id, pS1Approved)).title, await titleOf(paperPatterns, pS1Approved));
    assert.equal((await exportSvc.buildQuestionPaperDoc(instA, t1Mem.id, t1User.id, qpS1)).title, await titleOf(questionPapers, qpS1));
    assert.equal((await exportSvc.buildAssessmentResultsDoc(instA, t1Mem.id, t1User.id, aS1)).title, (await titleOf(assessments, aS1)) + ' — Results');
    // Staging O1: the owner exports their own DRAFT.
    assert.ok((await exportSvc.buildContentDoc(instA, t1Mem.id, t1User.id, cT1Draft)).blocks.length > 0);

    // ── MOD-3 Test 3: TEACHER cannot export another subject/class resource
    //    outside scope (404, no existence leak).
    await assert.rejects(exportSvc.buildContentDoc(instA, t1Mem.id, t1User.id, cS2), NotFoundException);
    await assert.rejects(exportSvc.buildPaperPatternDoc(instA, t1Mem.id, t1User.id, pS2Approved), NotFoundException);
    await assert.rejects(exportSvc.buildQuestionPaperDoc(instA, t1Mem.id, t1User.id, qpS2), NotFoundException);
    await assert.rejects(exportSvc.buildAssessmentResultsDoc(instA, t1Mem.id, t1User.id, aS2), NotFoundException);
    // O1: another teacher's in-scope DRAFT is not exportable.
    await assert.rejects(exportSvc.buildContentDoc(instA, t1Mem.id, t1User.id, cT2DraftS1), NotFoundException);
    await assert.rejects(exportSvc.buildPaperPatternDoc(instA, t1Mem.id, t1User.id, pT2DraftS1), NotFoundException);
    await assert.rejects(exportSvc.buildAssessmentResultsDoc(instA, t1Mem.id, t1User.id, aT2DraftS1), NotFoundException);

    // ── MOD-3 Test 4: STUDENT is refused every export route with a role gate.
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
    const gatedRoutes: AnyHandler[] = [
      ExportController.prototype.exportContent as AnyHandler,
      ExportController.prototype.previewContent as AnyHandler,
      ExportController.prototype.exportPaperPattern as AnyHandler,
      ExportController.prototype.previewPaperPattern as AnyHandler,
      ExportController.prototype.exportQuestionPaper as AnyHandler,
      ExportController.prototype.previewQuestionPaper as AnyHandler,
      ExportController.prototype.exportAssessmentResults as AnyHandler,
      ExportController.prototype.previewAssessmentResults as AnyHandler,
    ];
    for (const handler of gatedRoutes) {
      const studentCtx = await asStudent(handler);
      assert.throws(() => roles.canActivate(studentCtx), ForbiddenException, `${handler.name} refused to student`);
      const adminCtx = await asAdmin(handler);
      assert.equal(roles.canActivate(adminCtx), true, `${handler.name} allowed for admin`);
    }

    // ── MOD-3 Test 5: results/analytics cannot cross teacher academic scope
    //    (already 404 for aS2 and aT2DraftS1 above — spelled out for the audit).
    await assert.rejects(exportSvc.buildAssessmentResultsDoc(instA, t1Mem.id, t1User.id, aS2), NotFoundException);

    // ── MOD-3 Test 6: tenant isolation intact for every export family.
    const instB = await makeInstitute('mod-3-isolation-b');
    const sB = await seed.subject(instB);
    const bAdmin = await makeUser('MOD-3 B Admin');
    await makeMembership(bAdmin.id, instB, ['INSTITUTE_ADMIN']);
    const bContent = await seed.content(instB, sB, 'ACTIVE', bAdmin.id);
    const bPattern = await seed.pattern(instB, sB, 'APPROVED', bAdmin.id);
    const bQp = await seed.paper(instB, sB, bAdmin.id);
    const bAssess = await seed.assessment(instB, sB, 'ACTIVE', bAdmin.id);
    await assert.rejects(exportSvc.buildContentDoc(instA, adminMem.id, adminUser.id, bContent), NotFoundException, 'foreign content is 404');
    await assert.rejects(exportSvc.buildPaperPatternDoc(instA, adminMem.id, adminUser.id, bPattern), NotFoundException, 'foreign pattern is 404');
    await assert.rejects(exportSvc.buildQuestionPaperDoc(instA, adminMem.id, adminUser.id, bQp), NotFoundException, 'foreign question-paper is 404');
    await assert.rejects(exportSvc.buildAssessmentResultsDoc(instA, adminMem.id, adminUser.id, bAssess), NotFoundException, 'foreign assessment results are 404');

    // ── MOD-3 Test 7: existing valid export behavior remains intact.
    assert.deepEqual(stemsOf(await exportSvc.buildQuestionsDoc(instA, t1Mem.id, { subjectId: s1 }, 'answers')), ['MOD-3-Q-S1']);
    assert.equal((await exportSvc.buildAssessmentDoc(instA, t1Mem.id, t1User.id, aS1, 'teacher')).title, await titleOf(assessments, aS1));
    const results = await exportSvc.buildAssessmentResultsDoc(instA, t1Mem.id, t1User.id, aS1);
    assert.equal(results.title, (await titleOf(assessments, aS1)) + ' — Results');
    assert.ok(results.blocks.some((b) => b.kind === 'table'), 'attempt ledger rendered');
  } finally {
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstitutes));
    await db!.delete(users).where(inArray(users.id, scratchUsers));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});