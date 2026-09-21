import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  classes,
  subjects,
  classSubjects,
  teacherAssignments,
  contentItems,
  contentVersions,
  questions,
  questionPapers,
  assessments,
  users,
  memberships,
  membershipRoles,
  roles,
} from '@catlium/database';

import { AcademicScopeService } from './academic-scope.service.ts';
import { ContentService } from '../content/content.service.ts';
import { QuestionsService } from '../questions/questions.service.ts';
import { QuestionTypesService } from '../questions/question-types.service.ts';
import { ExaminationsService } from '../examinations/examinations.service.ts';
import { QuestionPapersService } from '../question-papers/question-papers.service.ts';

// Phase I resource-gate integration test (R7/§18). Requires a live database:
// run with TEST_DATABASE_URL=postgresql://... which uses the `test:resource-scope`
// script; skips when unset. Role seeds come from migration 0039.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

test('resource scope: content/questions/papers/assessments O1+O2 gates', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const scope = new AcademicScopeService(svc);

  // Dependent services are stubbed — none are invoked by the exercised gates.
  const generationsStub = {} as unknown as import('../questions/question-generation.service.ts').QuestionGenerationService;

  const contentSvc = new ContentService(svc, scope);
  const questionsSvc = new QuestionsService(svc, new QuestionTypesService(svc), scope);
  const examsSvc = new ExaminationsService(svc, scope);
  const papersSvc = new QuestionPapersService(svc, examsSvc, generationsStub, scope);

  const scratchInstituteIds: string[] = [];
  const scratchUserIds: string[] = [];

  try {
    const [inst] = await db!.insert(institutes).values({ name: randomUUID(), slug: `r7-${randomUUID()}` }).returning();
    scratchInstituteIds.push(inst.id);

    const subj = async (name: string) => {
      const [s] = await db!.insert(subjects).values({ instituteId: inst.id, name, slug: randomUUID() }).returning();
      return s.id;
    };
    const s1 = await subj('Resource Subject 1');
    const s2 = await subj('Resource Subject 2');

    const roleId = async (key: string) => {
      const [r] = await db!.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
      if (!r) throw new Error(`${key} role not seeded`);
      return r.id;
    };

    const member = async (name: string, roleKey: string) => {
      const [user] = await db!.insert(users).values({ email: randomUUID(), name, passwordHash: 'x' }).returning();
      scratchUserIds.push(user.id);
      const [m] = await db!.insert(memberships).values({ userId: user.id, instituteId: inst.id, status: 'active' }).returning();
      await db!.insert(membershipRoles).values({ membershipId: m.id, roleId: await roleId(roleKey) });
      return { userId: user.id, membershipId: m.id };
    };

    const teacher1 = await member('Resource T1', 'TEACHER');
    const teacher2 = await member('Resource T2', 'TEACHER');
    const admin = await member('Resource Admin', 'INSTITUTE_ADMIN');

    // Teacher 1 teaches s1 only; teacher 2 teaches s2 only.
    const [cls] = await db!.insert(classes).values({ instituteId: inst.id, name: 'Resource Class' }).returning();
    const [off1] = await db!.insert(classSubjects).values({ classId: cls.id, subjectId: s1 }).returning();
    const [off2] = await db!.insert(classSubjects).values({ classId: cls.id, subjectId: s2 }).returning();
    await db!.insert(teacherAssignments).values({ instituteId: inst.id, classSubjectId: off1.id, membershipId: teacher1.membershipId });
    await db!.insert(teacherAssignments).values({ instituteId: inst.id, classSubjectId: off2.id, membershipId: teacher2.membershipId });
    assert.deepEqual(await scope.resolveScope(inst.id, teacher1.membershipId), { kind: 'subject-set', subjectIds: [s1] });
    assert.deepEqual(await scope.resolveScope(inst.id, teacher2.membershipId), { kind: 'subject-set', subjectIds: [s2] });

    const contentOf = async (subjectId: string | null, status: string, createdBy: string) => {
      const [item] = await db!.insert(contentItems).values({
        instituteId: inst.id,
        subjectId,
        type: 'NOTE',
        title: randomUUID(),
        source: 'MANUAL',
        currentVersion: 1,
        status,
        createdBy,
        updatedBy: createdBy,
      }).returning();
      await db!.insert(contentVersions).values({
        contentId: item!.id,
        version: 1,
        payload: { text: 'x' },
        changeType: 'CREATION',
        createdBy,
      });
      return item!.id;
    };

    // ── Content: DRAFT owner+admin (O1), ACTIVE pure scope (O2) ─────
    const t1DraftS1 = await contentOf(s1, 'DRAFT', teacher1.userId);
    const t1ActiveS1 = await contentOf(s1, 'ACTIVE', teacher1.userId);
    const t2DraftS2 = await contentOf(s2, 'DRAFT', teacher2.userId);
    const t2ActiveS2 = await contentOf(s2, 'ACTIVE', teacher2.userId);
    const adminNull = await contentOf(null, 'ACTIVE', admin.userId);

    // Owner can read own non-admin-scoped DRAFT (s1); owner's s1 DRAFT visible to admin.
    assert.equal((await contentSvc.getContent(inst.id, teacher1.membershipId, teacher1.userId, t1DraftS1)).item.id, t1DraftS1);
    // DRAFT outside scope readonly → 404
    await assert.rejects(contentSvc.getContent(inst.id, teacher2.membershipId, teacher2.userId, t1DraftS1), NotFoundException);
    // DRAFT in-scope but another's → 404 (O1)
    const [otherDraft] = await db!.insert(contentItems).values({
      instituteId: inst.id, subjectId: s1, type: 'NOTE', title: randomUUID(), source: 'MANUAL',
      currentVersion: 1, status: 'DRAFT', createdBy: teacher2.userId, updatedBy: teacher2.userId,
    }).returning();
    await assert.rejects(contentSvc.getContent(inst.id, teacher1.membershipId, teacher1.userId, otherDraft!.id), NotFoundException);
    // ACTIVE in-scope read ok; out-of-scope → 404
    assert.equal((await contentSvc.getContent(inst.id, teacher1.membershipId, teacher1.userId, t1ActiveS1)).item.id, t1ActiveS1);
    await assert.rejects(contentSvc.getContent(inst.id, teacher1.membershipId, teacher1.userId, t2ActiveS2), NotFoundException);
    // Null-subject admin-only
    assert.equal((await contentSvc.getContent(inst.id, admin.membershipId, admin.userId, adminNull)).item.id, adminNull);
    await assert.rejects(contentSvc.getContent(inst.id, teacher1.membershipId, teacher1.userId, adminNull), NotFoundException);
    // List: teacher1 sees own ACTIVE + own DRAFT, not teacher2 DRAFT
    const t1List = await contentSvc.listContent(inst.id, teacher1.membershipId, teacher1.userId, {});
    const t1Ids = t1List.map((i) => i.id).sort();
    assert.ok(t1Ids.includes(t1DraftS1) && t1Ids.includes(t1ActiveS1) && !t1Ids.includes(t2DraftS2));
    assert.ok(!t1Ids.includes(adminNull));
    // Admin sees everything
    const adminList = await contentSvc.listContent(inst.id, admin.membershipId, admin.userId, {});
    assert.ok(adminList.map((i) => i.id).includes(adminNull));
    // Mutating another's DRAFT → 403
    await assert.rejects(contentSvc.updateContent(inst.id, teacher1.membershipId, teacher1.userId, t2DraftS2, { payload: { text: 'y' } }), ForbiddenException);
    // Create outside writable scope → 403
    await assert.rejects(
      contentSvc.createContent(inst.id, teacher1.membershipId, teacher1.userId, { type: 'NOTE', title: 't', source: 'MANUAL', subjectId: s2, payload: { blocks: [{ id: randomUUID(), type: 'paragraph', content: 'x' }] } }),
      ForbiddenException,
    );

    // ── Questions: PENDING/REVIEW owner+scope (O1), list hides other's staging ─
    const questionOf = async (subjectId: string | null, approvalStatus: string, status: string, createdBy: string) => {
      const [q] = await db!.insert(questions).values({
        instituteId: inst.id, subjectId, stem: randomUUID(), questionType: 'MCQ_SINGLE',
        answerFormat: 'single-choice', difficulty: 'MEDIUM', payload: { options: ['a', 'b'], correctIndex: 0 },
        approvalStatus, status, createdBy, updatedBy: createdBy,
      }).returning();
      return q!.id;
    };
    const t1PendingS1 = await questionOf(s1, 'PENDING', 'ACTIVE', teacher1.userId);
    const t2PendingS1 = await questionOf(s1, 'PENDING', 'ACTIVE', teacher2.userId);
    const t1ApprovedS1 = await questionOf(s1, 'APPROVED', 'ACTIVE', teacher1.userId);
    const approvedS2 = await questionOf(s2, 'APPROVED', 'ACTIVE', teacher1.userId);

    assert.equal((await questionsSvc.getQuestion(inst.id, teacher1.membershipId, teacher1.userId, t1PendingS1)).id, t1PendingS1);
    await assert.rejects(questionsSvc.getQuestion(inst.id, teacher1.membershipId, teacher1.userId, t2PendingS1), NotFoundException);
    assert.equal((await questionsSvc.getQuestion(inst.id, teacher1.membershipId, teacher1.userId, t1ApprovedS1)).id, t1ApprovedS1);
    await assert.rejects(questionsSvc.getQuestion(inst.id, teacher1.membershipId, teacher1.userId, approvedS2), NotFoundException);
    const qList = await questionsSvc.listQuestions(inst.id, teacher1.membershipId, teacher1.userId, {});
    const qListIds = qList.map((q) => q.id);
    assert.ok(qListIds.includes(t1PendingS1) && !qListIds.includes(t2PendingS1));
    assert.equal(qListIds.length, 2);

    // ── Question papers: unscoped = private scaffold (owner-only), scoped = pure scope ─
    const [unscopedPaper] = await db!.insert(questionPapers).values({
      instituteId: inst.id, title: 'scaffold', createdBy: teacher1.userId, updatedBy: teacher1.userId,
    }).returning();
    const [scopedPaper] = await db!.insert(questionPapers).values({
      instituteId: inst.id, title: 'scoped', subjectId: s1, createdBy: teacher1.userId, updatedBy: teacher1.userId,
    }).returning();
    // Owner reads the scaffold; another teacher → 404 (O1 carve-out)
    assert.equal((await papersSvc.getPaper(inst.id, teacher1.membershipId, teacher1.userId, unscopedPaper!.id)).id, unscopedPaper!.id);
    await assert.rejects(papersSvc.getPaper(inst.id, teacher2.membershipId, teacher2.userId, unscopedPaper!.id), NotFoundException);
    assert.equal((await papersSvc.getPaper(inst.id, admin.membershipId, admin.userId, unscopedPaper!.id)).id, unscopedPaper!.id);
    // Scoped paper: readable within scope, 404 outside
    assert.equal((await papersSvc.getPaper(inst.id, teacher1.membershipId, teacher1.userId, scopedPaper!.id)).id, scopedPaper!.id);
    await assert.rejects(papersSvc.getPaper(inst.id, teacher2.membershipId, teacher2.userId, scopedPaper!.id), NotFoundException);
    // Mutating the scaffold: owner ok, non-owner 403; admin ok
    await assert.rejects(papersSvc.renamePaper(inst.id, teacher2.membershipId, teacher2.userId, unscopedPaper!.id, 'tamper'), ForbiddenException);
    await papersSvc.renamePaper(inst.id, teacher1.membershipId, teacher1.userId, unscopedPaper!.id, 'renamed');
    const paperList = await papersSvc.listPapers(inst.id, teacher1.membershipId, teacher1.userId);
    const paperIds = paperList.map((p) => p.id);
    assert.ok(paperIds.includes(unscopedPaper!.id) && paperIds.includes(scopedPaper!.id));
    const t2Papers = await papersSvc.listPapers(inst.id, teacher2.membershipId, teacher2.userId);
    assert.ok(!t2Papers.map((p) => p.id).includes(unscopedPaper!.id));

    // ── Assessments: DRAFT owner+admin (O1), whatever the scope; finalized pure scope ─
    const assessmentOf = async (subjectId: string, status: string, createdBy: string) => {
      const [a] = await db!.insert(assessments).values({
        instituteId: inst.id, subjectId, title: randomUUID(), status, createdBy, updatedBy: createdBy,
      }).returning();
      return a!.id;
    };
    const examDraftS1 = await assessmentOf(s1, 'DRAFT', teacher1.userId);
    const examDraftS2 = await assessmentOf(s2, 'DRAFT', teacher1.userId);
    assert.equal((await examsSvc.getAssessment(inst.id, teacher1.membershipId, teacher1.userId, examDraftS1)).id, examDraftS1);
    // DRAFT is the creator's private staging (O1) — the owner reads it even
    // when it was placed outside the current subject scope.
    assert.equal((await examsSvc.getAssessment(inst.id, teacher1.membershipId, teacher1.userId, examDraftS2)).id, examDraftS2);
    // Another teacher's in-scope DRAFT → 404 (O1)
    const examT2DraftS1 = await assessmentOf(s1, 'DRAFT', teacher2.userId);
    await assert.rejects(examsSvc.getAssessment(inst.id, teacher1.membershipId, teacher1.userId, examT2DraftS1), NotFoundException);
    // Admin bypasses all
    assert.equal((await examsSvc.getAssessment(inst.id, admin.membershipId, admin.userId, examT2DraftS1)).id, examT2DraftS1);
    // List: excludes other's DRAFT, includes own
    const examList = await examsSvc.listAssessments(inst.id, teacher1.membershipId, teacher1.userId);
    const examListIds = examList.map((a) => a.id);
    assert.ok(examListIds.includes(examDraftS1) && !examListIds.includes(examT2DraftS1));
  } finally {
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstituteIds));
    await db!.delete(users).where(inArray(users.id, scratchUserIds));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});