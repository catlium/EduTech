// Phase 18 paper-pattern validation unit tests — deterministic fixtures, no
// AI, no NestJS, no database. Run:
//   node --test apps/api/src/paper-patterns/paper-patterns.validation.test.ts
// The sibling import uses the .js->.ts rewrite (same pattern as analytics.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validatePaperPatternStructure } from './paper-patterns.validation.ts';
import type { PaperPatternSection, PaperPatternStructure } from '@catlium/contracts';

const UUID = '8f2c0a6e-9b4e-4f6a-9f1c-000000000001';

function section(
  id: string,
  name: string,
  overrides: Partial<PaperPatternSection> = {},
): PaperPatternSection {
  return { id, name, questionType: 'MCQ', count: 10, marksPerQuestion: 1, totalMarks: 10, compulsory: true, ...overrides };
}

function structure(overrides: Partial<PaperPatternStructure> = {}): PaperPatternStructure {
  return {
    totalMarks: 20,
    durationMinutes: 40,
    instructions: [],
    sections: [
      section(`${UUID}1`, 'Section A', { count: 10, marksPerQuestion: 1, totalMarks: 10 }),
      section(`${UUID}2`, 'Section B', {
        questionType: 'TRUE_FALSE',
        count: 5,
        marksPerQuestion: 2,
        totalMarks: 10,
      }),
    ],
    ...overrides,
  };
}

test('valid blueprint passes with no errors', () => {
  assert.deepEqual(validatePaperPatternStructure(structure()), []);
});

test('section total that does not match count x marks is rejected', () => {
  const s = structure({ sections: [section(`${UUID}1`, 'A', { count: 10, marksPerQuestion: 1, totalMarks: 99 })] });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.length > 0, 'expected an error');
  assert.match(errors[0]!, /99 does not match 10/);
});

test('pattern total that does not match the sum of sections is rejected', () => {
  const s = structure({ totalMarks: 999 });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /Total marks 999/.test(e)));
});

test('attemptCount above the available count is rejected', () => {
  const s = structure({
    sections: [section(`${UUID}1`, 'A', { count: 5, attemptCount: 6, compulsory: false })],
  });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /cannot attempt 6 of 5/.test(e)));
});

test('compulsory section that is not fully attempted is rejected', () => {
  const s = structure({
    sections: [section(`${UUID}1`, 'A', { count: 5, attemptCount: 3, compulsory: true })],
  });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /compulsory section/.test(e)));
});

test('optional section without an attempt rule is rejected', () => {
  const s = structure({
    sections: [section(`${UUID}1`, 'A', { count: 5, attemptCount: null, compulsory: false })],
  });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /optional section must declare/.test(e)));
});

test('optional section attempting all available questions is rejected', () => {
  const s = structure({
    sections: [section(`${UUID}1`, 'A', { count: 5, attemptCount: 5, compulsory: false })],
  });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /must be fewer than/.test(e)));
});

test('difficulty distribution not summing to 100 is rejected', () => {
  const s = structure({
    sections: [
      section(`${UUID}1`, 'A', {
        difficultyDistribution: { EASY: 40, MEDIUM: 40, HARD: 40 },
      }),
    ],
  });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /difficulty distribution must total 100/.test(e)));
});

test('difficulty distribution summing to 100 passes', () => {
  const s = structure({
    totalMarks: 10,
    sections: [
      section(`${UUID}1`, 'A', {
        difficultyDistribution: { EASY: 40, MEDIUM: 40, HARD: 20 },
      }),
    ],
  });
  assert.deepEqual(validatePaperPatternStructure(s), []);
});

test('topic distribution not summing to 100 is rejected', () => {
  const s = structure({
    totalMarks: 10,
    sections: [
      section(`${UUID}1`, 'A', {
        topicDistribution: [
          { name: 'Algebra', percentage: 50 },
          { name: 'Geometry', percentage: 30 },
        ],
      }),
    ],
  });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /topic distribution must total 100/.test(e)));
});

test('duplicate section names are rejected', () => {
  const s = structure({ sections: [section(`${UUID}1`, 'A'), section(`${UUID}2`, 'A')] });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /Duplicate section name/.test(e)));
});

test('duplicate section ids are rejected', () => {
  const s = structure({ sections: [section(`${UUID}1`, 'A'), section(`${UUID}1`, 'B')] });
  const errors = validatePaperPatternStructure(s);
  assert.ok(errors.some((e) => /Duplicate section id/.test(e)));
});

test('unknown (null count) does not distort the total-marks check', () => {
  // Section A declares 10 x 1, Section B declares 10 x 2 — totals line up with
  // the pattern even though Section C only declares a total with no counts.
  const s = structure({
    totalMarks: 40,
    sections: [
      section(`${UUID}1`, 'A', { count: 10, marksPerQuestion: 1, totalMarks: 10 }),
      section(`${UUID}2`, 'B', { count: 5, marksPerQuestion: 2, totalMarks: 10 }),
      section(`${UUID}3`, 'C', {
        count: null,
        marksPerQuestion: null,
        questionType: 'FILL_IN_BLANK',
        totalMarks: 20,
      }),
    ],
  });
  assert.deepEqual(validatePaperPatternStructure(s), []);
});