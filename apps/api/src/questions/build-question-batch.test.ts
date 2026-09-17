// Per-type min/max question-bank batch planner — pure function, no NestJS.
// Run: node --test apps/../apps/api/src/questions/build-question-batch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planQuestionBankJobs,
  questionTypeBatchLimits,
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

function plan(buckets: BankBucket[]) {
  return planQuestionBankJobs({
    batchId: BATCH_ID,
    batchSource: { type: 'TOPIC', id: SOURCE.id },
    source: SOURCE,
    userId: USER_ID,
    buckets,
    typeFormats: TYPE_FORMATS,
  });
}

// ── 1. Type limits table ──────────────────────────────────────────────

test('per-type limits follow the recommendation table', () => {
  assert.deepEqual(questionTypeBatchLimits('MCQ'), { min: 20, max: 30 });
  assert.deepEqual(questionTypeBatchLimits('TRUE_FALSE'), { min: 15, max: 25 });
  assert.deepEqual(questionTypeBatchLimits('FILL_IN_BLANK'), { min: 15, max: 25 });
  assert.deepEqual(questionTypeBatchLimits('SHORT_ANSWER'), { min: 10, max: 15 });
  assert.deepEqual(questionTypeBatchLimits('LONG_ANSWER'), { min: 6, max: 10 });
  assert.deepEqual(questionTypeBatchLimits('NUMERICAL'), { min: 10, max: 15 });
  assert.deepEqual(questionTypeBatchLimits('CASE_STUDY'), { min: 4, max: 6 });
});

test('unknown or institute-defined types fall back to the default limits', () => {
  assert.deepEqual(questionTypeBatchLimits('CUSTOM_ESSAY'), { min: 10, max: 15 });
});

// ── 2. Request below the type min is floored to the min ───────────────

test('a type below its min is floored up to the min', () => {
  const result = plan([bucket('MCQ', 'EASY', 3)]);

  assert.equal(result.totalQuestions, questionTypeBatchLimits('MCQ').min);
  assert.equal(result.children.length, 1);
  assert.equal(result.children[0]!.payload.params.count, 20);
});

test('a small request is spread across the requested difficulties', () => {
  const result = plan([bucket('MCQ', 'EASY', 1), bucket('MCQ', 'HARD', 1)]);

  assert.equal(result.totalQuestions, 20);
  const byDifficulty = new Map(result.children.map((c) => [c.payload.params.difficulty, c.payload.params.count]));
  assert.equal(byDifficulty.get('EASY')! + byDifficulty.get('HARD')!, 20);
  assert.ok(!byDifficulty.has('MEDIUM'), 'unrequested difficulty not invented');
});

test('exactly-min request is not inflated', () => {
  const result = plan([bucket('MCQ', 'MEDIUM', 20)]);
  assert.equal(result.totalQuestions, 20);
  assert.equal(result.children.length, 1);
});

// ── 3. Split above the type max keeps every child <= the type max ─────

test('bucket above the type max splits into sub-batches of <= the type max', () => {
  const result = plan([bucket('MCQ', 'HARD', 65)]);

  const { max } = questionTypeBatchLimits('MCQ');
  assert.ok(result.children.every((c) => c.payload.params.count <= max));
  assert.equal(result.totalQuestions, 65);
  assert.deepEqual(
    result.children.map((c) => c.payload.params.count).sort((a, b) => a - b),
    [5, 30, 30],
    '65/30 -> 30+30+5',
  );
  for (const child of result.children) {
    assert.deepEqual(child.payload.params.questionType, 'MCQ');
    assert.deepEqual(child.payload.params.difficulty, 'HARD');
  }
});

test('maxPerJob never exceeds the worker MAX_QUESTION_COUNT ceiling', () => {
  const result = plan([bucket('CASE_STUDY', 'MEDIUM', MAX_QUESTION_BATCH_SIZE * 2)]);
  assert.ok(result.children.every((c) => c.payload.params.count <= MAX_QUESTION_BATCH_SIZE));
  assert.equal(result.totalQuestions, MAX_QUESTION_BATCH_SIZE * 2);
  for (const child of result.children) {
    assert.ok(child.payload.params.count <= questionTypeBatchLimits('CASE_STUDY').max);
  }
});

// ── 4. Child wiring ───────────────────────────────────────────────────

test('children share the batch wiring with unique dedupKey slots', () => {
  const result = plan([bucket('MCQ', 'MEDIUM', 40)]);
  assert.ok(result.children.length >= 2, 'split produces multiple children');
  const keys = result.children.map((c) => c.dedupKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const child of result.children) {
    assert.equal(child.payload.batchId, BATCH_ID);
    assert.deepEqual(child.payload.batchSource, { type: 'TOPIC', id: SOURCE.id });
    assert.deepEqual(child.payload.source, SOURCE);
    assert.equal(child.payload.requestedBy, USER_ID);
    assert.equal(child.payload.operation, 'AI_GENERATE_QUESTIONS');
    assert.equal(child.payload.params.dedupKey, child.dedupKey);
    assert.deepEqual(child.payload.params.types, TYPE_FORMATS);
    assert.ok(child.dedupKey.startsWith(`qbank:${BATCH_ID}:MCQ:MEDIUM:`));
  }
});

// ── 5. Zero-count buckets produce nothing ─────────────────────────────

test('zero-count buckets are dropped and no child asks for 0 questions', () => {
  const result = plan([bucket('MCQ', 'EASY', 0), bucket('TRUE_FALSE', 'HARD', 0)]);

  assert.equal(result.children.length, 0);
  assert.equal(result.totalQuestions, 0);
});