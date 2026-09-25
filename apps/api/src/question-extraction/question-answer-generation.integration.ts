import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  users,
  memberships,
  membershipRoles,
  roles,
  subjects,
  materials,
  questionTypes,
  questions,
  jobs,
} from '@catlium/database';

import { JobsService } from '../jobs/jobs.service.ts';
import type { RabbitMQService } from '../common/services/rabbitmq.service.ts';
import { AcademicScopeService } from '../authorization/academic-scope.service.ts';
import { QuestionTypesService } from '../questions/question-types.service.ts';
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
    await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, [membership.id]));
    await db.delete(memberships).where(inArray(memberships.id, [membership.id]));
    await db.delete(users).where(inArray(users.id, [user.id]));
    await db.delete(institutes).where(inArray(institutes.id, [inst.id]));
  });

  const types = new QuestionTypesService(svc);
  const enhancement = new MaterialEnhancementService(svc, jobsService);

  const runExtraction = async () => {
    const service = new QuestionExtractionService(
      svc, jobsService, enhancement, types, {} as unknown as never, scope,
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
    svc, jobsService, new MaterialEnhancementService(svc, jobsService), new QuestionTypesService(svc), {} as unknown as never, scope,
  ) as { requestAnswerGeneration: (i: string, m: string, u: string, j: string, q: string) => Promise<{ jobId: string; status: string; reused: boolean }> };

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

  await t.test('manual trigger reuses the active auto-enqueued generation', async () => {
    const res = await extraction.requestAnswerGeneration(inst.id, membership.id, user.id, extractionJobId, missingId);

    assert.equal(res.reused, true);
    assert.equal(res.status, 'QUEUED');
    const [only] = await answerJobs();
    assert.equal(res.jobId, only?.id, 'no duplicate job is created');
    assert.equal((await answerJobs()).length, 1);
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
    assert.equal((await answerJobs()).length, 2, 'still no new job for the completed case');
  });

  await t.test('cross-institute request is rejected before queueing', async () => {
    await assert.rejects(
      extraction.requestAnswerGeneration(randomUUID(), membership.id, user.id, extractionJobId, missingId),
      NotFoundException,
    );
  });
});