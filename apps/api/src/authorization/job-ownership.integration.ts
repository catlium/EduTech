import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { validate } from 'class-validator';
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
  classes,
  classSubjects,
  teacherAssignments,
  jobs,
} from '@catlium/database';

import { JobsService, ALLOWED_JOB_TYPES } from '../jobs/jobs.service.ts';
import type { RabbitMQService } from '../common/services/rabbitmq.service.ts';
import { AcademicScopeService } from '../authorization/academic-scope.service.ts';
import { QuestionTypesService } from '../questions/question-types.service.ts';
import { QuestionExtractionService } from '../question-extraction/question-extraction.service.ts';
import { QuestionPaperExtractionService } from '../question-papers/question-paper-extraction.service.ts';
import { PaperPatternExtractionService } from '../paper-patterns/paper-pattern-extraction.service.ts';
import { CreateJobDto } from '../jobs/dto/create-job.dto.ts';

// LOW-1 remediation regression — trusted job ownership. Requires a live
// database: run with TEST_DATABASE_URL=postgresql://... (see .env); skips
// cleanly when unset so the default `pnpm test` run needs no database.
//
// Proves:
//  1. jobs.createdBy is server-stamped — a forged payload userId/requestedBy
//     never becomes the authoritative owner.
//  2. The QUESTION/QP/PATTERN_EXTRACT owner polling gates read jobs.createdBy,
//     so forged payload owner IDs cannot satisfy owner checks (admin bypass
//     preserved).
//  3. generic POST /jobs (CreateJobDto) rejects the AI/extraction job types.
//  4. MATERIAL_PROCESS / MATERIAL_ENHANCE still go through; system jobs may
//     have a NULL createdBy.
//  5. tenant isolation is unchanged (cross-institute job lookup is NotFound).

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

after(async () => {
  await (db as unknown as { $client?: { end: () => Promise<void> } } | null)?.$client?.end?.();
});

const skip = testDbUrl ? false : 'TEST_DATABASE_URL not set';
const rabbitmqStub = { publish: async () => undefined } as unknown as RabbitMQService;

