// Export module content mapper unit tests — deterministic fixtures, no NestJS.
// Run: node --test apps/api/src/export/export.service.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  contentBlocks,
  questionDocBlock,
  docDigest,
  buildPreview,
  orderQuestionTypes,
  questionTypeRank,
} from './export.content-blocks.ts';
import type { DocBlock, DocumentModel } from './export.content-blocks.ts';

test('NOTE payload maps blocks: heading, paragraph, list', () => {
  const blocks = contentBlocks('NOTE', {
    title: 'T',
    blocks: [
      { type: 'heading', content: 'H' },
      { type: 'paragraph', content: 'P' },
      { type: 'list', items: ['a', 'b'] },
    ],
  });
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'T' },
    { kind: 'heading', text: 'H' },
    { kind: 'paragraph', text: 'P' },
    { kind: 'bullets', items: ['a', 'b'] },
  ]);
});

test('NOTE formula block maps enriched fields and drops malformed variables', () => {
  const blocks = contentBlocks('NOTE', {
    blocks: [
      {
        type: 'formula',
        content: 'E = mc^2',
        title: 'Mass–energy equivalence',
        explanation: 'Energy equals mass times the speed of light squared.',
        variables: [
          { symbol: 'E', meaning: 'energy' },
          { symbol: 'm', meaning: 'mass' },
          'garbage',
        ],
        example: 'For 1 kg of mass, E is ~9e16 J.',
        note: 'Applies only to isolated systems.',
      },
    ],
  });
  assert.deepEqual(blocks, [
    {
      kind: 'formula',
      content: 'E = mc^2',
      title: 'Mass–energy equivalence',
      explanation: 'Energy equals mass times the speed of light squared.',
      variables: [
        { symbol: 'E', meaning: 'energy' },
        { symbol: 'm', meaning: 'mass' },
      ],
      example: 'For 1 kg of mass, E is ~9e16 J.',
      note: 'Applies only to isolated systems.',
    },
  ]);
});

test('SUMMARY payload maps summary + keyConcepts + importantPoints', () => {
  const blocks = contentBlocks('SUMMARY', {
    title: 'Sum',
    summary: 'body',
    keyConcepts: ['k1'],
    importantPoints: ['i1', 'i2'],
  });
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'Sum' },
    { kind: 'paragraph', text: 'body' },
    { kind: 'bullets', items: ['k1'] },
    { kind: 'bullets', items: ['i1', 'i2'] },
  ]);
});

test('FLASHCARD_SET maps cards and drops malformed entries', () => {
  const blocks = contentBlocks('FLASHCARD_SET', {
    title: 'FC',
    description: 'desc',
    cards: [{ front: 'f1', back: 'b1' }, { front: 'f2' }, 'garbage'],
  });
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'FC' },
    { kind: 'paragraph', text: 'desc' },
    { kind: 'flashcard', front: 'f1', back: 'b1' },
  ]);
});

test('IMPORTANT_CONCEPTS maps concepts with optional description', () => {
  const blocks = contentBlocks('IMPORTANT_CONCEPTS', {
    concepts: [{ name: 'N1', description: 'D1' }, { name: 'N2' }],
  });
  assert.deepEqual(blocks, [
    { kind: 'paragraph', text: 'N1 — D1' },
    { kind: 'paragraph', text: 'N2' },
  ]);
});

test('unknown type falls back to JSON dump', () => {
  const doc: DocumentModel = {
    title: 'X',
    blocks: contentBlocks('WEIRD', { foo: 1 }),
  };
  assert.equal(doc.blocks[0]?.kind, 'paragraph');
  assert.match(doc.blocks[0]?.text as string, /"foo"/);
});

/* Preview/export gate: the digest is deterministic per document and
 * changes with any content, so a stale preview is always detected. */
