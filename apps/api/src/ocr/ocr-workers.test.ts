// D4 worker registry pure logic — token hashing + status derivation, no NestJS.
// Run: pnpm --filter @catlium/api run test:ocr  (node --test src/ocr/ocr-workers.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashToken, safeEqualHex, generateToken, deriveStatus } from './ocr-workers.util.ts';

test('generateToken mints distinct owr_ prefixed keys', () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a, /^owr_/);
  assert.notEqual(a, b);
});

test('hashToken is a stable sha256 and safeEqualHex compares constant-time', () => {
  const token = generateToken();
  const h1 = hashToken(token);
  const h2 = hashToken(token);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.equal(safeEqualHex(h1, h2), true);
  assert.equal(safeEqualHex(h1, hashToken('owr_other')), false);
  assert.equal(safeEqualHex('abc', hashToken('owr_other')), false); // length mismatch
});

test('deriveStatus: disabled wins over everything', () => {
  const heartbeat = new Date();
  assert.equal(deriveStatus(false, null, heartbeat, 120_000), 'disabled');
  assert.equal(deriveStatus(false, 'chunk-id', heartbeat, 120_000), 'disabled');
});

test('deriveStatus: current chunk → processing regardless of heartbeat', () => {
  assert.equal(deriveStatus(true, 'chunk-id', null, 120_000), 'processing');
  assert.equal(deriveStatus(true, 'chunk-id', new Date(), 120_000), 'processing');
});

test('deriveStatus: no chunk, stale or null heartbeat → offline', () => {
  assert.equal(deriveStatus(true, null, null, 120_000), 'offline');
  assert.equal(deriveStatus(true, null, new Date(Date.now() - 121_000), 120_000), 'offline');
});

test('deriveStatus: no chunk, fresh heartbeat → idle', () => {
  assert.equal(deriveStatus(true, null, new Date(), 120_000), 'idle');
});
