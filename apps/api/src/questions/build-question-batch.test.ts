// Goal E question-bank batch planner — pure function, no NestJS.
// Run: node --test apps/../apps/api/src/questions/build-question-batch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planQuestionBankJobs,
  DEFAULT_QUESTION_BATCH_SIZE,
  MAX_QUESTION_BATCH_SIZE,
} from './build-question-batch.ts';
import type { BankBucket } from './build-bank-buckets.ts';

const BATCH_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SOURCE = { type: 'TOPIC' as const, id: '11111111-1111-1111-1111-111111111111' };
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TYPE_FORMATS = { MCQ: 'MCQ', TRUE_FALSE: 'TRUE_FALSE', FILL_IN_BLANK: 'FILL_IN_BLANK' };

function bucket(type: string, difficulty: BankBucket['difficulty'], count: number): BankBucket {
  return { questionType: type, difficulty, count };
}

function plan(buckets: BankBucket[], maxPerJob?: number) {
  return planQuestionBankJobs({
    batchId: BATCH_ID,
    batchSource: { type: 'TOPIC', id: SOURCE.id },
    source: SOURCE,
    userId: USER_ID,
    buckets,
    typeFormats: TYPE_FORMATS,
    maxPerJob,
  });
}

// ── 1. One job per bucket when every bucket fits the batch size ─────────

test('one child per (type, difficulty) bucket within the default batch size', () => {
  const result = plan([
    bucket('MCQ', 'EASY', 7),
    bucket('TRUE_FALSE', 'MEDIUM', 5),
    bucket('FILL_IN_BLANK', 'HARD', 10),
  ]);

  assert.equal(result.children.length, 3, 'one child per bucket');
  assert.equal(result.totalQuestions, 22);

  const [mcq, tf, fib] = result.children;
  assert.equal(mcq.payload.params.questionType, 'MCQ');
  assert.equal(mcq.payload.params.difficulty, 'EASY');
  assert.equal(mcq.payload.params.count, 7);
  assert.equal(tf.payload.params.questionType, 'TRUE_FALSE');
  assert.equal(fib.payload.params.count, 10);

  // Each child carries the batch wiring and a unique dedupKey slot.
  const dedupKeys = new Set(result.children.map((c) => c.dedupKey));
  assert.equal(dedupKeys.size, result.children.length, 'dedupKeys unique');
  for (const child of result.children) {
    assert.equal(child.payload.batchId, BATCH_ID);
    assert.deepEqual(child.payload.batchSource, { type: 'TOPIC', id: SOURCE.id });
    assert.deepEqual(child.payload.source, SOURCE);
    assert.equal(child.payload.requestedBy, USER_ID);
    assert.equal(child.payload.operation, 'AI_GENERATE_QUESTIONS');
    assert.equal(child.payload.params.dedupKey, child.dedupKey);
    assert.deepEqual(child.payload.params.types, TYPE_FORMATS);
  }
});

// ── 2. Large bucket is split so no child exceeds maxPerJob ────────────

test('bucket larger than maxPerJob splits into sub-batches of <= maxPerJob', () => {
  const result = plan([bucket('MCQ', 'HARD', 25)], 10);

  assert.equal(result.children.length, 3, '25/10 -> three children');
  assert.deepEqual(
    result.children.map((c) => c.payload.params.count),
    [10, 10, 5],
    'counts preserved exactly',
  );
  assert.equal(result.totalQuestions, 25);
  for (const child of result.children) {
    assert.ok(child.payload.params.count <= 10);
    assert.deepEqual(child.payload.params.questionType, 'MCQ');
    assert.deepEqual(child.payload.params.difficulty, 'HARD');
  }
});

// ── 3. Split children stay unique per slot while sharing the batch ────

test('split sub-batches share batchId but carry distinct dedupKey slots', () => {
  const result = plan([bucket('MCQ', 'MEDIUM', 22)], 10);

  assert.equal(result.children.length, 3);
  const keys = result.children.map((c) => c.dedupKey);
  assert.equal(new Set(keys).size, 3);
  for (const key of keys) assert.ok(key.startsWith(`qbank:${BATCH_ID}:MCQ:MEDIUM:`));
  for (const child of result.children) assert.equal(child.payload.batchId, BATCH_ID);
});

// ── 4. Zero-count buckets produce no child, and never a slot with 0 ───

test('zero-count buckets are dropped and no child asks for 0 questions', () => {
  const result = plan([bucket('MCQ', 'EASY', 0), bucket('TRUE_FALSE', 'HARD', 4)]);

  assert.equal(result.children.length, 1, 'only the positive bucket plans a child');
  assert.equal(result.children[0].payload.params.count, 4);
});

// ── 5. Custom batch size is clamped to the worker MAX_QUESTION_COUNT ──

test('maxPerJob above MAX_QUESTION_BATCH_SIZE clamps to the worker ceiling', () => {
  const result = plan([bucket('MCQ', 'MEDIUM', 120)], MAX_QUESTION_BATCH_SIZE + 20);

  assert.ok(result.children.every((c) => c.payload.params.count <= MAX_QUESTION_BATCH_SIZE));
  assert.equal(result.totalQuestions, 120);
});

// ── 6. Multiple buckets keep per-type independence (parallel batches) ──

test('multi-bucket request keeps one job per slot with exact preserved totals', () => {
  const result = plan(
    [bucket('MCQ', 'EASY', 3), bucket('MCQ', 'HARD', 17), bucket('LONG_ANSWER', 'MEDIUM', 21)],
    10,
  );

  // MCQ/EASY 3 -> 1, MCQ/HARD 17 -> 10+7, LONG_ANSWER/MEDIUM 21 -> 10+10+1
  assert.equal(result.children.length, 6);
  assert.equal(result.totalQuestions, 41);

  const mcqHard = result.children.filter(
    (c) => c.payload.params.questionType === 'MCQ' && c.payload.params.difficulty === 'HARD',
  );
  assert.deepEqual(
    mcqHard.map((c) => c.payload.params.count).sort((a, b) => a - b),
    [7, 10],
  );
});

// ── 7. Default batch size used when omitted ───────────────────────────

test('default batch size is DEFAULT_QUESTION_BATCH_SIZE', () => {
  const result = plan([bucket('MCQ', 'EASY', DEFAULT_QUESTION_BATCH_SIZE + 1)]);
  assert.equal(result.children.length, 2);
});
