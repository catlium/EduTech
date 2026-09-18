import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PaperPatternStructure } from '@catlium/contracts';
import { buildPatternDemandBuckets, type DemandBucket } from './pattern-demand.ts';

type Rule = PaperPatternStructure['sections'][number]['questionTypes'][number];

/* A synthetic rule: `count` = presented (M), `attemptCount` = attempted (N). */
const rule = (over: Partial<Rule> = {}): Rule =>
  ({
    id: '00000000-0000-0000-0000-000000000001',
    compulsory: true,
    questionType: 'MCQ',
    count: 3,
    marksPerQuestion: 1,
    totalMarks: 3,
    attemptCount: null,
    difficultyDistribution: { EASY: 0, MEDIUM: 100, HARD: 0 },
    topicDistribution: null,
    ...over,
  }) as Rule;

const structure = (id: string, name: string, questionTypes: Rule[]): PaperPatternStructure =>
  ({ sections: [{ id, name, questionTypes }] }) as PaperPatternStructure;

const first = (b: DemandBucket[]) => b.find((x) => x.difficulty === 'MEDIUM')!;

test('attempt-N-of-M demands the full presented count M, not N', () => {
  const buckets = buildPatternDemandBuckets(
    structure('s1', 'Section A', [rule({ count: 3, compulsory: false, attemptCount: 2 })]),
  );
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]!.questionType, 'MCQ');
  assert.equal(first(buckets).count, 3);
});

test('two sections sharing a type merge into one distinct-set demand', () => {
  const buckets = buildPatternDemandBuckets({
    sections: [
      { id: 'a', name: 'A', questionTypes: [rule()] },
      { id: 'b', name: 'B', questionTypes: [rule()] },
    ],
  } as PaperPatternStructure);
  assert.deepEqual(buckets, [{ questionType: 'MCQ', difficulty: 'MEDIUM', count: 6 }]);
});

test('no distribution defaults the whole count to MEDIUM', () => {
  const buckets = buildPatternDemandBuckets(
    structure('s1', 'A', [rule({ difficultyDistribution: null })]),
  );
  assert.deepEqual(buckets, [{ questionType: 'MCQ', difficulty: 'MEDIUM', count: 3 }]);
});

test('split across difficulties sums exactly to the required count', () => {
  const buckets = buildPatternDemandBuckets(
    structure('s1', 'A', [
      rule({ count: 10, difficultyDistribution: { EASY: 33, MEDIUM: 33, HARD: 34 } }),
    ]),
  );
  const byDifficulty = Object.fromEntries(buckets.map((b) => [b.difficulty, b.count]));
  assert.deepEqual(byDifficulty, { EASY: 3, MEDIUM: 3, HARD: 4 });
  assert.equal(
    buckets.reduce((sum, b) => sum + b.count, 0),
    10,
  );
});

test('rules without a count or question type contribute nothing', () => {
  const buckets = buildPatternDemandBuckets({
    sections: [
      { id: 's1', name: 'A', questionTypes: [rule({ count: 0 })] },
      { id: 's2', name: 'B', questionTypes: [rule({ questionType: undefined })] },
    ],
  } as PaperPatternStructure);
  assert.deepEqual(buckets, []);
});
