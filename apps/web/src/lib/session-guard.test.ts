import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldAllowProtectedRoute } from './session-guard.ts';

test('idle past access-token expiry still allows a valid session through', () => {
  // The 15-minute access_token cookie is dropped by the browser on idle. The
  // csrf_token cookie (30-day, path /, set on login and every refresh) still
  // proves the session: the client refresh flow restores the access cookie on
  // the first API call instead of bouncing the user to /login.
  assert.equal(shouldAllowProtectedRoute({ hasAccessToken: false, hasCsrfToken: true }), true);
});

test('no session trace redirects to login', () => {
  assert.equal(shouldAllowProtectedRoute({ hasAccessToken: false, hasCsrfToken: false }), false);
});

test('a fresh access token always allows', () => {
  assert.equal(shouldAllowProtectedRoute({ hasAccessToken: true, hasCsrfToken: false }), true);
  assert.equal(shouldAllowProtectedRoute({ hasAccessToken: true, hasCsrfToken: true }), true);
});