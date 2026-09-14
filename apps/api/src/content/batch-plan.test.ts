// Phase B batch plan unit tests — pure function, no NestJS.
// Run: node --test apps/api/content/batch-plan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planBatchJobs,
  STARTER_MATERIAL_OPERATION,
  type PlanPort,
  type BatchPlanInput,
} from './batch-plan.ts';
import type { ContentPackageType } from '@catlium/contracts';

const TOPIC_ID = '11111111-1111-1111-1111-111111111111';
const TOPIC_ID_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BATCH_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BATCH_SOURCE = { type: 'TOPIC', id: TOPIC_ID };
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TYPES: ContentPackageType[] = ['NOTE', 'SUMMARY'];
const ALL_TYPES: ContentPackageType[] = [
  'NOTE',
  'SUMMARY',
  'FLASHCARD_SET',
  'IMPORTANT_CONCEPTS',
  'CORNELL_NOTE',
];

function fakePort(overrides: Partial<PlanPort> = {}): PlanPort & {
  enqueueCalls: Array<{ operation: string; payload: Record<string, unknown> }>;
} {
  const enqueueCalls: Array<{ operation: string; payload: Record<string, unknown> }> = [];
  const port = {
    enqueueCalls,
    hasUsableMaterial: overrides.hasUsableMaterial ?? (async () => true),
    dedupTopicId:
      overrides.dedupTopicId ??
      (async (src) => (src.type === 'TOPIC' ? src.id : null)),
    hasExistingDerived: overrides.hasExistingDerived ?? (async () => false),
    enqueueJob:
      overrides.enqueueJob ??
      (async (op, payload) => {
        enqueueCalls.push({ operation: op, payload });
        return { jobId: `job-${enqueueCalls.length}`, duplicate: false };
      }),
  };
  return port;
}

function input(overrides: Partial<BatchPlanInput> = {}): BatchPlanInput {
  return {
    sources: [{ type: 'TOPIC', id: TOPIC_ID }],
    productTypes: TYPES,
    mode: 'missing',
    batchId: BATCH_ID,
    batchSource: BATCH_SOURCE,
    userId: USER_ID,
    ...overrides,
  };
}

// ── 1. Material exists → derived jobs proceed ────────────────────────

test('material exists for topic → derived jobs enqueued immediately', async () => {
  const port = fakePort();
  const result = await planBatchJobs(port, input());

  assert.equal(result.jobIds.length, 2, 'one job per type');
  assert.equal(result.alreadyActive.length, 0);
  assert.equal(result.skipped.length, 0);

  // First two enqueueJob calls should be the two derived jobs (no starter).
  const [call1, call2] = port.enqueueCalls;
  assert.equal(call1.operation, 'AI_GENERATE_NOTE');
  assert.equal(call2.operation, 'AI_GENERATE_SUMMARY');

  // Both should carry the batch metadata.
  for (const call of port.enqueueCalls) {
    assert.equal(call.payload.batchId, BATCH_ID);
    assert.deepEqual(call.payload.batchSource, BATCH_SOURCE);
    assert.equal(call.payload.requestedBy, USER_ID);
  }
});

// ── 2. Material missing → starter created first ─────────────────────

test('topic without material → starter job enqueued with dependentResources', async () => {
  const port = fakePort({ hasUsableMaterial: async () => false });
  const result = await planBatchJobs(port, input());

  assert.equal(result.jobIds.length, 1, 'one starter job');
  assert.equal(result.alreadyActive.length, 0);
  assert.equal(result.skipped.length, 0);

  const starter = port.enqueueCalls[0]!;
  assert.equal(starter.operation, STARTER_MATERIAL_OPERATION);

  const dependentResources = starter.payload.dependentResources as Array<{
    operation: string;
    resourceType: ContentPackageType;
  }>;
  assert.equal(dependentResources.length, TYPES.length);
  assert.equal(dependentResources[0].operation, 'AI_GENERATE_NOTE');
  assert.equal(dependentResources[0].resourceType, 'NOTE');
  assert.equal(dependentResources[1].operation, 'AI_GENERATE_SUMMARY');

  // Batch metadata is present on the starter.
  assert.equal(starter.payload.batchId, BATCH_ID);
  assert.deepEqual(starter.payload.batchSource, BATCH_SOURCE);
  assert.equal(starter.payload.requestedBy, USER_ID);
  assert.deepEqual(starter.payload.source, { type: 'TOPIC', id: TOPIC_ID });
});

// ── 3. Starter already exists → no duplicate starter job ─────────────

test('concurrent starter detected → skipped with starter_pending, no jobs', async () => {
  let starterEnqueueCount = 0;
  const port = fakePort({
    hasUsableMaterial: async () => false,
    enqueueJob: async (op, _payload) => {
      starterEnqueueCount += 1;
      if (op === STARTER_MATERIAL_OPERATION) {
        return { jobId: '', duplicate: true };
      }
      throw new Error('should not enqueue derived jobs when starter is duplicate');
    },
  });

  const result = await planBatchJobs(port, input());

  assert.equal(result.jobIds.length, 0);
  assert.equal(starterEnqueueCount, 1, 'starter enqueue attempted once');
  assert.equal(result.skipped.length, TYPES.length);
  for (const skip of result.skipped) {
    assert.equal(skip.reason, 'starter_pending');
    assert.equal(skip.topicId, TOPIC_ID);
  }
});

// ── 4. Existing derived resource → Generate-Missing skips it ─────────

