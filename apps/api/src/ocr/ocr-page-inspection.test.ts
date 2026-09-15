// D7 per-page inspection + correction pure logic, no NestJS.
// Run: pnpm --filter @catlium/api run test:ocr
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePageDetails,
  aggregatePagesText,
} from './ocr-coordinator.util.ts';
import type { ChunkLike } from './ocr-coordinator.util.ts';

function chunk(overrides: Partial<ChunkLike> & { startPage: number; endPage: number }): ChunkLike {
  return {
    chunkIndex: 1,
    status: 'submitted',
    result: null,
    ...overrides,
  };
}

function resultOf(texts: Record<string, string>): Record<string, unknown> {
  return {
    pages: Object.entries(texts).map(([page, text]) => ({
      page: Number(page),
      source: 'pymupdf',
      text,
    })),
  };
}

const CORRECTIONS = new Map([
  [2, { correctedText: 'FIXED PAGE 2', correctedBy: 'user-1', correctedAt: '2026-09-15T00:00:00Z' }],
]);

test('derivePageDetails: submitted chunk pages render extracted with text/source', () => {
  const chunks = [chunk({ startPage: 1, endPage: 2, result: resultOf({ 1: 'one', 2: 'two' }) })];
  const rows = derivePageDetails(chunks, 2, new Map());
  assert.deepEqual(rows[1], {
    page: 2,
    status: 'extracted',
    source: 'pymupdf',
    text: 'two',
    correctedText: null,
    correctedBy: null,
    correctedAt: null,
  });
});

test('derivePageDetails: a correction wins over extracted (status corrected)', () => {
  const chunks = [chunk({ startPage: 1, endPage: 2, result: resultOf({ 1: 'one', 2: 'two' }) })];
  const row = derivePageDetails(chunks, 2, CORRECTIONS)[1];
  assert.equal(row.status, 'corrected');
  assert.equal(row.correctedText, 'FIXED PAGE 2');
  assert.equal(row.correctedBy, 'user-1');
  assert.equal(row.text, 'two'); // original preserved alongside
});

test('derivePageDetails: terminal-failed chunk renders failed unless corrected', () => {
  const chunks = [chunk({ startPage: 1, endPage: 2, status: 'failed' })];
  const rows = derivePageDetails(chunks, 2, new Map());
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[1].status, 'failed');
  // a correction on a failed-run page still shows corrected (best content available)
  assert.equal(derivePageDetails(chunks, 2, CORRECTIONS)[1].status, 'corrected');
});

test('derivePageDetails: submitted chunk missing a page renders missing, never extracted', () => {
  // page 2 was OCR'd out of range 1..3 (a coverage hole the coordinator blocks at READY)
  const chunks = [
    chunk({ startPage: 1, endPage: 3, result: resultOf({ 1: 'one', 3: 'three' }) }),
  ];
  const row = derivePageDetails(chunks, 3, new Map())[1];
  assert.equal(row.status, 'missing');
  assert.equal(row.text, null);
});

test('derivePageDetails: a submitted page with empty text renders missing, never extracted', () => {
  // an entry exists but OCR extracted nothing usable — must not look complete
  const chunks = [
    chunk({ startPage: 1, endPage: 2, result: resultOf({ 1: 'one', 2: '' }) }),
  ];
  const row = derivePageDetails(chunks, 2, new Map())[1];
  assert.equal(row.status, 'missing');
  assert.equal(row.text, null);
});

test('derivePageDetails: pending / claimed / not-yet-materialized pages render pending', () => {
  const chunks = [
    chunk({ startPage: 1, endPage: 2, status: 'claimed', result: null }),
  ];
  const rows = derivePageDetails(chunks, 4, new Map());
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[3].status, 'pending');
});

test('aggregatePagesText: joins pages in page order, corrections win, blank pages dropped', () => {
  const chunks = [
    chunk({ chunkIndex: 1, startPage: 1, endPage: 2, result: resultOf({ 1: 'one', 2: 'two' }) }),
    chunk({ chunkIndex: 2, startPage: 3, endPage: 4, result: resultOf({ 3: '', 4: 'four' }) }),
  ];
  const corrections = new Map([[2, 'TWO-FIXED']]);
  assert.equal(
    aggregatePagesText(chunks, corrections),
    'one\n\nTWO-FIXED\n\nfour',
  );
});

test('aggregatePagesText: only submitted chunks contribute', () => {
  const chunks = [
    chunk({ chunkIndex: 1, startPage: 1, endPage: 1, status: 'pending', result: null }),
    chunk({ chunkIndex: 2, startPage: 2, endPage: 2, result: resultOf({ 2: 'two' }) }),
  ];
  assert.equal(aggregatePagesText(chunks, new Map()), 'two');
});