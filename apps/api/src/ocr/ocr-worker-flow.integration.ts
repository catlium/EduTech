import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  subjects,
  users,
  materials,
  ocrChunks,
  ocrWorkers,
} from '@catlium/database';

import { AcademicScopeService } from '../authorization/academic-scope.service.ts';
import { JobsService } from '../jobs/jobs.service.ts';
import type { RabbitMQService } from '../common/services/rabbitmq.service.ts';
import { MaterialEnhancementService } from '../material-enhancement/enhancement.service.ts';
import type { StorageProvider } from '../materials/storage/storage-provider.interface.ts';
import { OcrWorkerAuthGuard } from './guards/ocr-worker-auth.guard.ts';
import type { OcrWorkerContext } from './guards/ocr-worker-auth.guard.ts';
import { OcrCoordinatorService } from './ocr-coordinator.service.ts';
import { OcrWorkersService } from './ocr-workers.service.ts';

// Phase K Part 3 OCR worker end-to-end validation. Requires a live database:
// run with TEST_DATABASE_URL=postgresql://... via the `test:ocr-worker` script;
// skips when unset. The worker registry is platform-global, so the guard tests
// need no tenant; the lifecycle tests build a scratch tenant and clean up.
//
// NOTE: the coordinator claims from ANY active MATERIAL_PROCESS job (global by
// design), so run this against a database with no other in-flight OCR job.
const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

after(async () => {
  await (db as unknown as { $client?: { end: () => Promise<void> } } | null)?.$client?.end?.();
});

const skip = testDbUrl ? false : 'TEST_DATABASE_URL not set';

function httpContext(headers: Record<string, string>): {
  request: Record<string, unknown>;
  ctx: ExecutionContext;
} {
  const request: Record<string, unknown> = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, ctx };
}

function workerResult(start: number, end: number, label: string, totalPages?: number) {
  const pages: Array<{ page: number; source: 'pymupdf'; text: string }> = [];
  for (let page = start; page <= end; page += 1) {
    pages.push({ page, source: 'pymupdf', text: `${label} ${page}` });
  }
  return { pages, text: `${label} ${start}-${end}`, ...(totalPages ? { totalPages } : {}) };
}

test('OCR worker registry: bearer guard accepts only enabled, matching owr_ tokens', { skip }, async () => {
  const svc = db as unknown as Database;
  const workersService = new OcrWorkersService(svc);
  const guard = new OcrWorkerAuthGuard(svc);
  const created: string[] = [];
  try {
    const name = `ocrtest-guard-${randomUUID()}`;
    const { workerId, apiKey } = await workersService.register({ name });
    created.push(workerId);
    assert.match(apiKey, /^owr_/);

    // Missing / malformed / unknown-worker credentials are all rejected.
    await assert.rejects(
      guard.canActivate(httpContext({ authorization: `Bearer ${apiKey}` }).ctx),
      UnauthorizedException,
    );
    await assert.rejects(
      guard.canActivate(httpContext({ 'x-worker-id': workerId }).ctx),
      UnauthorizedException,
    );
    await assert.rejects(
      guard.canActivate(
        httpContext({ 'x-worker-id': workerId, authorization: 'Bearer plain-token' }).ctx,
      ),
      UnauthorizedException,
    );
    await assert.rejects(
      guard.canActivate(
        httpContext({ 'x-worker-id': randomUUID(), authorization: `Bearer ${apiKey}` }).ctx,
      ),
      UnauthorizedException,
    );
    await assert.rejects(
      guard.canActivate(
        httpContext({
          'x-worker-id': workerId,
          authorization: `Bearer owr_${'a'.repeat(32)}`,
        }).ctx,
      ),
      UnauthorizedException,
    );

    // Valid credentials attach the worker context.
    const good = httpContext({ 'x-worker-id': workerId, authorization: `Bearer ${apiKey}` });
    assert.equal(await guard.canActivate(good.ctx), true);
    assert.deepEqual(good.request['ocrWorker'], {
      workerId,
      name,
      version: null,
    } satisfies OcrWorkerContext);

    // Token rotation invalidates the old secret; disable wins over a valid token.
    const rotated = await workersService.update(workerId, { rotateToken: true });
    assert.match(rotated.apiKey ?? '', /^owr_/);
    await assert.rejects(
      guard.canActivate(
        httpContext({ 'x-worker-id': workerId, authorization: `Bearer ${apiKey}` }).ctx,
      ),
      UnauthorizedException,
    );
    assert.equal(
      await guard.canActivate(
        httpContext({ 'x-worker-id': workerId, authorization: `Bearer ${rotated.apiKey}` }).ctx,
      ),
      true,
    );
    await workersService.update(workerId, { enabled: false });
    await assert.rejects(
      guard.canActivate(
        httpContext({ 'x-worker-id': workerId, authorization: `Bearer ${rotated.apiKey}` }).ctx,
      ),
      UnauthorizedException,
    );
  } finally {
    if (created.length) await db!.delete(ocrWorkers).where(inArray(ocrWorkers.id, created));
  }
});

