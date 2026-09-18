// Paper Pattern export renderer — deterministic fixtures, no NestJS/DB.
// Run: node --test apps/api/src/export/paper-pattern-doc.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { PaperPatternStructure } from '@catlium/contracts';
import { paperPatternDoc } from './paper-pattern-doc.ts';

const id = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;

const structure: PaperPatternStructure = {
  totalMarks: 80,
  durationMinutes: 120,
  instructions: ['Read all questions carefully.', 'Show all working.'],
  sections: [
    {
      id: id('1'),
      name: 'Section A',
      questionTypes: [
        {
          id: id('1q'),
          questionType: 'MCQ',
          count: 10,
          marksPerQuestion: 3,
          totalMarks: 30,
          compulsory: true,
          difficultyDistribution: { EASY: 50, MEDIUM: 50, HARD: 0 },
          topicDistribution: [
            { name: 'Algebra', percentage: 60 },
            { name: 'Geometry', percentage: 40 },
          ],
        },
      ],
    },
    {
      id: id('2'),
      name: 'Section B',
      questionTypes: [
        {
          id: id('2q'),
          questionType: 'LONG_ANSWER',
          count: 2,
          marksPerQuestion: 25,
          totalMarks: 50,
          compulsory: false,
          attemptCount: 1,
          difficultyDistribution: null,
          topicDistribution: null,
        },
      ],
    },
  ],
};

const base = {
  title: 'Maths Annual Exam',
  description: 'Common paper for both streams.',
  status: 'APPROVED' as const,
  version: 3,
};

test('General pattern renders meta, instructions, and blueprint table', () => {
  const doc = paperPatternDoc({
    ...base,
    subjectIds: [],
    structure,
    subjectNames: {},
    questionTypeNames: { MCQ: 'Multiple Choice' },
  });
  assert.equal(doc.title, 'Maths Annual Exam');
  const paragraphTexts = doc.blocks
    .filter((b) => b.kind === 'paragraph')
    .map((b) => (b as { text: string }).text);
  assert.ok(
    paragraphTexts.some((t) => t.includes('Status: APPROVED') && t.includes('Version 3')),
    'meta line has status + version',
  );
  assert.ok(
    paragraphTexts.some((t) => t.includes('Duration: 120 min') && t.includes('Total marks: 80')),
    'meta line has duration + marks',
  );
  assert.ok(paragraphTexts.includes('Subjects: General (any subject)'));
  assert.ok(paragraphTexts.includes('Common paper for both streams.'));

  const instructions = doc.blocks.find((b) => b.kind === 'bullets');
  assert.deepEqual((instructions as { items?: string[] } | undefined)?.items, [
    'Read all questions carefully.',
    'Show all working.',
  ]);

  const table = doc.blocks.find((b) => b.kind === 'table') as {
    headers?: string[];
    rows: string[][];
  };
  assert.equal(table.headers?.[0], 'Section');
  assert.deepEqual(table.rows[0], [
    'Section A — MCQ',
    'Multiple Choice',
    '10',
    '3',
    '30',
    'Compulsory',
    '50/50/0 (E/M/H)',
    'Algebra 60%, Geometry 40%',
  ]);
  assert.deepEqual(table.rows[1], [
    'Section B — LONG_ANSWER',
    'LONG_ANSWER',
    '2',
    '25',
    '50',
    'Attempt 1 of 2',
    '—',
    '—',
  ]);
});

test('multi-subject pattern renders resolved subject names', () => {
  const doc = paperPatternDoc({
    ...base,
    subjectIds: [id('a'), id('b')],
    structure,
    subjectNames: { [id('a')]: 'Mathematics', [id('b')]: 'Physics' },
    questionTypeNames: {},
  });
  const subjects = (
    doc.blocks.find(
      (b) => b.kind === 'paragraph' && (b as { text: string }).text.startsWith('Subjects:'),
    ) as { text: string }
  ).text;
  assert.ok(subjects.includes('Subjects: Mathematics, Physics'));
});

test('unknown/removed question-type codes render as their raw code', () => {
  const doc = paperPatternDoc({
    ...base,
    subjectIds: [],
    structure,
    subjectNames: {},
    questionTypeNames: {}, // LONG_ANSWER removed from the institute's config
  });
  const table = doc.blocks.find((b) => b.kind === 'table') as { rows: string[][] };
  assert.equal(table.rows[1]?.[1], 'LONG_ANSWER');
});

test('pattern without a blueprint renders a usable config reference', () => {
  const doc = paperPatternDoc({
    ...base,
    subjectIds: [id('a')],
    structure: null,
    subjectNames: { [id('a')]: 'Chemistry' },
    questionTypeNames: {},
  });
  const texts = doc.blocks
    .filter((b) => b.kind === 'paragraph')
    .map((b) => (b as { text: string }).text);
  assert.ok(texts.some((t) => t.includes('Duration: —') && t.includes('Total marks: —')));
  assert.ok(texts.includes('No blueprint configured yet.'));
  assert.equal(
    doc.blocks.find((b) => b.kind === 'table'),
    undefined,
  );
});

test('instructions are omitted when none are configured', () => {
  const doc = paperPatternDoc({
    ...base,
    subjectIds: [],
    structure: { ...structure, instructions: [] },
    subjectNames: {},
    questionTypeNames: {},
  });
  assert.equal(
    doc.blocks.find((b) => b.kind === 'bullets'),
    undefined,
  );
  assert.ok(doc.blocks.some((b) => b.kind === 'heading' && b.text === 'Blueprint'));
});
