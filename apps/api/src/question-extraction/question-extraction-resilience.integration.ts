import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  users,
  memberships,
  subjects,
  materials,
  questionTypes,
  questionPapers,
  questions,
  jobs,
} from '@catlium/database';

import { JobsService } from '../jobs/jobs.service.ts';
import type { RabbitMQService } from '../common/services/rabbitmq.service.ts';
import { AcademicScopeService } from '../authorization/academic-scope.service.ts';
import { QuestionTypesService } from '../questions/question-types.service.ts';
import { MaterialEnhancementService } from '../material-enhancement/enhancement.service.ts';
import { QuestionExtractionService } from './question-extraction.service.ts';
import { QuestionPaperExtractionService } from '../question-papers/question-paper-extraction.service.ts';

// RC-2 regression — batch extraction resilience. A single unresolvable
// candidate (e.g. an answer format no question type covers) must not abort the
// whole run: the job completes, valid candidates persist, the failed ones land
// in result.unresolvedQuestions, and no invalid row is created. Requires a live
// database: run with TEST_DATABASE_URL=postgresql://... ; skips when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

after(async () => {
  await (db as unknown as { $client?: { end: () => Promise<void> } } | null)?.$client?.end?.();
});

const skip = testDbUrl ? false : 'TEST_DATABASE_URL not set';
const rabbitmqStub = { publish: async () => undefined } as unknown as RabbitMQService;

// One valid MCQ + one unresolvable TRUE_FALSE (only an MCQ type is registered).
const MIXED_TEXT = [
  '1. Which of the following is a noble gas?',
  '(a) Hydrogen',
  '(b) Helium',
  '(c) Oxygen',
  '(d) Nitrogen',
  'Ans: (b)',
  '',
  '2. State True or False: The sun rises in the west.',
  'Ans: False',
].join('\n');

