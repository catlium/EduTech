import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import { institutes, jobs } from '@catlium/database';

import { QuestionGenerationService } from './question-generation.service.ts';
import type { JobsService } from '../jobs/jobs.service.ts';
import type { QuestionTypesService } from '../questions/question-types.service.ts';
import type { AcademicScopeService } from '../authorization/academic-scope.service.ts';

// GET /questions/bank/sets regression — the SELECT projected
// `payload -> 'batchId'` (jsonb) while the GROUP BY used
// `payload ->> 'batchId'` (text). PostgreSQL treats those as different group
// expressions and rejects the whole query with
//   ERROR: column "jobs.payload" must appear in the GROUP BY clause or be used
//   in an aggregate function   (SQLSTATE 42803)
// which surfaced as HTTP 500. Requires a live database: run with
// TEST_DATABASE_URL=postgresql://... (see .env); skips cleanly when unset so
// the default `pnpm test` run needs no database.
//
// Proves:
//  1. listBankSets runs without the grouping error (the regression itself).
//  2. batchId comes back as a bare text string, not a jsonb value.
//  3. Per-batch aggregation (statuses, generated count) is still correct and
//     jobs without a batchId / from another tenant stay excluded.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

after(async () => {
  await (db as unknown as { $client?: { end: () => Promise<void> } } | null)?.$client?.end?.();
});

const skip = testDbUrl ? false : 'TEST_DATABASE_URL not set';

test('GET /questions/bank/sets groups by the same expression it selects', { skip }, async (t) => {
  const svc = db as unknown as Database;
  // listBankSets only touches this.db; the collaborators are unused here.
  const generation = new QuestionGenerationService(
    svc,
    {} as JobsService,
    {} as QuestionTypesService,
    {} as AcademicScopeService,
  );

  const suffix = randomUUID().slice(0, 8);
  const [inst] = await svc
    .insert(institutes)
    .values({ name: `bank-sets-${suffix}`, slug: `bank-sets-${suffix}` })
    .returning();
  const [otherInst] = await svc
    .insert(institutes)
    .values({ name: `bank-sets-other-${suffix}`, slug: `bank-sets-other-${suffix}` })
    .returning();

  const batchA = randomUUID();
  const batchB = randomUUID();
  const scratch: Array<{ instituteId: string; payload: Record<string, unknown>; status: string; result: unknown }> = [
    { instituteId: inst.id, payload: { batchId: batchA }, status: 'completed', result: { count: 4 } },
    { instituteId: inst.id, payload: { batchId: batchA }, status: 'completed', result: { count: 3 } },
    { instituteId: inst.id, payload: { batchId: batchA }, status: 'failed', result: null },
    { instituteId: inst.id, payload: { batchId: batchB }, status: 'queued', result: null },
    // No batchId -> filtered out by the WHERE clause.
    { instituteId: inst.id, payload: { source: { type: 'TOPIC' } }, status: 'completed', result: { count: 99 } },
    // Other tenant -> filtered out by institute_id.
    { instituteId: otherInst.id, payload: { batchId: batchA }, status: 'completed', result: { count: 42 } },
  ];

  t.after(async () => {
    if (!db) return;
    await db.delete(jobs).where(inArray(jobs.instituteId, [inst.id, otherInst.id]));
    await db.delete(institutes).where(inArray(institutes.id, [inst.id, otherInst.id]));
  });

  await t.test('runs without the PostgreSQL grouping error', async () => {
    await svc.insert(jobs).values(
      scratch.map((j) => ({
        instituteId: j.instituteId,
        type: 'AI_GENERATE_QUESTIONS',
        status: j.status,
        payload: j.payload,
        result: j.result as Record<string, unknown> | null,
      })),
    );

    // The pre-fix query threw 42803 here ("column jobs.payload must appear in
    // the GROUP BY clause"), which the controller turned into HTTP 500.
    const { sets } = await generation.listBankSets(inst.id);
    assert.ok(Array.isArray(sets), 'listBankSets must return a sets array');
  });

  await t.test('batchId is a bare text string', async () => {
    const { sets } = await generation.listBankSets(inst.id);
    const a = sets.find((s) => s.batchId === batchA);
    assert.ok(a, `batch ${batchA} must be present`);
    // A jsonb projection would hand back the quoted JSON string ("<uuid>").
    assert.equal(typeof a.batchId, 'string');
    assert.equal(a.batchId, batchA);
  });

  await t.test('per-batch aggregation is correct and tenant-scoped', async () => {
    const { sets } = await generation.listBankSets(inst.id);
    assert.equal(sets.length, 2, 'only the two batched jobs group into sets');

    const a = sets.find((s) => s.batchId === batchA)!;
    assert.equal(a.total, 3);
    assert.equal(a.completed, 2);
    assert.equal(a.failed, 1);
    assert.equal(a.cancelled, 0);
    assert.equal(a.active, 0);
    assert.equal(a.generated, 7, '4 + 3 generated questions');

    const b = sets.find((s) => s.batchId === batchB)!;
    assert.equal(b.total, 1);
    assert.equal(b.active, 1);
    assert.equal(b.generated, 0);
  });
});
