// D5 coordinator pure logic — page validation + coverage checks, no NestJS.
// Run: pnpm --filter @catlium/api run test:ocr  (node --test src/ocr/ocr-coordinator.util.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateChunkPages, isCompleteCoverage } from './ocr-coordinator.util.ts';

test('validateChunkPages rejects empty and oversized page lists', () => {
  assert.throws(() => validateChunkPages([], 1, 10), /does not fit/);
  assert.throws(() => validateChunkPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1, 10), /does not fit/);
});

test('validateChunkPages rejects out-of-range and duplicate pages', () => {
  assert.throws(() => validateChunkPages([0, 1], 1, 10), /out of chunk range/);
  assert.throws(() => validateChunkPages([11], 1, 10), /out of chunk range/);
  assert.throws(() => validateChunkPages([3, 3], 1, 10), /Duplicate page 3/);
});

test('validateChunkPages accepts an exactly-full or partial in-range list', () => {
  validateChunkPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1, 10);
  validateChunkPages([4, 6], 1, 10);
});

test('isCompleteCoverage requires exactly {1..N} with no gaps', () => {
  assert.equal(isCompleteCoverage([1, 2, 3], 3), true);
  assert.equal(isCompleteCoverage([2, 1, 3], 3), true); // order-insensitive
  assert.equal(isCompleteCoverage([1, 2], 3), false); // gap
  assert.equal(isCompleteCoverage([1, 2, 3, 4], 3), false); // extra page
  assert.equal(isCompleteCoverage([1, 2, 2], 3), false); // duplicate cannot fill gap
  assert.equal(isCompleteCoverage([], 0), true); // empty document
});