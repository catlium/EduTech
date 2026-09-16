import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planAutoSelection,
  computePatternCoverage,
  type PatternSectionInput,
  type CandidateQuestion,
} from './paper-selection.ts';

function section(partial: Partial<PatternSectionInput> = {}): PatternSectionInput {
  return {
    id: 's1',
    name: 'Section A',
    questionType: 'MCQ',
    count: 3,
    marksPerQuestion: 2,
    compulsory: true,
    ...partial,
  };
}

function candidates(types: string[], difficulty: CandidateQuestion['difficulty'] = 'MEDIUM') {
  return types.map((questionType, i) => ({ id: `q-${i}`, questionType, difficulty }));
}

test('compulsory section selects exactly count questions at marksPerQuestion', () => {
  const plan = planAutoSelection(
    [section()],
    candidates(['MCQ', 'MCQ', 'MCQ', 'MCQ']),
  );
  assert.equal(plan.totalSelected, 3);
  assert.equal(plan.totalMarks, 6);
  assert.equal(plan.sections[0]!.selected.length, 3);
  assert.equal(plan.sections[0]!.marks, 2);
  assert.deepEqual(plan.sections[0]!.shortages, []);
});

test('questions already in the assessment (takenIds) are not reused', () => {
  const plan = planAutoSelection(
    [section()],
    candidates(['MCQ', 'MCQ', 'MCQ', 'MCQ', 'MCQ']),
    new Set(['q-0', 'q-1']),
  );
  assert.equal(plan.sections[0]!.selected.length, 3);
  assert.equal(plan.sections[0]!.selected.includes('q-0'), false);
  assert.equal(plan.sections[0]!.selected.includes('q-1'), false);
});

test('difficulty distribution is honored with per-difficulty allocation', () => {
  const plan = planAutoSelection(
    [
      section({
        count: 4,
        difficultyDistribution: { EASY: 50, HARD: 50 },
      }),
    ],
    candidates(['MCQ', 'MCQ', 'MCQ', 'MCQ'], 'EASY').concat(
      candidates(['MCQ', 'MCQ', 'MCQ', 'MCQ'], 'HARD'),
    ),
  );
  assert.equal(plan.totalSelected, 4);
  assert.deepEqual(plan.sections[0]!.shortages, []);
});

test('interleaved difficulty pools still respect the allocation (regression)', () => {
  const pool = [
    { id: 'h1', questionType: 'MCQ', difficulty: 'HARD' },
    { id: 'e1', questionType: 'MCQ', difficulty: 'EASY' },
    { id: 'h2', questionType: 'MCQ', difficulty: 'HARD' },
    { id: 'e2', questionType: 'MCQ', difficulty: 'EASY' },
    { id: 'h3', questionType: 'MCQ', difficulty: 'HARD' },
    { id: 'e3', questionType: 'MCQ', difficulty: 'EASY' },
  ];
  const plan = planAutoSelection(
    [
      section({
        count: 4,
        difficultyDistribution: { EASY: 50, HARD: 50 },
      }),
    ],
    pool as CandidateQuestion[],
  );
  assert.equal(plan.totalSelected, 4);
  assert.deepEqual(plan.sections[0]!.shortages, []);
  const picked = plan.sections[0]!.selected;
  assert.equal(picked.filter((id) => id.startsWith('e')).length, 2);
  assert.equal(picked.filter((id) => id.startsWith('h')).length, 2);
});

test('zero-weight difficulty must not be overshot (regression)', () => {
  const plan = planAutoSelection(
    [section({ count: 3, difficultyDistribution: { EASY: 50, MEDIUM: 50, HARD: 0 } })],
    [
      { id: 'e1', questionType: 'MCQ', difficulty: 'EASY' },
      { id: 'm1', questionType: 'MCQ', difficulty: 'MEDIUM' },
      { id: 'h1', questionType: 'MCQ', difficulty: 'HARD' },
      { id: 'e2', questionType: 'MCQ', difficulty: 'EASY' },
      { id: 'm2', questionType: 'MCQ', difficulty: 'MEDIUM' },
    ] as CandidateQuestion[],
  );
  assert.equal(plan.sections[0]!.found, 3);
  assert.deepEqual(plan.sections[0]!.shortages, []);
  assert.equal(plan.sections[0]!.selected.includes('h1'), false);
});

