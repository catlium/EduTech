// Question Paper export blocks — deterministic fixtures, no NestJS/DB.
// Run: node --test apps/api/src/export/qp-doc.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { PaperPatternStructure } from '@catlium/contracts';
import { exportPaperBlocks } from './export.content-blocks.ts';

const structure: PaperPatternStructure = {
  totalMarks: 6,
  durationMinutes: 30,
  instructions: ['Show all working.'],
  sections: [
    {
      id: 'a',
      name: 'Section A',
      questionType: 'MCQ',
      count: 2,
      marksPerQuestion: 1,
      totalMarks: 2,
      compulsory: true,
      difficultyDistribution: { EASY: 100, MEDIUM: 0, HARD: 0 },
      topicDistribution: null,
    },
    {
      id: 'b',
      name: 'Section B',
      questionType: 'LONG_ANSWER',
      count: 2,
      marksPerQuestion: 2,
      totalMarks: 4,
      compulsory: false,
      attemptCount: 1,
      difficultyDistribution: null,
      topicDistribution: null,
    },
  ],
};

const link = (stem: string, section: string, sortOrder: number, marks: number) => ({
  stem,
  questionType: 'MCQ',
  difficulty: 'EASY',
  payload: { options: [] },
  explanation: 'xplain',
  marks,
  sortOrder,
  section,
});

const input = {
  title: 'QP Test',
  durationMinutes: 30,
  maxMarks: 6,
  instructions: ['Show all working.'],
  links: [
    link('q1', 'Section A', 1, 1),
    link('q2', 'Section A', 2, 1),
    link('q3', 'Section B', 1, 2),
    link('q4', 'General', 1, 2),
  ],
  patternSections: structure.sections,
};

test('student scope: headings per section, attempt note, no answers', () => {
  const blocks = exportPaperBlocks({ ...input, scope: 'paper' });
  const texts = blocks.map((b) => (b.kind === 'heading' ? b.text : null));
  assert.deepEqual(texts.filter(Boolean), ['Section A', 'Section B', 'General']);
  assert.ok(blocks.some((b) => b.kind === 'paragraph' && b.text.includes('Attempt any 1 of 2')));
  const flat = JSON.stringify(blocks);
  assert.ok(!flat.includes('xplain'), 'student paper must not contain the explanation');
});

test('teacher scope: includes explanations', () => {
  const blocks = exportPaperBlocks({ ...input, scope: 'teacher' });
  assert.ok(JSON.stringify(blocks).includes('xplain'));
});