import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';

import { isSameOrigin } from './origin.ts';

const req = (origin: string | undefined, host: string | undefined): Request =>
  ({ headers: { origin, host } }) as unknown as Request;

test('same-origin fetch passes', () => {
  assert.equal(isSameOrigin(req('https://catlium.example', 'catlium.example')), true);
  assert.equal(isSameOrigin(req('http://localhost:8080', 'localhost:8080')), true);
});

test('cross-site origin is rejected (login CSRF)', () => {
  assert.equal(isSameOrigin(req('https://evil.example', 'catlium.example')), false);
  assert.equal(isSameOrigin(req('http://localhost:9999', 'localhost:8080')), false);
});

test('absent Origin is allowed (non-browser callers)', () => {
  assert.equal(isSameOrigin(req(undefined, 'localhost:8080')), true);
});

test('unparsable Origin is allowed', () => {
  assert.equal(isSameOrigin(req('not-a-url', 'localhost:8080')), true);
});