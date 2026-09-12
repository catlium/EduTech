import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBankBuckets, buildBucketsFromBlueprint } from './build-bank-buckets.ts';

test('single type, MEDIUM 100 keeps all count in one bucket', () => {
  const buckets = buildBankBuckets({
    questionTypes: ['MCQ'],
    count: 6,
    difficultyDistribution: { EASY: 0, MEDIUM: 100, HARD: 0 },
  });
  assert.deepEqual(buckets, [{ questionType: 'MCQ', difficulty: 'MEDIUM', count: 6 }]);
});

test('mixed types and distribution survive a small count and sum exactly', () => {
  const buckets = buildBankBuckets({
    questionTypes: ['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'],
    count: 4,
    difficultyDistribution: { EASY: 33, MEDIUM: 34, HARD: 33 },
  });
  const total = buckets.reduce((s, b) => s + b.count, 0);
  assert.equal(total, 4);
  const types = new Set(buckets.map((b) => b.questionType));
  assert.deepEqual([...types].sort(), ['FILL_IN_BLANK', 'MCQ', 'TRUE_FALSE']);
  assert.ok(buckets.some((b) => b.difficulty === 'MEDIUM'));
});

test('no type or difficulty is ever dropped when count is small', () => {
  const buckets = buildBankBuckets({
    questionTypes: ['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'],
    count: 3,
    difficultyDistribution: { EASY: 30, MEDIUM: 40, HARD: 30 },
  });
  assert.ok(buckets.length >= 3);
  assert.equal(buckets.reduce((s, b) => s + b.count, 0), 3);
});

test('defaults: no distribution -> MCQs at MEDIUM', () => {
  const buckets = buildBankBuckets({ questionTypes: ['MCQ'], count: 2 });
  assert.deepEqual(buckets, [{ questionType: 'MCQ', difficulty: 'MEDIUM', count: 2 }]);
});

test('only requested difficulties are represented', () => {
  const buckets = buildBankBuckets({
    questionTypes: ['MCQ', 'TRUE_FALSE'],
    count: 10,
    difficultyDistribution: { MEDIUM: 100 },
  });
  assert.deepEqual(buckets, [
    { questionType: 'MCQ', difficulty: 'MEDIUM', count: 5 },
    { questionType: 'TRUE_FALSE', difficulty: 'MEDIUM', count: 5 },
  ]);
});

test('blueprint sections become quota buckets and unmet sections are skipped', () => {
  const buckets = buildBucketsFromBlueprint([
    { questionType: 'MCQ', count: 4, difficultyDistribution: { EASY: 50, MEDIUM: 50, HARD: 0 } },
    { questionType: 'TRUE_FALSE', count: 2, difficultyDistribution: null },
    { name: 'topic-only section', count: 8, questionType: undefined },
    { questionType: 'MCQ', count: null },
  ]);
  const byKey = new Map(buckets.map((b) => [`${b.questionType}|${b.difficulty}`, b.count]));
  assert.equal(byKey.get('MCQ|EASY'), 2);
  assert.equal(byKey.get('MCQ|MEDIUM'), 2);
  assert.equal(byKey.get('TRUE_FALSE|MEDIUM'), 2);
  assert.equal(buckets.reduce((s, b) => s + b.count, 0), 6);
  assert.ok([...byKey.keys()].every((k) => !k.startsWith('MCQ|HARD')));
});