test('LOW-1 trusted job ownership', { skip }, async (t) => {
  const svc = db as unknown as Database;
  const jobsService = new JobsService(svc, rabbitmqStub);
  const scope = new AcademicScopeService(svc);

  const suffix = randomUUID().slice(0, 8);
  const [inst] = await svc.insert(institutes).values({ name: `owner-${suffix}`, slug: `owner-${suffix}` }).returning();

  const roleId = async (key: string) => {
    const [r] = await svc.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
    if (!r) throw new Error(`${key} role not seeded in the test database`);
    return r.id;
  };
  const member = async (name: string, roleKey: string, instituteId = inst.id) => {
    const [user] = await svc.insert(users).values({ email: `${name}-${suffix}@example.test`, name, passwordHash: 'x' }).returning();
    const [m] = await svc.insert(memberships).values({ userId: user.id, instituteId, status: 'active' }).returning();
    await svc.insert(membershipRoles).values({ membershipId: m.id, roleId: await roleId(roleKey) });
    return { userId: user.id, membershipId: m.id };
  };

  const owner = await member('owner-teacher', 'TEACHER');
  const other = await member('other-teacher', 'TEACHER');
  const admin = await member('owner-admin', 'INSTITUTE_ADMIN');

  // A writable subject for the QUESTION_EXTRACT gate (teacher assignment).
  const [klass] = await svc.insert(classes).values({ instituteId: inst.id, name: 'Owner Class' }).returning();
  const [subject] = await svc.insert(subjects).values({ instituteId: inst.id, name: 'Owner Subject', slug: `subj-${suffix}` }).returning();
  const [offering] = await svc.insert(classSubjects).values({ classId: klass.id, subjectId: subject.id }).returning();
  await svc.insert(teacherAssignments).values({ instituteId: inst.id, classSubjectId: offering.id, membershipId: owner.membershipId });
  await svc.insert(teacherAssignments).values({ instituteId: inst.id, classSubjectId: offering.id, membershipId: other.membershipId });

  const scratchJobs: string[] = [];

  t.after(async () => {
    if (!db) return;
    await db.delete(jobs).where(inArray(jobs.id, scratchJobs));
    const emails = [`owner-teacher-${suffix}@example.test`, `other-teacher-${suffix}@example.test`, `owner-admin-${suffix}@example.test`];
    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))).map((r) => r.id);
    if (userIds.length === 0) return;
    const membershipIds = (await db.select({ id: memberships.id }).from(memberships).where(inArray(memberships.userId, userIds))).map((r) => r.id);
    if (membershipIds.length > 0) await db.delete(membershipRoles).where(inArray(membershipRoles.membershipId, membershipIds));
    await db.delete(teacherAssignments).where(inArray(teacherAssignments.membershipId, membershipIds));
    await db.delete(memberships).where(inArray(memberships.userId, userIds));
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(subjects).where(inArray(subjects.id, [subject.id]));
    await db.delete(classes).where(inArray(classes.id, [klass.id]));
    await db.delete(institutes).where(inArray(institutes.id, [inst.id]));
  });

  await t.test('createdBy is server-stamped, never taken from a forged payload', async () => {
    const forged = await jobsService.insertJob(
      inst.id,
      'QUESTION_EXTRACT',
      { userId: other.userId, requestedBy: other.userId, materialId: randomUUID() },
      owner.userId,
    );
    scratchJobs.push(forged.id);
    assert.equal(forged.createdBy, owner.userId, 'trusted column wins over forged payload keys');
    assert.equal(forged.payload?.['userId'], other.userId, 'the forged payload keys stay inert');
    assert.equal(forged.payload?.['requestedBy'], other.userId);
  });

  await t.test('system jobs can have a NULL createdBy', async () => {
    const sys = await jobsService.insertJob(inst.id, 'PROCESS_SYLLABUS', { syllabusId: randomUUID() });
    scratchJobs.push(sys.id);
    assert.equal(sys.createdBy, null);
    const sysEnhance = await jobsService.insertJob(inst.id, 'MATERIAL_ENHANCE', { materialId: randomUUID(), trigger: 'OCR_COMPLETE' });
    scratchJobs.push(sysEnhance.id);
    assert.equal(sysEnhance.createdBy, null);
  });

  await t.test('MATERIAL_PROCESS / MATERIAL_ENHANCE still work and stamp the actor', async () => {
    const proc = await jobsService.insertJob(inst.id, 'MATERIAL_PROCESS', { materialId: randomUUID() }, owner.userId);
    scratchJobs.push(proc.id);
    assert.equal(proc.type, 'MATERIAL_PROCESS');
    assert.equal(proc.status, 'queued');
    assert.equal(proc.createdBy, owner.userId);
    const enh = await jobsService.insertJob(inst.id, 'MATERIAL_ENHANCE', { materialId: randomUUID(), trigger: 'MANUAL' }, owner.userId);
    scratchJobs.push(enh.id);
    assert.equal(enh.type, 'MATERIAL_ENHANCE');
    assert.equal(enh.createdBy, owner.userId);
  });

  await t.test('Q: QP_EXTRACT owner polling reads jobs.createdBy', async () => {
    const svc = db as Database;
    const service = new QuestionPaperExtractionService(
      svc, jobsService, new QuestionTypesService(svc), {} as unknown as never, scope,
    );
    // Payload carries a FORGED userId (the other user); the column carries the real owner.
    const job = await jobsService.insertJob(inst.id, 'QP_EXTRACT', { sourceHash: randomUUID(), userId: other.userId }, owner.userId);
    scratchJobs.push(job.id);

    assert.equal((await service.getExtraction(inst.id, owner.membershipId, owner.userId, job.id)).createdBy, owner.userId);
    // A non-owner gets a 404 EVEN THOUGH the forged payload userId matches them.
    await assert.rejects(
      service.getExtraction(inst.id, other.membershipId, other.userId, job.id),
      NotFoundException,
    );
    // Admin bypass is preserved.
    assert.equal((await service.getExtraction(inst.id, admin.membershipId, admin.userId, job.id)).createdBy, owner.userId);
  });

  await t.test('Q: PATTERN_EXTRACT owner polling reads jobs.createdBy', async () => {
    const svc = db as Database;
    const service = new PaperPatternExtractionService(
      svc, jobsService, {} as unknown as never, {} as unknown as never, scope,
    );
    const job = await jobsService.insertJob(
      inst.id,
      'PATTERN_EXTRACT',
      { sourceHash: randomUUID(), userId: other.userId, membershipId: other.membershipId },
      owner.userId,
    );
    scratchJobs.push(job.id);

    assert.equal((await service.getExtraction(inst.id, owner.membershipId, owner.userId, job.id)).createdBy, owner.userId);
    await assert.rejects(
      service.getExtraction(inst.id, other.membershipId, other.userId, job.id),
      NotFoundException,
    );
    assert.equal((await service.getExtraction(inst.id, admin.membershipId, admin.userId, job.id)).createdBy, owner.userId);
  });

  await t.test('Q: QUESTION_EXTRACT owner polling reads jobs.createdBy', async () => {
    const svc = db as Database;
    const service = new QuestionExtractionService(
      svc, jobsService, {} as unknown as never, new QuestionTypesService(svc), {} as unknown as never, scope,
    );
    // The subject is inside both teachers' writable scope (offering assigned to
    // both), so the gate is reached and ownership is decided by createdBy.
    const job = await jobsService.insertJob(
      inst.id,
      'QUESTION_EXTRACT',
      { materialId: randomUUID(), subjectId: subject.id, userId: other.userId },
      owner.userId,
    );
    scratchJobs.push(job.id);

    assert.equal((await service.getExtraction(inst.id, owner.membershipId, owner.userId, job.id)).createdBy, owner.userId);
    await assert.rejects(
      service.getExtraction(inst.id, other.membershipId, other.userId, job.id),
      NotFoundException,
    );
    assert.equal((await service.getExtraction(inst.id, admin.membershipId, admin.userId, job.id)).createdBy, owner.userId);
  });

  await t.test('Q: tenant isolation remains intact', async () => {
    const job = await jobsService.insertJob(inst.id, 'MATERIAL_PROCESS', { materialId: randomUUID() }, owner.userId);
    scratchJobs.push(job.id);
    const [foreign] = await svc.insert(institutes).values({ name: `owner-for-${suffix}`, slug: `owner-for-${suffix}` }).returning();
    await assert.rejects(jobsService.getJob(job.id, foreign.id), NotFoundException);
    await db!.delete(institutes).where(inArray(institutes.id, [foreign.id]));
  });

  await t.test('Q: generic POST /jobs rejects the AI/extraction job types', async () => {
    const disallowed = [
      'AI_GENERATE_NOTE', 'AI_GENERATE_SUMMARY', 'AI_GENERATE_FLASHCARDS', 'AI_GENERATE_CONCEPTS',
      'AI_GENERATE_CONTENT_PACKAGE', 'AI_GENERATE_QUESTIONS', 'AI_GENERATE_BLUEPRINT',
      'AI_GENERATE_STARTER_MATERIAL', 'AI_ANALYZE_SYLLABUS', 'PATTERN_EXTRACT', 'QP_EXTRACT',
      'QUESTION_EXTRACT',
    ];
    for (const type of disallowed) {
      const dto = new CreateJobDto();
      dto.type = type;
      dto.payload = {};
      const errors = await validate(dto);
      assert.ok(errors.length > 0, `POST /jobs must reject ${type}`);
    }
    for (const type of ['MATERIAL_PROCESS', 'MATERIAL_ENHANCE']) {
      assert.ok(ALLOWED_JOB_TYPES.includes(type as typeof ALLOWED_JOB_TYPES[number]), `${type} stays allowed`);
      const dto = new CreateJobDto();
      dto.type = type;
      const errors = await validate(dto);
      assert.deepEqual(errors, [], `${type} passes CreateJobDto validation`);
    }
    assert.equal(ALLOWED_JOB_TYPES.length, 2, 'the endpoint exposes exactly the two coordinator types');
  });
});