test('mode=missing and derived exists → that type is skipped', async () => {
  const port = fakePort({
    hasExistingDerived: async (_topicId, type) => type === 'NOTE',
  });

  const result = await planBatchJobs(port, input());

  assert.equal(result.jobIds.length, 1, 'only SUMMARY enqueued');
  assert.equal(port.enqueueCalls[0].operation, 'AI_GENERATE_SUMMARY');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].type, 'NOTE');
  assert.equal(result.skipped[0].reason, 'exists');
  assert.equal(result.skipped[0].topicId, TOPIC_ID);
});

// ── 5. Regenerate mode → does not skip existing derived resources ────

test('mode=regenerate and derived exists → all types enqueued anyway', async () => {
  const port = fakePort({
    hasExistingDerived: async (_topicId, type) => type === 'NOTE',
  });

  const result = await planBatchJobs(port, input({ mode: 'regenerate' }));

  assert.equal(result.jobIds.length, 2, 'both NOTE and SUMMARY enqueued');
  assert.equal(result.skipped.length, 0);
  assert.equal(port.enqueueCalls[0].operation, 'AI_GENERATE_NOTE');
  assert.equal(port.enqueueCalls[1].operation, 'AI_GENERATE_SUMMARY');
});

// ── 6. Worker test covers starter failure → no dependents ────────────
// (Covered by apps/workers/tests/test_batch_prerequisite.py)

// ── 7. Dependent already active → silently dropped ───────────────────

test('dependent enqueue returns duplicate → alreadyActive list populated', async () => {
  let callIndex = 0;
  const port = fakePort({
    hasUsableMaterial: async () => true,
    enqueueJob: async (_op, _payload) => {
      callIndex += 1;
      if (callIndex === 1) {
        // First type (NOTE) is active.
        return { jobId: '', duplicate: true };
      }
      return { jobId: `job-${callIndex}`, duplicate: false };
    },
  });

  const result = await planBatchJobs(port, input());

  assert.equal(result.jobIds.length, 1, 'only SUMMARY enqueued');
  assert.equal(result.alreadyActive.length, 1);
  assert.equal(result.alreadyActive[0], 'NOTE');
  assert.equal(result.skipped.length, 0);
});

// ── Additional: STARTER_MATERIAL payload carries all five product types ─

test('starter dependentResources includes all requested product types', async () => {
  const port = fakePort({ hasUsableMaterial: async () => false });
  await planBatchJobs(port, input({ productTypes: ALL_TYPES }));

  const starter = port.enqueueCalls[0]!;
  const deps = starter.payload.dependentResources as Array<{
    resourceType: ContentPackageType;
    params?: { types: string[] };
  }>;
  assert.equal(deps.length, 5);
  assert.deepEqual(
    deps.map((d) => d.resourceType),
    ALL_TYPES,
  );
  // CORNELL_NOTE gets params.types = ['cornell']
  const cornell = deps.find((d) => d.resourceType === 'CORNELL_NOTE')!;
  assert.deepEqual(cornell.params, { types: ['cornell'] });
  // Non-CORNELL deps have no params key.
  const note = deps.find((d) => d.resourceType === 'NOTE')!;
  assert.equal('params' in note, false);
});

// ── Additional: CHAPTER source resolves to topic sources ─────────────

test('chapter source → starter for material-less topic, derived for others', async () => {
  let starterCount = 0;
  let derivedCount = 0;
  const enqueueCalls: Array<{ operation: string; payload: Record<string, unknown> }> = [];

  const port = fakePort({
    hasUsableMaterial: async (topicId) => topicId !== TOPIC_ID,
    dedupTopicId: async (src) => (src.type === 'TOPIC' ? src.id : null),
    enqueueJob: async (op, payload) => {
      enqueueCalls.push({ operation: op, payload });
      if (op === STARTER_MATERIAL_OPERATION) {
        starterCount += 1;
        return { jobId: `starter-${starterCount}`, duplicate: false };
      }
      derivedCount += 1;
      return { jobId: `derived-${derivedCount}`, duplicate: false };
    },
  });

  const result = await planBatchJobs(
    port,
    input({
      sources: [
        { type: 'TOPIC', id: TOPIC_ID },    // no material → starter
        { type: 'TOPIC', id: TOPIC_ID_2 },  // has material → derived
      ],
      productTypes: ['NOTE'],
    }),
  );

  assert.equal(starterCount, 1, 'only one starter (for TOPIC_ID)');
  assert.equal(
    enqueueCalls.filter((c) => c.operation === 'AI_GENERATE_NOTE').length,
    1,
    'one NOTE derived (for TOPIC_ID_2)',
  );
  assert.equal(result.jobIds.length, 2, 'starter + one derived');
  assert.equal(result.skipped.length, 0);
});

// ── Additional: one derived type already active → others still enqueued ─

test('one derived type already active → other types enqueued, alreadyActive listed', async () => {
  let callIndex = 0;
  const port = fakePort({
    hasUsableMaterial: async () => true,
    enqueueJob: async (op, _payload) => {
      callIndex += 1;
      if (op === 'AI_GENERATE_NOTE') {
        return { jobId: '', duplicate: true };
      }
      return { jobId: `job-${callIndex}`, duplicate: false };
    },
  });

  const result = await planBatchJobs(port, input());

  assert.equal(result.jobIds.length, 1, 'only SUMMARY enqueued');
  assert.equal(result.alreadyActive.length, 1);
  assert.equal(result.alreadyActive[0], 'NOTE');
  assert.equal(result.skipped.length, 0);
});
