import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, inArray, count } from 'drizzle-orm';
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
  materials,
  ocrChunks,
  materialEnhancements,
} from '@catlium/database';

import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { TenantGuard } from '../common/guards/tenant.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { TenancyService } from '../tenancy/tenancy.service.ts';
import { AcademicScopeService } from './academic-scope.service.ts';
import { ExaminationsService } from '../examinations/examinations.service.ts';
import { ExportService } from '../export/export.service.ts';
import { PuppeteerService } from '../export/puppeteer.service.ts';
import { ExportController } from '../export/export.controller.ts';
import { JobsService } from '../jobs/jobs.service.ts';
import type { RabbitMQService } from '../common/services/rabbitmq.service.ts';
import { MaterialEnhancementService } from '../material-enhancement/enhancement.service.ts';
import { OcrCoordinatorService } from '../ocr/ocr-coordinator.service.ts';
import type { StorageProvider } from '../materials/storage/storage-provider.interface.ts';
import type { DocumentModel } from '../export/export.content-blocks.ts';

// Phase M remediation regression (HIGH-1 + MEDIUM-1). Requires a live
// database: run with TEST_DATABASE_URL via the `test:phase-m-remediation`
// script; skips when unset. Locks in the two Phase M findings:
//   1. HIGH-1 — export answer-key routes are gated to INSTITUTE_ADMIN/TEACHER,
//      and both export builders enforce academic scope (teacher subject scope
//      via AcademicScopeService, assessment read via ExaminationsService).
//   2. MEDIUM-1 — job-material lookups in the OCR/enhancement sweeps are
//      tenant-scoped; a foreign institute's material id in a job payload can
//      never be adopted/processed.
// NOTE: the sweeps adopt queued jobs GLOBALLY by type, so run against a
// database with no other in-flight MATERIAL_PROCESS/MATERIAL_ENHANCE jobs.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const JWT = new JwtService({ secret: 'phase-m-remediation-secret', signOptions: { algorithm: 'HS256' } });
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

