import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  users,
  memberships,
  membershipRoles,
  roles,
  subjects,
  chapters,
  topics,
  classes,
  classSubjects,
  teacherAssignments,
  materials,
  questionTypes,
  questions,
  jobs,
} from '@catlium/database';

import { JobsService } from '../jobs/jobs.service.ts';
import type { RabbitMQService } from '../common/services/rabbitmq.service.ts';
import { AcademicScopeService } from '../authorization/academic-scope.service.ts';
import { QuestionTypesService } from '../questions/question-types.service.ts';
import { QuestionsService } from '../questions/questions.service.ts';
import { MaterialEnhancementService } from '../material-enhancement/enhancement.service.ts';
import { QuestionExtractionService } from './question-extraction.service.ts';

// F3.2 — autonomous answer generation. Extraction auto-enqueues an
// AI_GENERATE_ANSWER job for every REVIEW candidate the extractor flagged
// ANSWER_MISSING, and the manual trigger reuses an existing active/completed
// generation for the same question instead of duplicating it. Requires a live
// database: run with TEST_DATABASE_URL=postgresql://... ; skips when unset.
//
// Note: subtests are kept to ONE nesting level — deeper
// `await t.test()` chains deadlock under tsx on the CI Node.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

after(async () => {
  await (db as unknown as { $client?: { end: () => Promise<void> } } | null)?.$client?.end?.();
});

const skip = testDbUrl ? false : 'TEST_DATABASE_URL not set';
const rabbitmqStub = { publish: async () => undefined } as unknown as RabbitMQService;

// Q1 carries its answer; Q2 deliberately omits "Ans:" so the extractor flags
// ANSWER_MISSING and extraction must auto-enqueue exactly one answer job.
const MIXED_TEXT = [
  '1. Which of the following is a noble gas?',
  '(a) Hydrogen',
  '(b) Helium',
  '(c) Oxygen',
  '(d) Nitrogen',
  'Ans: (b)',
  '',
  '2. What is the sum of 2 and 2?',
  '(a) Three',
  '(b) Four',
  '(c) Five',
  '(d) Six',
  '',
].join('\n');

