// Export module content mapper unit tests — deterministic fixtures, no NestJS.
// Run: node --test apps/api/src/export/export.service.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contentBlocks } from './export.content-blocks.ts';
import type { DocumentModel } from './export.content-blocks.ts';

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
    cards: [
      { front: 'f1', back: 'b1' },
      { front: 'f2' },
      'garbage',
    ],
  });
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'FC' },
    { kind: 'paragraph', text: 'desc' },
    { kind: 'flashcard', front: 'f1', back: 'b1' },
  ]);
});

test('IMPORTANT_CONCEPTS maps concepts with optional description', () => {
  const blocks = contentBlocks('IMPORTANT_CONCEPTS', {
    concepts: [
      { name: 'N1', description: 'D1' },
      { name: 'N2' },
    ],
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