test('thin bank reports an honest shortage and fills from fallback difficulties', () => {
  const plan = planAutoSelection(
    [section({ count: 4, difficultyDistribution: { EASY: 100 } })],
    candidates(['MCQ', 'MCQ'], 'MEDIUM'),
  );
  assert.equal(plan.sections[0]!.found, 2);
  assert.equal(plan.sections[0]!.requested, 4);
  assert.ok(plan.sections[0]!.shortages.some((s) => s.includes('EASY')));
  assert.ok(plan.sections[0]!.shortages.some((s) => s.includes('different difficulty')));
});

test('optional "attempt N of M" fills the presented set (M) and still reports N', () => {
  const plan = planAutoSelection(
    [section({ count: 3, attemptCount: 2, compulsory: false })],
    candidates(['MCQ', 'MCQ', 'MCQ', 'MCQ']),
  );
  assert.equal(plan.sections[0]!.requested, 3);
  assert.equal(plan.sections[0]!.selected.length, 3);

  const coverage = computePatternCoverage(
    [section({ count: 3, attemptCount: 2, compulsory: false })],
    [
      { section: 'Section A', questionType: 'MCQ', marks: 2 },
      { section: 'Section A', questionType: 'MCQ', marks: 2 },
      { section: 'Section A', questionType: 'MCQ', marks: 2 },
    ],
  );
  assert.equal(coverage[0]!.requiredCount, 3);
  assert.equal(coverage[0]!.attemptCount, 2);
  assert.equal(coverage[0]!.requiredMarks, 4); // attemptCount(2) × marks(2) — what a student can score
  assert.equal(coverage[0]!.status, 'OK');
});

test('optional section marks derive from totalMarks split by attemptCount', () => {
  const plan = planAutoSelection(
    [
      section({
        count: 3,
        attemptCount: 2,
        totalMarks: 10,
        compulsory: false,
        marksPerQuestion: null,
      }),
    ],
    candidates(['MCQ', 'MCQ', 'MCQ']),
  );
  assert.equal(plan.sections[0]!.marks, 5);
});

test('section without questionType or count is skipped with a reason', () => {
  const plan = planAutoSelection([section({ questionType: null, count: null })], candidates(['MCQ']));
  assert.equal(plan.sections[0]!.found, 0);
  assert.equal(plan.sections[0]!.shortages.length, 1);
});

test('coverage reports SHORT, EXCESS, TYPE_MISMATCH and the Unassigned bucket', () => {
  const link = { section: 'Section A', questionType: 'MCQ', marks: 2 };
  assert.equal(
    computePatternCoverage([section()], [link])[0]!.status,
    'SHORT',
  );
  assert.equal(
    computePatternCoverage([section({ attemptCount: 2 })], [
      { ...link, section: 'Other' },
    ])[0]!.status,
    'SHORT',
  );

  const full = [
    { section: 'Section A', questionType: 'MCQ', marks: 2 },
    { section: 'Section A', questionType: 'MCQ', marks: 2 },
    { section: 'Section A', questionType: 'MCQ', marks: 2 },
  ];
  const ok = computePatternCoverage([section()], full)[0]!;
  assert.equal(ok.status, 'OK');
  assert.equal(ok.presentMarks, 6);

  const excess = computePatternCoverage([section()], [...full, ...full.slice(0, 1)])[0]!;
  assert.equal(excess.status, 'EXCESS');

  const mismatch = computePatternCoverage(
    [section()],
    full.map((l) => ({ ...l, questionType: 'FILL_IN_BLANK' })),
  )[0]!;
  assert.equal(mismatch.status, 'TYPE_MISMATCH');

  const coverage = computePatternCoverage([section()], [
    { section: 'Nowhere', questionType: 'MCQ', marks: 2 },
  ]);
  assert.ok(coverage.some((c) => c.name === 'Unassigned' && c.status === 'TYPE_MISMATCH'));
});

test('marks default to 1 when neither marksPerQuestion nor totalMarks is set', () => {
  const plan = planAutoSelection(
    [section({ marksPerQuestion: null, totalMarks: null })],
    candidates(['MCQ']),
  );
  assert.equal(plan.sections[0]!.marks, 1);
});