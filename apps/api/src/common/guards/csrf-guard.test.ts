import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideCsrf } from './csrf-policy.ts';

test('GET/HEAD/OPTIONS are exempt', () => {
  assert.equal(decideCsrf('GET', true, undefined, undefined), 'pass');
  assert.equal(decideCsrf('HEAD', true, 'c', 'h'), 'pass');
  assert.equal(decideCsrf('OPTIONS', true, 'c', 'h'), 'pass');
});

test('state-changing without an access cookie passes to the auth layer (login / worker protocol)', () => {
  assert.equal(decideCsrf('POST', false, undefined, undefined), 'pass');
  assert.equal(decideCsrf('DELETE', false, 'c', undefined), 'pass');
});

test('cookie-session POST requires both tokens; mismatch is rejected', () => {
  assert.equal(decideCsrf('POST', true, undefined, undefined), 'missing');
  assert.equal(decideCsrf('POST', true, 'c', undefined), 'missing');
  assert.equal(decideCsrf('POST', true, undefined, 'h'), 'missing');
  assert.equal(decideCsrf('PUT', true, 'cookie', 'header'), 'mismatch');
});

test('matching double-submit passes for any state-changing method', () => {
  assert.equal(decideCsrf('POST', true, 'same', 'same'), 'pass');
  assert.equal(decideCsrf('PATCH', true, 'same', 'same'), 'pass');
  assert.equal(decideCsrf('DELETE', true, 'same', 'same'), 'pass');
});