test('Phase M: export role gate + academic scope; job tenant isolation', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const scope = new AcademicScopeService(svc);
  const examsSvc = new ExaminationsService(svc, scope);
  const puppetStub = { pdf: async () => Buffer.alloc(0) } as unknown as PuppeteerService;
  const exportSvc = new ExportService(svc, puppetStub, scope, examsSvc);
  const jobsService = new JobsService(svc, {} as unknown as RabbitMQService);
  const enhancementsSvc = new MaterialEnhancementService(svc, jobsService);

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
      refreshTokenHash: `phase-m-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    return row!.id;
  };

  try {
    // ── Test 1 (HIGH-1 · route gate): student is refused the export/preview
    //    routes (including the answer-key include=answers form); teacher passes.
    const inst = await makeInstitute('phase-m-gate');
    const teacher = await makeUser('Phase M Gate Teacher');
    const student = await makeUser('Phase M Gate Student');
    await makeMembership(teacher.id, inst, ['TEACHER']);
    await makeMembership(student.id, inst, ['STUDENT']);
    const teacherSid = await makeSession(teacher.id);
    const studentSid = await makeSession(student.id);

    const asStudent = async (handler: AnyHandler) =>
      authnAuthz(handler, {
        headers: { 'x-institute-id': inst },
        cookies: { access_token: await sign(student.id, studentSid) },
      });
    const asTeacher = async (handler: AnyHandler) =>
      authnAuthz(handler, {
        headers: { 'x-institute-id': inst },
        cookies: { access_token: await sign(teacher.id, teacherSid) },
      });

    const roles = new RolesGuard(new Reflector());
    const exportRoutes: AnyHandler[] = [
      ExportController.prototype.exportQuestions as AnyHandler,
      ExportController.prototype.previewQuestions as AnyHandler,
      ExportController.prototype.exportAssessment as AnyHandler,
      ExportController.prototype.previewAssessment as AnyHandler,
    ];
    for (const handler of exportRoutes) {
      const studentCtx = await asStudent(handler);
      assert.throws(() => roles.canActivate(studentCtx), ForbiddenException, `${handler.name} refused to student`);
      const teacherCtx = await asTeacher(handler);
      assert.equal(roles.canActivate(teacherCtx), true, `${handler.name} allowed for teacher`);
    }
    // Control: the results routes were already gated pre-Phase M.
    const resultsTeacher = await asTeacher(ExportController.prototype.exportAssessmentResults as AnyHandler);
    assert.equal(roles.canActivate(resultsTeacher), true);
    const resultsStudent = await asStudent(ExportController.prototype.exportAssessmentResults as AnyHandler);
    assert.throws(() => roles.canActivate(resultsStudent), ForbiddenException);

    // ── Test 2 (HIGH-1 · scope enforcement): teacher exports only within
    //    assigned academic scope; assessments gate through ExaminationsService.
    const instB = await makeInstitute('phase-m-scope');
    const subj = async () => {
      const [s] = await db!.insert(subjects).values({ instituteId: instB, name: randomUUID(), slug: randomUUID() }).returning();
      return s!.id;
    };
    const s1 = await subj();
    const s2 = await subj();
    const t1User = await makeUser('Phase M Scope T1');
    const t2User = await makeUser('Phase M Scope T2');
    const adminUser = await makeUser('Phase M Scope Admin');
    const t1Mem = await makeMembership(t1User.id, instB, ['TEACHER']);
    const t2Mem = await makeMembership(t2User.id, instB, ['TEACHER']);
    const adminMem = await makeMembership(adminUser.id, instB, ['INSTITUTE_ADMIN']);

    const [cls] = await db!.insert(classes).values({ instituteId: instB, name: 'Scope Class' }).returning();
    const [off1] = await db!.insert(classSubjects).values({ classId: cls!.id, subjectId: s1 }).returning();
    const [off2] = await db!.insert(classSubjects).values({ classId: cls!.id, subjectId: s2 }).returning();
    await db!.insert(teacherAssignments).values({ instituteId: instB, classSubjectId: off1!.id, membershipId: t1Mem.id });
    await db!.insert(teacherAssignments).values({ instituteId: instB, classSubjectId: off2!.id, membershipId: t2Mem.id });
    assert.deepEqual(await scope.resolveScope(instB, t1Mem.id), { kind: 'subject-set', subjectIds: [s1] });
    assert.deepEqual(await scope.resolveScope(instB, t2Mem.id), { kind: 'subject-set', subjectIds: [s2] });

    const questionOf = async (subjectId: string, stem: string) => {
      const [q] = await db!.insert(questions).values({
        instituteId: instB, subjectId, stem, questionType: 'MCQ_SINGLE', answerFormat: 'single-choice',
        difficulty: 'MEDIUM', payload: { options: ['a', 'b'], correctIndex: 0 }, approvalStatus: 'APPROVED',
        status: 'ACTIVE', createdBy: t1User.id, updatedBy: t1User.id,
      }).returning();
      return q!.id;
    };
    await questionOf(s1, 'Phase-M-S1-STEM');
    await questionOf(s2, 'Phase-M-S2-STEM');

    // t1 (s1 scope) exports s1 answers; t2 (s2 scope) is filtered out of s1.
    const t1Doc = await exportSvc.buildQuestionsDoc(instB, t1Mem.id, { subjectId: s1 }, 'answers');
    assert.deepEqual(stemsOf(t1Doc), ['Phase-M-S1-STEM']);
    const t2DocS1 = await exportSvc.buildQuestionsDoc(instB, t2Mem.id, { subjectId: s1 }, 'answers');
    assert.deepEqual(stemsOf(t2DocS1), [], 'teacher outside the subject sees none of its questions');
    // Whole-bank export is scoped too: t1 sees only s1, t2 only s2.
    assert.deepEqual(stemsOf(await exportSvc.buildQuestionsDoc(instB, t1Mem.id, {}, 'answers')), ['Phase-M-S1-STEM']);
    assert.deepEqual(stemsOf(await exportSvc.buildQuestionsDoc(instB, t2Mem.id, {}, 'answers')), ['Phase-M-S2-STEM']);
    // Admin (whole-institute) sees the entire bank.
    assert.deepEqual(new Set(stemsOf(await exportSvc.buildQuestionsDoc(instB, adminMem.id, {}, 'answers'))), new Set(['Phase-M-S1-STEM', 'Phase-M-S2-STEM']));

    const assessmentOf = async (subjectId: string, title: string) => {
      const [a] = await db!.insert(assessments).values({
        instituteId: instB, subjectId, title, status: 'ACTIVE', createdBy: t1User.id, updatedBy: t1User.id,
      }).returning();
      return a!.id;
    };
    const aS1 = await assessmentOf(s1, 'Phase-M-Assessment-S1');
    const aS2 = await assessmentOf(s2, 'Phase-M-Assessment-S2');

    assert.equal((await exportSvc.buildAssessmentDoc(instB, t1Mem.id, t1User.id, aS1, 'teacher')).title, 'Phase-M-Assessment-S1');
    await assert.rejects(
      exportSvc.buildAssessmentDoc(instB, t2Mem.id, t2User.id, aS1, 'teacher'),
      NotFoundException,
      'assessment outside scope is denied (404, no existence leak)',
    );
    await assert.rejects(
      exportSvc.buildAssessmentDoc(instB, t1Mem.id, t1User.id, aS2, 'teacher'),
      NotFoundException,
    );
    assert.equal((await exportSvc.buildAssessmentDoc(instB, adminMem.id, adminUser.id, aS1, 'teacher')).title, 'Phase-M-Assessment-S1');

    // ── Test 3 (MEDIUM-1 · MATERIAL_PROCESS): a cross-institute job payload
    //    cannot adopt another institute's material.
    const instC = await makeInstitute('phase-m-proc');
    const instD = await makeInstitute('phase-m-foreign');
    const foreignSubj = async (instituteId: string) => {
      const [s] = await db!.insert(subjects).values({ instituteId, name: randomUUID(), slug: randomUUID() }).returning();
      return s!.id;
    };
    const sForeign = await foreignSubj(instD);
    const sLocal = await foreignSubj(instC);
    const procUser = await makeUser('Phase M Proc Owner');
    const [foreignMat] = await db!.insert(materials).values({
      instituteId: instD, subjectId: sForeign, title: 'Foreign Proc Material', materialType: 'PDF',
      sourceType: 'UPLOAD', fileName: 'foreign.pdf', storageKey: 'phase-m/foreign.pdf', createdBy: procUser.id,
      processingStatus: 'QUEUED',
    }).returning();
    const [localMat] = await db!.insert(materials).values({
      instituteId: instC, subjectId: sLocal, title: 'Local Proc Material', materialType: 'PDF',
      sourceType: 'UPLOAD', fileName: 'local.pdf', storageKey: 'phase-m/local.pdf', createdBy: procUser.id,
      processingStatus: 'QUEUED',
    }).returning();

    const storage: StorageProvider = { save: async () => undefined, read: async () => Buffer.alloc(0), delete: async () => undefined };
    const coordinator = new OcrCoordinatorService(svc, jobsService, enhancementsSvc, storage, scope);
    const foreignProcJob = await jobsService.insertJob(instC, 'MATERIAL_PROCESS', { materialId: foreignMat!.id });
    const localProcJob = await jobsService.insertJob(instC, 'MATERIAL_PROCESS', { materialId: localMat!.id });

    await coordinator.sweep();

    const localMaterial = (await db!.select({ processingStatus: materials.processingStatus }).from(materials).where(eq(materials.id, localMat!.id)).limit(1))[0]!;
    const foreignMaterial = (await db!.select({ processingStatus: materials.processingStatus }).from(materials).where(eq(materials.id, foreignMat!.id)).limit(1))[0]!;
    assert.equal((await jobsService.getJob(foreignProcJob.id, instC)).status, 'queued', 'cross-institute job never adopted');
    assert.equal(foreignMaterial.processingStatus, 'QUEUED', 'foreign material untouched');
    assert.equal(await db!.select({ n: count() }).from(ocrChunks).where(eq(ocrChunks.jobId, foreignProcJob.id)).then(rows => rows[0]!.n), 0, 'no chunks materialized for cross-institute job');

    const localJob = await jobsService.getJob(localProcJob.id, instC);
    assert.equal(localJob.status, 'processing', 'same-institute job adopted normally');
    assert.equal(localMaterial.processingStatus, 'PROCESSING');

    // ── Test 4 (MEDIUM-1 · MATERIAL_ENHANCE): same isolation for enhance.
    const [readyMat] = await db!.insert(materials).values({
      instituteId: instD, subjectId: sForeign, title: 'Foreign Ready Material', materialType: 'TEXT',
      sourceType: 'TEXT', textContent: 'raw extracted text', createdBy: procUser.id,
      processingStatus: 'READY',
    }).returning();
    const foreignEnhanceJob = await jobsService.insertJob(instC, 'MATERIAL_ENHANCE', { materialId: readyMat!.id });

    await enhancementsSvc.sweep();

    const failedJob = await jobsService.getJob(foreignEnhanceJob.id, instC);
    assert.equal(failedJob.status, 'failed', 'cross-institute MATERIAL_ENHANCE fails, never processes');
    assert.match(String((failedJob.error as { message?: string } | null)?.message ?? ''), /Material not found/);
    const enhancements = await db!.select({ n: count() }).from(materialEnhancements).where(eq(materialEnhancements.materialId, readyMat!.id));
    assert.equal(enhancements[0]!.n, 0, 'no enhancement written for the foreign material');
  } finally {
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstitutes));
    await db!.delete(users).where(inArray(users.id, scratchUsers));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});