test('OCR worker flow: claim -> source -> result finalizes READY once, tenant-scoped', { skip }, async () => {
  const svc = db as unknown as Database;
  const jobsService = new JobsService(svc, {} as unknown as RabbitMQService);
  const enhancements = new MaterialEnhancementService(svc, jobsService);
  const scope = new AcademicScopeService(svc);
  const stored = Buffer.from('%PDF-1.4 fake source bytes');
  const storage: StorageProvider = {
    save: async () => undefined,
    read: async () => stored,
    delete: async () => undefined,
  };
  const coordinator = new OcrCoordinatorService(svc, jobsService, enhancements, storage, scope);
  const workersService = new OcrWorkersService(svc);

  const instIds: string[] = [];
  const userIds: string[] = [];
  const workerIds: string[] = [];
  try {
    const [inst] = await db!
      .insert(institutes)
      .values({ name: randomUUID(), slug: `ocr-${randomUUID()}` })
      .returning();
    instIds.push(inst!.id);
    const [subj] = await db!
      .insert(subjects)
      .values({ instituteId: inst!.id, name: 'OCR Subject', slug: randomUUID() })
      .returning();
    const [user] = await db!
      .insert(users)
      .values({ email: randomUUID(), name: 'OCR Tester', passwordHash: 'x' })
      .returning();
    userIds.push(user!.id);
    const [material] = await db!
      .insert(materials)
      .values({
        instituteId: inst!.id,
        subjectId: subj!.id,
        title: `ocr-${randomUUID()}`,
        materialType: 'PDF',
        sourceType: 'UPLOAD',
        fileName: 'source.pdf',
        storageKey: 'ocr-test/source.pdf',
        mimeType: 'application/pdf',
        fileSize: stored.length,
        createdBy: user!.id,
      })
      .returning();

    const workerA = await workersService.register({ name: `ocr-a-${randomUUID()}` });
    const workerB = await workersService.register({ name: `ocr-b-${randomUUID()}` });
    workerIds.push(workerA.workerId, workerB.workerId);

    const job = await jobsService.insertJob(inst!.id, 'MATERIAL_PROCESS', {
      materialId: material!.id,
    });
    await coordinator.enqueueJob({ id: job.id, instituteId: inst!.id }, material!.id);

    assert.equal((await jobsService.getJob(job.id, inst!.id)).status, 'processing');
    let chunks = await db!.select().from(ocrChunks).where(eq(ocrChunks.jobId, job.id));
    assert.equal(chunks.length, 1);
    assert.deepEqual(
      { start: chunks[0]!.startPage, end: chunks[0]!.endPage, status: chunks[0]!.status },
      { start: 1, end: 10, status: 'pending' },
    );

    await coordinator.heartbeat(workerA.workerId, 'idle');
    const claimA = await coordinator.claim(workerA.workerId);
    assert.ok(claimA.chunk);
    assert.equal(claimA.chunk!.id, chunks[0]!.id);
    assert.equal(claimA.chunk!.pageCount, 10);
    // A single worker owns the chunk: a sibling claim finds nothing.
    assert.equal((await coordinator.claim(workerB.workerId)).chunk, null);

    // Cross-worker callbacks are refused before touching the source.
    await assert.rejects(
      coordinator.getSource(workerB.workerId, chunks[0]!.id),
      /not held by this worker/,
    );
    await assert.rejects(
      coordinator.submitResult(workerB.workerId, chunks[0]!.id, workerResult(1, 1, 'x')),
      /not held by this worker/,
    );

    const source = await coordinator.getSource(workerA.workerId, chunks[0]!.id);
    assert.equal(source.mimeType, 'application/pdf');
    assert.deepEqual(source.data, stored);

    // Pages 1..10 of a 12-page doc: chunk 2 materialized, job still processing.
    await coordinator.submitResult(workerA.workerId, chunks[0]!.id, workerResult(1, 10, 'page', 12));
    chunks = await db!
      .select()
      .from(ocrChunks)
      .where(eq(ocrChunks.jobId, job.id))
      .orderBy(ocrChunks.chunkIndex);
    assert.deepEqual(
      chunks.map((c) => [c.chunkIndex, c.startPage, c.endPage]),
      [
        [1, 1, 10],
        [2, 11, 12],
      ],
    );
    assert.equal((await jobsService.getJob(job.id, inst!.id)).status, 'processing');

    // Duplicate / late callback on a submitted chunk is rejected.
    await assert.rejects(
      coordinator.submitResult(workerA.workerId, chunks[0]!.id, workerResult(1, 1, 'late')),
      /not held by this worker/,
    );

    const claimB = await coordinator.claim(workerB.workerId);
    assert.equal(claimB.chunk!.id, chunks[1]!.id);
    await coordinator.submitResult(workerB.workerId, chunks[1]!.id, workerResult(11, 12, 'tail', 12));

    // Finalization is sweep-owned: settle, then READY with ordered aggregate text.
    await coordinator.sweep();
    assert.equal((await jobsService.getJob(job.id, inst!.id)).status, 'completed');
    const [ready] = await db!.select().from(materials).where(eq(materials.id, material!.id));
    assert.equal(ready!.processingStatus, 'READY');
    assert.equal(ready!.progress, null);
    assert.equal(
      ready!.textContent,
      [...Array.from({ length: 10 }, (_, i) => `page ${i + 1}`), 'tail 11', 'tail 12'].join(
        '\n\n',
      ),
    );

    // Cross-tenant isolation: the same job is invisible from another institute.
    const [other] = await db!
      .insert(institutes)
      .values({ name: randomUUID(), slug: `ocr-other-${randomUUID()}` })
      .returning();
    instIds.push(other!.id);
    await assert.rejects(jobsService.getJob(job.id, other!.id), NotFoundException);
  } finally {
    await db!.delete(institutes).where(inArray(institutes.id, instIds));
    if (workerIds.length) await db!.delete(ocrWorkers).where(inArray(ocrWorkers.id, workerIds));
    if (userIds.length) await db!.delete(users).where(inArray(users.id, userIds));
  }
});

