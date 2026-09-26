import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { api, ApiError, isTerminalPollError, setActiveInstituteId } from './api.ts';

// api.ts reads lazy globals (document/window/fetch) at call time, so we can
// script them per test. KEY invariant under test:
//   401 + refresh rejected (401/403)  -> the ONLY case that logs the user out
//   401 + refresh unavailable (5xx)   -> retryable 503, NO logout redirect
//   401 + refresh ok                  -> original request is retried once

let refreshCount = 0;
let data401sLeft = 0;
let refreshStatus = 200;
let dataStatus = 200;
const events: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  refreshCount = 0;
  data401sLeft = 0;
  refreshStatus = 200;
  dataStatus = 200;
  events.length = 0;
  setActiveInstituteId(null);

  globalThis.document = { cookie: 'csrf_token=abc' } as unknown as Document;
  globalThis.window = {
    dispatchEvent: (e: Event) => events.push(e.type),
  } as unknown as Window & typeof globalThis;

  const dataBody = { user: { id: 'u1' } };
  globalThis.fetch = ((url: string) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCount += 1;
      return Promise.resolve(
        refreshStatus === 200 ? json(200, { user: dataBody }) : json(refreshStatus, { message: 'x' }),
      );
    }
    if (data401sLeft > 0) {
      data401sLeft -= 1;
      return Promise.resolve(json(401, { message: 'expired' }));
    }
    return Promise.resolve(json(dataStatus, dataBody));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['window'];
  delete (globalThis as Record<string, unknown>)['document'];
});

test('a plain 200 never touches the refresh endpoint', async () => {
  const { user } = await api<{ user: { id: string } }>('/auth/me');
  assert.equal(user.id, 'u1');
  assert.equal(refreshCount, 0);
  assert.deepEqual(events, []);
});

test('401 then a healthy refresh retries the original request once', async () => {
  data401sLeft = 1;
  const { user } = await api<{ user: { id: string } }>('/auth/me');
  assert.equal(user.id, 'u1');
  assert.equal(refreshCount, 1);
  assert.deepEqual(events, []);
});

test('401 with refresh rejected (401) is a genuine logout', async () => {
  data401sLeft = 1;
  refreshStatus = 401;
  await assert.rejects(api('/auth/me'), (e: unknown) => e instanceof ApiError && e.status === 401);
  assert.equal(refreshCount, 1);
  assert.deepEqual(events, ['catlium:unauthorized']);
});

test('401 with refresh unavailable (503) does NOT log the user out', async () => {
  data401sLeft = 1;
  refreshStatus = 503;
  await assert.rejects(api('/auth/me'), (e: unknown) => e instanceof ApiError && e.status === 503);
  assert.equal(refreshCount, 1);
  assert.deepEqual(events, []);
});

test('401 with refresh unavailable (network error) does NOT log the user out', async () => {
  data401sLeft = 1;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCount += 1;
      return Promise.reject(new TypeError('fetch failed'));
    }
    return realFetch(url);
  }) as unknown as typeof fetch;
  await assert.rejects(api('/auth/me'), (e: unknown) => e instanceof ApiError && e.status === 503);
  assert.deepEqual(events, []);
});

test('concurrent 401s share ONE refresh (single-flight) and both retry', async () => {
  data401sLeft = 2;
  dataStatus = 200;
  const [a, b] = await Promise.all([
    api<{ user: { id: string } }>('/auth/me'),
    api<{ user: { id: string } }>('/auth/me'),
  ]);
  assert.equal(a.user.id, 'u1');
  assert.equal(b.user.id, 'u1');
  assert.equal(refreshCount, 1);
  assert.deepEqual(events, []);
});

test('GET 403 dispatches catlium:forbidden WITHOUT a refresh/logout', async () => {
  dataStatus = 403;
  await assert.rejects(api('/questions'), (e: unknown) => e instanceof ApiError && e.status === 403);
  assert.equal(refreshCount, 0);
  assert.deepEqual(events, ['catlium:forbidden']);
});

test('mutation 403 keeps the normal throw — no forbidden event', async () => {
  dataStatus = 403;
  await assert.rejects(
    api('/questions', { method: 'POST', body: {} }),
    (e: unknown) => e instanceof ApiError && e.status === 403,
  );
  assert.equal(refreshCount, 0);
  assert.deepEqual(events, []);
});

test('GET 404 does NOT dispatch forbidden or unauthorized', async () => {
  dataStatus = 404;
  await assert.rejects(api('/questions'), (e: unknown) => e instanceof ApiError && e.status === 404);
  assert.equal(refreshCount, 0);
  assert.deepEqual(events, []);
});

test('GET 403 is checked only AFTER the 401 refresh path', async () => {
  data401sLeft = 1;
  dataStatus = 403;
  await assert.rejects(api('/questions'), (e: unknown) => e instanceof ApiError && e.status === 403);
  assert.equal(refreshCount, 1);
  assert.deepEqual(events, ['catlium:forbidden']);
});

// A 400 from a UUID path param (ParseUUIDPipe) can never become valid on a
// later tick, so the extraction-status poll must stop instead of spinning.
test('isTerminalPollError treats 400/401/403/404 as permanent', () => {
  for (const status of [400, 401, 403, 404]) {
    assert.equal(isTerminalPollError(new ApiError(status, 'nope')), true, `status ${status}`);
  }
});

test('isTerminalPollError keeps 5xx and transport errors retryable', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isTerminalPollError(new ApiError(status, 'later')), false, `status ${status}`);
  }
  assert.equal(isTerminalPollError(new TypeError('fetch failed')), false);
  assert.equal(isTerminalPollError(undefined), false);
});