test('RC-2 extraction batch resilience', { skip }, async (t) => {
  const svc = db as unknown as Database;
  const jobsService = new JobsService(svc, rabbitmqStub);
  const scope = new AcademicScopeService(svc);
  const types = new QuestionTypesService(svc);
  const enhancement = new MaterialEnhancementService(svc, jobsService);

  const suffix = randomUUID().slice(0, 8);
  const [inst] = await svc.insert(institutes).values({ name: `rc2-${suffix}`, slug: `rc2-${suffix}` }).returning();
  const [user] = await svc.insert(users).values({ email: `rc2-${suffix}@example.test`, name: 'RC2', passwordHash: 'x' }).returning();
  await svc.insert(memberships).values({ userId: user.id, instituteId: inst.id, status: 'active' });
  const [subject] = await svc.insert(subjects).values({ instituteId: inst.id, name: 'RC2 Subject', slug: `rc2subj-${suffix}` }).returning();

  // Register ONLY an MCQ type so TRUE_FALSE has no resolvable answer format.
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

  // Migration 0017 seeds a global TRUE_FALSE template, so an unregistered
  // institute can still resolve it. Remove the global copy to simulate an
  // institute with no resolvable type for that format, and restore it after.
  const [globalTrueFalse] = await svc
    .select({ id: questionTypes.id })
    .from(questionTypes)
    .where(and(eq(questionTypes.code, 'TRUE_FALSE'), isNull(questionTypes.instituteId)))
    .limit(1);
  if (globalTrueFalse) {
    await svc.delete(questionTypes).where(eq(questionTypes.id, globalTrueFalse.id));
    t.after(async () => {
      await db!.insert(questionTypes).values({
        code: 'TRUE_FALSE',
        name: 'True / False',
        description: 'Decide whether the statement is true or false.',
        instructions: 'State whether the statement is True or False.',
        answerFormat: 'TRUE_FALSE',
        kind: 'OBJECTIVE',
        defaultMarks: 1,
        instituteId: null,
      });
    });
  }

  const scratchJobs: string[] = [];
  const scratchQuestions: string[] = [];
  const registeredTypes = new Set<string>();

  t.after(async () => {
    if (!db) return;
    if (scratchQuestions.length > 0) {
      await db.delete(questions).where(inArray(questions.id, scratchQuestions));
    }
    if (scratchJobs.length > 0) {
      await db.delete(jobs).where(inArray(jobs.id, scratchJobs));
    }
    await db.delete(questionTypes).where(or(eq(questionTypes.instituteId, inst.id), eq(questionTypes.createdBy, user.id)));
    await db.delete(materials).where(eq(materials.instituteId, inst.id));
    await db.delete(questionPapers).where(eq(questionPapers.instituteId, inst.id));
    await db.delete(subjects).where(inArray(subjects.id, [subject.id]));
    await db.delete(memberships).where(eq(memberships.instituteId, inst.id));
    await db.delete(users).where(inArray(users.id, [user.id]));
    await db.delete(institutes).where(inArray(institutes.id, [inst.id]));
  });

  const addType = async (code: string, answerFormat: string) => {
    if (registeredTypes.has(code)) return;
    registeredTypes.add(code);
    const [row] = await svc
      .insert(questionTypes)
      .values({
        instituteId: inst.id,
        code,
        name: code,
        answerFormat,
        kind: 'OBJECTIVE',
        allowedDifficulties: ['EASY', 'MEDIUM', 'HARD'],
        active: true,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    t.after(() => db!.delete(questionTypes).where(inArray(questionTypes.id, [row.id])));
    return row;
  };

  const jobQuestions = async (jobId: string) =>
    svc
      .select({
        questionType: questions.questionType,
        answerFormat: questions.answerFormat,
        subjectId: questions.subjectId,
        stem: questions.stem,
      })
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

  const runQp = async (payload: Record<string, unknown>) => {
    const service = new QuestionPaperExtractionService(
      svc, jobsService, types, {} as unknown as never, scope,
    ) as unknown as { processJob(jobId: string, instituteId: string, payload: unknown, createdBy: string | null): Promise<void> };
    const job = await jobsService.insertJob(inst.id, 'QP_EXTRACT', payload, user.id);
    scratchJobs.push(job.id);
    await service.processJob(job.id, inst.id, job.payload, job.createdBy);
    return jobsService.getJob(job.id, inst.id);
  };

  const runMaterial = async () => {
    const service = new QuestionExtractionService(
      svc, jobsService, enhancement, types, {} as unknown as never, scope,
    ) as unknown as { processJob(jobId: string, instituteId: string, payload: unknown, createdBy: string | null): Promise<void> };
    const [material] = await svc
      .insert(materials)
      .values({
        instituteId: inst.id,
        subjectId: subject.id,
        title: 'RC2 material',
        materialType: 'QUESTION_PAPER',
        sourceType: 'TEXT',
        textContent: MIXED_TEXT,
        processingStatus: 'READY',
        revision: 1,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    t.after(() => db!.delete(materials).where(inArray(materials.id, [material.id])));
    const job = await jobsService.insertJob(
      inst.id,
      'QUESTION_EXTRACT',
      { materialId: material.id, subjectId: subject.id },
      user.id,
    );
    scratchJobs.push(job.id);
    await service.processJob(job.id, inst.id, job.payload, job.createdBy);
    return jobsService.getJob(job.id, inst.id);
  };

  await t.test('QP_EXTRACT: one unresolvable format does not abort the run', async () => {
    const job = await runQp({ kind: 'text', sourceHash: randomUUID(), text: MIXED_TEXT });

    assert.equal(job.status, 'completed');
    const result = (job.result ?? {}) as Record<string, unknown>;
    assert.equal(result.candidateCount, 1);
    assert.ok(Array.isArray(result.unresolvedQuestions), 'unresolvedQuestions is recorded');
    const unresolved = result.unresolvedQuestions as Array<{ ref?: string; format?: string; error?: string }>;
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0]?.format, 'TRUE_FALSE');
    assert.equal(unresolved[0]?.ref, '2');
    assert.match(unresolved[0]?.error ?? '', /No question type exists for answer format TRUE_FALSE/);

    const persisted = await jobQuestions(job.id);
    assert.equal(persisted.length, 1, 'only the valid candidate is persisted');
    assert.equal(persisted[0]?.questionType, 'MCQ');
    assert.equal(persisted[0]?.answerFormat, 'MCQ');
    assert.equal(persisted[0]?.subjectId, null);
    scratchQuestions.push(...(await svc.select({ id: questions.id }).from(questions).where(sql`${questions.provenance}->>'jobId' = ${job.id}`)).map((r) => r.id));
  });

  await t.test('QUESTION_EXTRACT: one unresolvable format does not abort the run', async () => {
    const job = await runMaterial();
    assert.equal(job.status, 'completed');
    const result = (job.result ?? {}) as Record<string, unknown>;
    assert.equal(result.candidateCount, 1);
    const unresolved = (result.unresolvedQuestions ?? []) as Array<{ ref?: string; format?: string; error?: string }>;
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0]?.format, 'TRUE_FALSE');
    assert.equal(unresolved[0]?.ref, '2');

    const persisted = await jobQuestions(job.id);
    assert.equal(persisted.length, 1, 'only the valid candidate is persisted');
    assert.equal(persisted[0]?.questionType, 'MCQ');
    assert.equal(persisted[0]?.subjectId, subject.id);
    scratchQuestions.push(...(await svc.select({ id: questions.id }).from(questions).where(sql`${questions.provenance}->>'jobId' = ${job.id}`)).map((r) => r.id));
  });

  await t.test('QP_EXTRACT: all-valid batch keeps the exact legacy result shape', async () => {
    await addType('TRUE_FALSE', 'TRUE_FALSE');
    const job = await runQp({ kind: 'text', sourceHash: randomUUID(), text: MIXED_TEXT });

    assert.equal(job.status, 'completed');
    const result = (job.result ?? {}) as Record<string, unknown>;
    assert.equal(result.candidateCount, 2);
    assert.equal(result.unresolvedQuestions, undefined, 'no unresolvedQuestions key on an all-valid run');
    const persisted = await jobQuestions(job.id);
    assert.equal(persisted.length, 2);
    scratchQuestions.push(...(await svc.select({ id: questions.id }).from(questions).where(sql`${questions.provenance}->>'jobId' = ${job.id}`)).map((r) => r.id));
  });

  await t.test('QUESTION_EXTRACT: all-valid batch keeps the exact legacy result shape', async () => {
    await addType('TRUE_FALSE', 'TRUE_FALSE');
    const job = await runMaterial();

    assert.equal(job.status, 'completed');
    const result = (job.result ?? {}) as Record<string, unknown>;
    assert.equal(result.candidateCount, 2);
    assert.equal(result.unresolvedQuestions, undefined, 'no unresolvedQuestions key on an all-valid run');
    const persisted = await jobQuestions(job.id);
    assert.equal(persisted.length, 2);
    scratchQuestions.push(...(await svc.select({ id: questions.id }).from(questions).where(sql`${questions.provenance}->>'jobId' = ${job.id}`)).map((r) => r.id));
  });
});