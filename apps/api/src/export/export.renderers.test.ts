// Minimal smoke: Devanagari text must select the registered font without throwing.
// Run: node --test apps/api/dist/export/export.renderers.test.js (after build)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentBlocks } from './export.content-blocks.ts';

test('NOTE with Devanagari paragraph maps to paragraph block', () => {
  const blocks = contentBlocks('NOTE', {
    title: 'गणित',
    blocks: [{ type: 'paragraph', content: 'यह एक परीक्षण है' }],
  });
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'गणित' },
    { kind: 'paragraph', text: 'यह एक परीक्षण है' },
  ]);
});
