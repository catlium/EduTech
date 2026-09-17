import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideRefreshRace,
  REFRESH_GRACE_WINDOW_MS,
  type RefreshSessionState,
} from './refresh-race.ts';

const state = (overrides: Partial<RefreshSessionState> = {}): RefreshSessionState => ({
  revokedAt: null,
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
});

const now = new Date('2026-09-17T12:00:00Z');

test('clean non-revoked session with matching token rotates', () => {
  assert.equal(decideRefreshRace(state(), true, now), 'rotate');
});

test('stationary session with mismatched token is denied (reuse/theft)', () => {
  assert.equal(decideRefreshRace(state(), false, now), 'token-mismatch');
});

test('expired session is denied before anything else', () => {
  const expired = state({ expiresAt: new Date(now.getTime() - 1000) });
  assert.equal(decideRefreshRace(expired, true, now), 'expired');
});

test('just-revoked session with the STORED token re-rotates (concurrent refresh)', () => {
  const concurrent = state({ revokedAt: new Date(now.getTime() - 5_000) });
  assert.equal(decideRefreshRace(concurrent, true, now), 'rotate');
});

test('just-revoked session with a WRONG token is denied even inside the window', () => {
  const concurrent = state({ revokedAt: new Date(now.getTime() - 5_000) });
  assert.equal(decideRefreshRace(concurrent, false, now), 'revoked');
});

test('revoked outside the grace window is denied (spent-token replay)', () => {
  const stale = state({ revokedAt: new Date(now.getTime() - REFRESH_GRACE_WINDOW_MS - 1_000) });
  assert.equal(decideRefreshRace(stale, true, now), 'revoked');
  const edge = state({ revokedAt: new Date(now.getTime() - REFRESH_GRACE_WINDOW_MS) });
  assert.equal(decideRefreshRace(edge, true, now), 'rotate');
});