test('F3.2 answer-generation queueing', { skip }, async (t) => {
  const svc = db as unknown as Database;
  const jobsService = new JobsService(svc, rabbitmqStub);
  const scope = new AcademicScopeService(svc);

  const suffix = randomUUID().slice(0, 8);
  const [inst] = await svc.insert(institutes).values({ name: `f32-${suffix}`, slug: `f32-${suffix}` }).returning();
  const [user] = await svc.insert(users).values({ email: `f32-${suffix}@example.test`, name: 'F3.2', passwordHash: 'x' }).returning();
  const [membership] = await svc.insert(memberships).values({ userId: user.id, instituteId: inst.id, status: 'active' }).returning();
  const [adminRole] = await svc.select({ id: roles.id }).from(roles).where(eq(roles.key, 'INSTITUTE_ADMIN')).limit(1);
  if (!adminRole) throw new Error('INSTITUTE_ADMIN role not seeded in the test database');
  await svc.insert(membershipRoles).values({ membershipId: membership!.id, roleId: adminRole!.id });
  const [teacherRole] = await svc.select({ id: roles.id }).from(roles).where(eq(roles.key, 'TEACHER')).limit(1);
  if (!teacherRole) throw new Error('TEACHER role not seeded in the test database');
  const [otherUser] = await svc.insert(users).values({ email: `f32-other-${suffix}@example.test`, name: 'F3.2 Other', passwordHash: 'x' }).returning();
  const [otherMembership] = await svc.insert(memberships).values({ userId: otherUser.id, instituteId: inst.id, status: 'active' }).returning();
  await svc.insert(membershipRoles).values({ membershipId: otherMembership!.id, roleId: teacherRole!.id });

  const [subject] = await svc.insert(subjects).values({ instituteId: inst.id, name: 'F3.2 Subject', slug: `f32subj-${suffix}` }).returning();
  await svc.insert(questionTypes).values({
    instituteId: inst.id,
    code: 'MCQ',
    name: 'Multiple Choice',
    answerFormat: 'MCQ',
    kind: 'OBJECTIVE',
    allowedDifficulties: ['EASY', 'MEDIUM', 'HARD'],
    active: true,
    createdBy: user.id,
    updatedBy: user.id,
  });

  const scratchJobs: string[] = [];
  const scratchQuestions: string[] = [];

  t.after(async () => {
    if (!db) return;
    if (scratchQuestions.length > 0) await db.delete(questions).where(inArray(questions.id, scratchQuestions));
    if (scratchJobs.length > 0) await db.delete(jobs).where(inArray(jobs.id, scratchJobs));
    await db.delete(questionTypes).where(eq(questionTypes.instituteId, inst.id));
    await db.delete(materials).where(eq(materials.instituteId, inst.id));
    await db.delete(subjects).where(inArray(subjects.id, [subject.id]));
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, [membership.id, otherMembership.id]));
    await db.delete(memberships).where(inArray(memberships.id, [membership.id, otherMembership.id]));
    await db.delete(users).where(inArray(users.id, [user.id, otherUser.id]));
    await db.delete(institutes).where(inArray(institutes.id, [inst.id]));
  });

  const types = new QuestionTypesService(svc);
  const questionService = new QuestionsService(svc, types, scope);
  const enhancement = new MaterialEnhancementService(svc, jobsService);

  const runExtraction = async () => {
    const service = new QuestionExtractionService(
      svc, jobsService, enhancement, types, questionService, scope,
    ) as unknown as { processJob(jobId: string, instituteId: string, payload: unknown, createdBy: string | null): Promise<void> };

    const [material] = await svc
      .insert(materials)
      .values({
        instituteId: inst.id,
        subjectId: subject.id,
        title: 'F3.2 material',
        materialType: 'QUESTION_PAPER',
        sourceType: 'TEXT',
        textContent: MIXED_TEXT,
        processingStatus: 'READY',
        revision: 1,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    t.after(() => db!.delete(materials).where(inArray(materials.id, [material!.id])));

    const job = await jobsService.insertJob(
      inst.id,
      'QUESTION_EXTRACT',
      { materialId: material!.id, subjectId: subject.id },
      user.id,
    );
    scratchJobs.push(job.id);
    await service.processJob(job.id, inst.id, job.payload, job.createdBy);
    return await jobsService.getJob(job.id, inst.id);
  };

  const candidates = async (jobId: string) =>
    svc
      .select({ id: questions.id, stem: questions.stem })
      .from(questions)
      .where(
        and(
          eq(questions.instituteId, inst.id),
          eq(questions.status, 'REVIEW'),
          eq(questions.source, 'EXTRACTED'),
          sql`${questions.provenance}->>'jobId' = ${jobId}`,
          isNull(questions.deletedAt),
        ),
      );

  const answerJobs = async () =>
    svc
      .select({ id: jobs.id, status: jobs.status, payload: jobs.payload, createdBy: jobs.createdBy })
      .from(jobs)
      .where(and(eq(jobs.instituteId, inst.id), eq(jobs.type, 'AI_GENERATE_ANSWER')));

  const extraction = new QuestionExtractionService(
    svc, jobsService, enhancement, types, questionService, scope,
  );

  let extractionJobId = '';
  let missingId = '';
  let answeredId = '';

  await t.test('extraction auto-enqueues one answer job for the ANSWER_MISSING candidate', async () => {
    const extractionJob = await runExtraction();
    extractionJobId = extractionJob.id;

    assert.equal(extractionJob.status, 'completed');
    const result = (extractionJob.result ?? {}) as Record<string, unknown>;
    assert.equal(result.candidateCount, 2);
    assert.equal(result.answerJobsEnqueued, 1, 'exactly the ANSWER_MISSING candidate enqueues');
    const persisted = await candidates(extractionJob.id);
    assert.equal(persisted.length, 2);
    scratchQuestions.push(...persisted.map((r) => r.id));

    const missing = persisted.find((r) => r.stem.includes('sum of 2 and 2'));
    const answered = persisted.find((r) => r.stem.includes('noble gas'));
    assert.ok(missing && answered, 'both candidates persisted');
    missingId = missing!.id;
    answeredId = answered!.id;

    const rows = await answerJobs();
    assert.equal(rows.length, 1, 'only the missing answer triggers generation');
    const src = (rows[0]?.payload ?? {}) as { operation?: string; source?: { type?: string; id?: string; }; requestedBy?: string };
    assert.equal(rows[0]?.status, 'queued');
    assert.equal(src.operation, 'AI_GENERATE_ANSWER');
    assert.equal(src.source?.type, 'QUESTION');
    assert.equal(src.source?.id, missingId);
    assert.equal(src.requestedBy, user.id);
    // The owned job row must be removed on cleanup even before its user row.
    scratchJobs.push(rows[0]!.id);
  });

  await t.test('review edits preserve and resolve unscoped question-paper candidates', async () => {
    const [unscoped] = await svc
      .insert(questions)
      .values({
        instituteId: inst.id,
        subjectId: null,
        stem: 'Unscoped review candidate',
        questionType: 'MCQ',
        answerFormat: 'MCQ',
        payload: {
          choices: [
            { id: 'unscoped-a', text: 'First' },
            { id: 'unscoped-b', text: 'Second' },
          ],
          correctChoiceId: 'unscoped-b',
        },
        source: 'EXTRACTED',
        provenance: { jobId: extractionJobId, issues: [] },
        status: 'REVIEW',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    assert.ok(unscoped);
    scratchQuestions.push(unscoped!.id);

    const updated = await extraction.updateCandidate(
      inst.id,
      membership.id,
      user.id,
      extractionJobId,
      unscoped!.id,
      { explanation: 'Reviewed without an academic scope.', chapterId: null, topicId: null },
    );
    assert.equal(updated.explanation, 'Reviewed without an academic scope.');
    assert.equal(updated.subjectId, null);

    const [chapter] = await svc
      .insert(chapters)
      .values({ subjectId: subject.id, name: 'F3.2 Chapter', slug: `f32chap-${suffix}` })
      .returning();
    const [topic] = await svc
      .insert(topics)
      .values({ chapterId: chapter!.id, name: 'F3.2 Topic', slug: `f32topic-${suffix}` })
      .returning();
    const scoped = await extraction.updateCandidate(
      inst.id,
      membership.id,
      user.id,
      extractionJobId,
      unscoped!.id,
      { topicId: topic!.id },
    );
    assert.equal(scoped.subjectId, subject.id);
    assert.equal(scoped.chapterId, chapter!.id);
    assert.equal(scoped.topicId, topic!.id);

    const subjectOnly = await extraction.updateCandidate(
      inst.id,
      membership.id,
      user.id,
      extractionJobId,
      unscoped!.id,
      { chapterId: null, topicId: null },
    );
    assert.equal(subjectOnly.subjectId, subject.id);
    assert.equal(subjectOnly.chapterId, null);
    assert.equal(subjectOnly.topicId, null);
  });

  await t.test('does not enqueue generation for an already-valid answer', async () => {
    await assert.rejects(
      extraction.requestAnswerGeneration(
        inst.id,
        membership.id,
        user.id,
        extractionJobId,
        answeredId,
      ),
      BadRequestException,
    );
    assert.equal((await answerJobs()).length, 1);
  });

  await t.test('a non-admin owner can clear scope on an unscoped candidate', async () => {
    const ownedJob = await jobsService.insertJob(
      inst.id,
      'QP_EXTRACT',
      { paperId: randomUUID() },
      otherUser.id,
    );
    scratchJobs.push(ownedJob.id);
    const [ownedQuestion] = await svc
      .insert(questions)
      .values({
        instituteId: inst.id,
        subjectId: null,
        stem: 'Owned unscoped review candidate',
        questionType: 'MCQ',
        answerFormat: 'MCQ',
        payload: {
          choices: [
            { id: 'owned-a', text: 'First' },
            { id: 'owned-b', text: 'Second' },
          ],
          correctChoiceId: 'owned-b',
        },
        source: 'EXTRACTED',
        provenance: { jobId: ownedJob.id, issues: [] },
        status: 'REVIEW',
        createdBy: otherUser.id,
        updatedBy: otherUser.id,
      })
      .returning();
    assert.ok(ownedQuestion);
    scratchQuestions.push(ownedQuestion!.id);

    const updated = await extraction.updateCandidate(
      inst.id,
      otherMembership.id,
      otherUser.id,
      ownedJob.id,
      ownedQuestion!.id,
      { explanation: 'Reviewed without an academic scope.', chapterId: null, topicId: null },
    );
    assert.equal(updated.explanation, 'Reviewed without an academic scope.');
    assert.equal(updated.subjectId, null);

    const [scopeClass] = await svc
      .insert(classes)
      .values({ instituteId: inst.id, name: `F3.2 Scope Class ${suffix}` })
      .returning();
    const [scopeOffering] = await svc
      .insert(classSubjects)
      .values({ classId: scopeClass!.id, subjectId: subject.id })
      .returning();
    const [assignment] = await svc
      .insert(teacherAssignments)
      .values({
        instituteId: inst.id,
        classSubjectId: scopeOffering!.id,
        membershipId: otherMembership.id,
      })
      .returning();
    const [scopeChapter] = await svc
      .insert(chapters)
      .values({ subjectId: subject.id, name: 'F3.2 Owner Chapter', slug: `f32owner-${suffix}` })
      .returning();

    const assigned = await extraction.updateCandidate(
      inst.id,
      otherMembership.id,
      otherUser.id,
      ownedJob.id,
      ownedQuestion!.id,
      { chapterId: scopeChapter!.id },
    );
    assert.equal(assigned.subjectId, subject.id);
    assert.equal(assigned.chapterId, scopeChapter!.id);

    await svc.delete(teacherAssignments).where(eq(teacherAssignments.id, assignment!.id));
    const visible = await extraction.listCandidates(
      inst.id,
      otherMembership.id,
      otherUser.id,
      ownedJob.id,
    );
    assert.equal(visible.candidates.length, 0);
    await assert.rejects(
      extraction.updateCandidate(
        inst.id,
        otherMembership.id,
        otherUser.id,
        ownedJob.id,
        ownedQuestion!.id,
        { explanation: 'Should be denied after losing scope.' },
      ),
      ForbiddenException,
    );
  });

  await t.test('manual trigger reuses the active auto-enqueued generation', async () => {
    const res = await extraction.requestAnswerGeneration(inst.id, membership.id, user.id, extractionJobId, missingId);

    assert.equal(res.reused, true);
    assert.equal(res.status, 'QUEUED');
    const [only] = await answerJobs();
    assert.equal(res.jobId, only?.id, 'no duplicate job is created');
    assert.equal((await answerJobs()).length, 1);
  });

  await t.test('a failed generation is retried with a fresh job', async () => {
    const [failed] = await answerJobs();
    assert.ok(failed);
    await jobsService.updateJobStatus(failed.id, 'failed', undefined, {
      message: 'provider failed',
    });

    const res = await extraction.requestAnswerGeneration(
      inst.id,
      membership.id,
      user.id,
      extractionJobId,
      missingId,
    );

    assert.equal(res.reused, false);
    assert.equal(res.status, 'QUEUED');
    assert.notEqual(res.jobId, failed.id);
    scratchJobs.push(res.jobId);
    assert.equal((await answerJobs()).length, 2);
  });

  await t.test('a completed generation is reused and reported COMPLETED', async () => {
    const done = await jobsService.insertJob(
      inst.id,
      'AI_GENERATE_ANSWER',
      { operation: 'AI_GENERATE_ANSWER', source: { type: 'QUESTION', id: answeredId }, requestedBy: user.id },
      user.id,
    );
    scratchJobs.push(done.id);
    await jobsService.updateJobStatus(done.id, 'completed', undefined, { questionId: answeredId, superseded: false });

    const res = await extraction.requestAnswerGeneration(inst.id, membership.id, user.id, extractionJobId, answeredId);

    assert.equal(res.reused, true);
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.jobId, done.id);
    assert.equal((await answerJobs()).length, 3, 'still no new job for the completed case');
  });

  await t.test('an invalid edit gets a fresh generation instead of reusing a completed job', async () => {
    const invalid = await extraction.updateCandidate(
      inst.id,
      membership.id,
      user.id,
      extractionJobId,
      answeredId,
      {
        payload: {
          choices: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctChoiceId: 'missing',
        },
      },
    );
    assert.equal(invalid.payload['correctChoiceId'], 'missing');

    const res = await extraction.requestAnswerGeneration(
      inst.id,
      membership.id,
      user.id,
      extractionJobId,
      answeredId,
    );
    assert.equal(res.reused, false);
    assert.equal(res.status, 'QUEUED');
    const completed = (await answerJobs()).find((row) => row.status === 'completed');
    assert.ok(completed);
    assert.notEqual(res.jobId, completed!.id);
    scratchJobs.push(res.jobId);

    await extraction.updateCandidate(
      inst.id,
      membership.id,
      user.id,
      extractionJobId,
      answeredId,
      {
        payload: {
          choices: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctChoiceId: 'b',
        },
      },
    );
  });

  await t.test('a teacher outside the subject scope cannot request generation', async () => {
    const before = (await answerJobs()).length;
    await assert.rejects(
      extraction.requestAnswerGeneration(
        inst.id,
        otherMembership.id,
        otherUser.id,
        extractionJobId,
        missingId,
      ),
      ForbiddenException,
    );
    assert.equal((await answerJobs()).length, before);
  });

  await t.test('accept and import reject an invalid generated-answer candidate', async () => {
    await assert.rejects(
      extraction.acceptCandidate(inst.id, membership.id, user.id, extractionJobId, missingId),
      BadRequestException,
    );
    const [stillReview] = await svc
      .select({ status: questions.status })
      .from(questions)
      .where(eq(questions.id, missingId))
      .limit(1);
    assert.equal(stillReview?.status, 'REVIEW');

    const result = await extraction.importAll(inst.id, membership.id, user.id, extractionJobId);
    assert.equal(result.imported, 2, 'the already-valid candidates import');
    assert.deepEqual(
      result.skipped.map((row) => row.questionId),
      [missingId],
    );
  });

  await t.test('cross-institute request is rejected before queueing', async () => {
    await assert.rejects(
      extraction.requestAnswerGeneration(randomUUID(), membership.id, user.id, extractionJobId, missingId),
      NotFoundException,
    );
  });
});