test('OCR worker flow: disabling a worker reclaims its lease; permanent failure settles FAILED', { skip }, async () => {
  const svc = db as unknown as Database;
  const jobsService = new JobsService(svc, {} as unknown as RabbitMQService);
  const enhancements = new MaterialEnhancementService(svc, jobsService);
  const scope = new AcademicScopeService(svc);
  const storage: StorageProvider = {
    save: async () => undefined,
    read: async () => Buffer.from('x'),
    delete: async () => undefined,
  };
  const coordinator = new OcrCoordinatorService(svc, jobsService, enhancements, storage, scope);
  const workersService = new OcrWorkersService(svc);

  const instIds: string[] = [];
  const userIds: string[] = [];
  const workerIds: string[] = [];
  try {
    const [inst] = await db!
      .insert(institutes)
      .values({ name: randomUUID(), slug: `ocr-fail-${randomUUID()}` })
      .returning();
    instIds.push(inst!.id);
    const [subj] = await db!
      .insert(subjects)
      .values({ instituteId: inst!.id, name: 'OCR Fail Subject', slug: randomUUID() })
      .returning();
    const [user] = await db!
      .insert(users)
      .values({ email: randomUUID(), name: 'OCR Fail Tester', passwordHash: 'x' })
      .returning();
    userIds.push(user!.id);
    const [material] = await db!
      .insert(materials)
      .values({
        instituteId: inst!.id,
        subjectId: subj!.id,
        title: `ocr-fail-${randomUUID()}`,
        materialType: 'PDF',
        sourceType: 'UPLOAD',
        fileName: 'source.pdf',
        storageKey: 'ocr-test/fail.pdf',
        createdBy: user!.id,
      })
      .returning();

    const worker = await workersService.register({ name: `ocr-fail-${randomUUID()}` });
    workerIds.push(worker.workerId);

    const job = await jobsService.insertJob(inst!.id, 'MATERIAL_PROCESS', {
      materialId: material!.id,
    });
    await coordinator.enqueueJob({ id: job.id, instituteId: inst!.id }, material!.id);

    const first = await coordinator.claim(worker.workerId);
    assert.ok(first.chunk);

    // A disabled worker's lease never renews: the sweep returns it to pending.
    await workersService.update(worker.workerId, { enabled: false });
    await coordinator.sweep();
    let [chunk] = await db!.select().from(ocrChunks).where(eq(ocrChunks.id, first.chunk!.id));
    assert.deepEqual(
      { status: chunk!.status, claimedBy: chunk!.claimedBy, attempts: chunk!.attempts },
      { status: 'pending', claimedBy: null, attempts: 1 },
    );

    // Re-enable, fail once transiently: the chunk returns to pending, not failed.
    await workersService.update(worker.workerId, { enabled: true });
    const second = await coordinator.claim(worker.workerId);
    await coordinator.failChunk(worker.workerId, second.chunk!.id, { error: 'transient' });
    [chunk] = await db!.select().from(ocrChunks).where(eq(ocrChunks.id, first.chunk!.id));
    assert.deepEqual(
      { status: chunk!.status, attempts: chunk!.attempts },
      { status: 'pending', attempts: 2 },
    );

    // A permanent failure is terminal and settles the job + material to FAILED.
    const third = await coordinator.claim(worker.workerId);
    await coordinator.failChunk(worker.workerId, third.chunk!.id, {
      error: 'corrupt pdf',
      permanent: true,
    });
    await coordinator.sweep();
    assert.equal((await jobsService.getJob(job.id, inst!.id)).status, 'failed');
    const [failed] = await db!.select().from(materials).where(eq(materials.id, material!.id));
    assert.equal(failed!.processingStatus, 'FAILED');
    assert.equal(failed!.progress, null);
  } finally {
    await db!.delete(institutes).where(inArray(institutes.id, instIds));
    if (workerIds.length) await db!.delete(ocrWorkers).where(inArray(ocrWorkers.id, workerIds));
    if (userIds.length) await db!.delete(users).where(inArray(users.id, userIds));
  }
});
