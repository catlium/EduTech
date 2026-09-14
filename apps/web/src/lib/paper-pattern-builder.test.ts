// Paper Pattern builder — dynamic question-type behavior, deterministic tests.
// Run: node --test apps/web/src/lib/paper-pattern-builder.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  questionTypeLabel,
  flattenSections,
  parseBackendSections,
  collectIssues,
  emptyRule,
  type Section,
} from './paper-pattern-builder.ts';

test('questionTypeLabel resolves from the API config source', () => {
  const labels = { MCQ: 'Multiple Choice', CUSTOM_TYPE_2: 'Coding Question' };
  assert.equal(questionTypeLabel('MCQ', labels), 'Multiple Choice');
  assert.equal(questionTypeLabel('CUSTOM_TYPE_2', labels), 'Coding Question');
});

test('questionTypeLabel handles unknown/removed codes with the raw code', () => {
  assert.equal(questionTypeLabel('LONG_ANSWER', {}), 'LONG_ANSWER');
  assert.equal(questionTypeLabel('CUSTOM_TYPE_2'), 'CUSTOM_TYPE_2');
  assert.equal(questionTypeLabel('', {}), 'Mixed');
});

test('flatten/parse round-trip preserves arbitrary custom question-type codes', () => {
  const sections: Section[] = [
    {
      id: 's1',
      name: 'Section A',
      compulsory: true,
      attemptCount: null,
      rules: [
        {
          id: 'r1',
          questionType: 'VERY_SHORT_ANSWER',
          count: 5,
          marksPerQuestion: 2,
          difficulty: { EASY: 40, MEDIUM: 60, HARD: 0 },
          topics: [],
        },
        {
          id: 'r2',
          questionType: 'CUSTOM_TYPE_2',
          count: 3,
          marksPerQuestion: 4,
          difficulty: { EASY: '', MEDIUM: '', HARD: '' },
          topics: [],
        },
      ],
    },
  ];
  const backend = flattenSections(sections);
  assert.equal(backend[0]?.questionType, 'VERY_SHORT_ANSWER');
  assert.equal(backend[1]?.questionType, 'CUSTOM_TYPE_2');

  const parsed = parseBackendSections(backend);
  assert.deepEqual(
    parsed[0]?.rules.map((r) => r.questionType),
    ['VERY_SHORT_ANSWER', 'CUSTOM_TYPE_2'],
  );
});

test('collectIssues labels rules with config names and falls back to raw code', () => {
  const sections: Section[] = [
    {
      id: 's1',
      name: 'Section A',
      compulsory: true,
      attemptCount: null,
      rules: [
        { ...emptyRule(), questionType: 'CUSTOM_TYPE_2', count: 5 },
        { ...emptyRule(), questionType: 'LONG_ANSWER', count: 2 },
      ],
    },
  ];
  const labels = { CUSTOM_TYPE_2: 'Coding Question', MCQ: 'MCQ' };
  const issues = collectIssues(sections, labels);
  assert.ok(
    issues.some((i) => i.includes('Section A · Coding Question')),
    'configured code uses its config name',
  );
  assert.ok(
    issues.some((i) => i.includes('Section A · LONG_ANSWER')),
    'removed/unknown code falls back to the raw code',
  );
});