test('docDigest is deterministic and content-sensitive', () => {
  const a: DocumentModel = {
    title: 'T',
    blocks: [
      { kind: 'heading', text: 'H' },
      {
        kind: 'question',
        stem: 'S?',
        type: 'MCQ',
        difficulty: 'EASY',
        choices: [],
        showAnswer: true,
      },
    ],
  };
  const b: DocumentModel = { ...a, blocks: [...a.blocks, { kind: 'paragraph', text: 'more' }] };
  const c: DocumentModel = { ...a, blocks: [{ kind: 'heading', text: 'H' }] };
  assert.equal(docDigest(a), docDigest({ ...a, blocks: a.blocks.map((blk) => ({ ...blk })) }));
  assert.equal(docDigest(a), buildPreview(a).hash);
  assert.notEqual(docDigest(a), docDigest(b));
  assert.notEqual(docDigest(a), docDigest(c));
});

test('questionDocBlock: teacher shows the answer, paper hides it', () => {
  const payload = {
    choices: [
      { id: 'c1', text: 'Paris' },
      { id: 'c2', text: 'Rome' },
    ],
    correctChoiceId: 'c2',
  };
  const asQuestion = (b: DocBlock) => b as Extract<DocBlock, { kind: 'question' }>;
  const teacher = asQuestion(
    questionDocBlock({
      stem: 'Capital of France?',
      type: 'MCQ',
      difficulty: 'EASY',
      payload,
      includeAnswers: true,
    }),
  );
  const paper = asQuestion(
    questionDocBlock({
      stem: 'Capital of France?',
      type: 'MCQ',
      difficulty: 'EASY',
      payload,
      includeAnswers: false,
      scope: 'paper',
    }),
  );
  assert.equal(teacher.showAnswer, true);
  assert.equal(teacher.answerNote, undefined);
  assert.equal(teacher.choices?.[1]?.correct, true);
  assert.equal(teacher.difficulty, 'EASY');
  assert.equal(paper.showAnswer, false);
  assert.equal(paper.difficulty, '');
  assert.equal(paper.choices?.[1]?.correct, false);
});

test('questionDocBlock: TEXT questions surface the modelAnswer as the answer note', () => {
  const asQuestion = (b: DocBlock) => b as Extract<DocBlock, { kind: 'question' }>;
  const teacher = asQuestion(
    questionDocBlock({
      stem: 'Explain photosynthesis.',
      type: 'SHORT_ANSWER',
      difficulty: 'MEDIUM',
      payload: { answerFormat: 'TEXT', modelAnswer: 'Plants convert sunlight into energy.' },
      includeAnswers: true,
    }),
  );
  const paper = asQuestion(
    questionDocBlock({
      stem: 'Explain photosynthesis.',
      type: 'SHORT_ANSWER',
      difficulty: 'MEDIUM',
      payload: { answerFormat: 'TEXT', modelAnswer: 'Plants convert sunlight into energy.' },
      includeAnswers: false,
      scope: 'paper',
    }),
  );
  assert.equal(teacher.answerNote, 'Plants convert sunlight into energy.');
  assert.equal(teacher.showAnswer, true);
  assert.equal(paper.answerNote, undefined);
  assert.equal(paper.showAnswer, false);
});

test('orderQuestionTypes: objective first, then short-answer, then long-answer', () => {
  for (const objective of ['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK', 'MATCHING', 'NUMERICAL']) {
    assert.equal(questionTypeRank(objective), 0, objective);
  }
  assert.equal(questionTypeRank('SHORT_ANSWER'), 1);
  assert.equal(questionTypeRank('LONG_ANSWER'), 2);
  assert.equal(questionTypeRank('CASE_STUDY'), 2);

  const ordered = orderQuestionTypes(['LONG_ANSWER', 'MCQ', 'SHORT_ANSWER', 'CASE_STUDY', 'TRUE_FALSE']);
  assert.deepEqual(ordered, ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'LONG_ANSWER', 'CASE_STUDY']);

  // Ties keep their caller-supplied order (stable).
  assert.deepEqual(orderQuestionTypes(['TRUE_FALSE', 'MCQ', 'NUMERICAL']), [
    'TRUE_FALSE',
    'MCQ',
    'NUMERICAL',
  ]);
});
