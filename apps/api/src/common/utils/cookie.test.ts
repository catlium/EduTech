import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getCookieOptions } from './cookie.util.ts';

// F6 — production Secure must derive from NODE_ENV (an unset COOKIE_SECURE
// can never silently weaken the default); an explicit override stays valid.
test('Secure derives from NODE_ENV when COOKIE_SECURE is unset', () => {
  const unset = process.env['COOKIE_SECURE'];
  delete process.env['COOKIE_SECURE'];

  try {
    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    assert.equal(getCookieOptions().secure, true);
    process.env['NODE_ENV'] = 'development';
    assert.equal(getCookieOptions().secure, false);
    process.env['NODE_ENV'] = prev ?? '';
  } finally {
    if (unset !== undefined) process.env['COOKIE_SECURE'] = unset;
    if (process.env['NODE_ENV'] === '') delete process.env['NODE_ENV'];
  }
});

test('explicit COOKIE_SECURE overrides NODE_ENV (documented deployments)', () => {
  const prev = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  const prevSecure = process.env['COOKIE_SECURE'];

  try {
    process.env['COOKIE_SECURE'] = 'false';
    assert.equal(getCookieOptions().secure, false);
    process.env['COOKIE_SECURE'] = 'true';
    assert.equal(getCookieOptions().secure, true);
  } finally {
    if (prev !== undefined) process.env['NODE_ENV'] = prev;
    if (prevSecure === undefined) delete process.env['COOKIE_SECURE'];
    else process.env['COOKIE_SECURE'] = prevSecure;
  }
});