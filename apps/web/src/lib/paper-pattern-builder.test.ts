// Paper Pattern builder — dynamic question-type behavior, deterministic tests.
// Run: node --test apps/web/src/lib/paper-pattern-builder.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  questionTypeLabel,
  buildBackendSections,
  parseBackendSections,
  ruleSubtotal,
  collectIssues,
  emptyRule,
  type BackendSection,
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

test('build/parse round-trip preserves arbitrary custom question-type codes', () => {
  const sections: Section[] = [
    {
      id: 's1',
      name: 'Section A',
      rules: [
        {
          id: 'r1',
          questionType: 'VERY_SHORT_ANSWER',
          count: 5,
          marksPerQuestion: 2,
          compulsory: true,
          attemptCount: null,
          difficulty: { EASY: 40, MEDIUM: 60, HARD: 0 },
          topics: [],
        },
        {
          id: 'r2',
          questionType: 'CUSTOM_TYPE_2',
          count: 3,
          marksPerQuestion: 4,
          compulsory: true,
          attemptCount: null,
          difficulty: { EASY: '', MEDIUM: '', HARD: '' },
          topics: [],
        },
      ],
    },
  ];
  const backend = buildBackendSections(sections);
  assert.equal(backend.length, 1);
  assert.deepEqual(
    backend[0]?.questionTypes.map((qt) => qt.questionType),
    ['VERY_SHORT_ANSWER', 'CUSTOM_TYPE_2'],
  );

  const parsed = parseBackendSections(backend);
  assert.deepEqual(
    parsed[0]?.rules.map((r) => r.questionType),
    ['VERY_SHORT_ANSWER', 'CUSTOM_TYPE_2'],
  );
});

test('attempt N of M is per rule and affects the subtotal', () => {
  const optionalLong: Section = {
    id: 's1',
    name: 'Section C',
    rules: [
      {
        id: 'r1',
        questionType: 'LONG_ANSWER',
        count: 3,
        marksPerQuestion: 3,
        compulsory: false,
        attemptCount: 2,
        difficulty: { EASY: '', MEDIUM: '', HARD: '' },
        topics: [],
      },
    ],
  };
  assert.equal(ruleSubtotal(optionalLong.rules[0]!), 6);
  const backend = buildBackendSections([optionalLong]);
  assert.equal(backend[0]?.questionTypes[0]?.compulsory, false);
  assert.equal(backend[0]?.questionTypes[0]?.attemptCount, 2);
  assert.equal(backend[0]?.questionTypes[0]?.totalMarks, 6);
});

test('parseBackendSections handles legacy flat sections', () => {
  const legacy: BackendSection[] = [
    {
      id: 's1',
      name: 'Section A',
      questionTypes: [
        {
          id: 'q1',
          questionType: 'MCQ',
          count: 6,
          marksPerQuestion: 1,
          compulsory: true,
          attemptCount: null,
          difficultyDistribution: null,
          topicDistribution: null,
        },
      ],
    },
  ];
  const parsed = parseBackendSections(legacy);
  assert.equal(parsed[0]?.rules[0]?.questionType, 'MCQ');
});

test('collectIssues labels rules with config names and falls back to raw code', () => {
  const sections: Section[] = [
    {
      id: 's1',
      name: 'Section A',
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