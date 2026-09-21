import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as bcryptjs from 'bcryptjs';

import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import { users, authSessions, passwordResets } from '@catlium/database';

import { AuthService } from './auth.service.ts';
import { AccessTokenGuard } from '../common/guards/access-token.guard.ts';
import { CsrfGuard } from '../common/guards/csrf.guard.ts';

// Phase K D7 §19 auth/session hardening against a live database. Runs via the
// `test:auth-session` script: tsx --test src/identity/auth-session.integration.ts
// gated on TEST_DATABASE_URL. Scratch users cascade away their auth_sessions
// and password_resets (ON DELETE CASCADE).
const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;
after(async () => {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } })?.$client;
  await client?.end();
});
const skip = testDbUrl ? false : 'TEST_DATABASE_URL not set';

const jwt = new JwtService({ secret: 'auth-session-test-secret', signOptions: { algorithm: 'HS256' } });
const svc = () => new AuthService(db as unknown as Database, jwt);
const accessGuard = new AccessTokenGuard(db as unknown as Database, jwt);
const csrfGuard = new CsrfGuard();

const PASSWORD = 'correct horse battery staple';
const hash = (pwd: string) => bcryptjs.hash(pwd, 4);

async function createUser(email: string, status = 'active', password = PASSWORD) {
  const [user] = await db!
    .insert(users)
    .values({ email, name: 'Auth Tester', passwordHash: await hash(password) })
    .returning();
  if (status !== 'active') {
    await db!.update(users).set({ status }).where(eq(users.id, user!.id));
  }
  return user!;
}

function ctxFor(request: { cookies?: Record<string, string>; headers?: Record<string, string> }, method = 'GET') {
  const req = { headers: {}, method, ...request } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

async function sidOf(token: string): Promise<string> {
  return (await jwt.verifyAsync<{ sid: string }>(token)).sid;
}

async function countLive(userId: string): Promise<number> {
  const rows = await db!
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
  return rows.length;
}

test('refresh rotates one-to-one with lineage + device metadata (F2)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`rot-${randomUUID()}@catlium.dev`);
    created.push(user.id);

    const first = await auth.login(user.email, PASSWORD, { userAgent: 'ua-1', lastIp: '1.1.1.1' });
    const [rootRow] = await db!.select().from(authSessions).where(eq(authSessions.userId, user.id));
    assert.equal(rootRow.rotatedFromSid, null);
    assert.equal(rootRow.userAgent, 'ua-1');
    assert.equal(rootRow.lastIp, '1.1.1.1');
    assert.ok(rootRow.lastUsedAt);

    const rotated = await auth.refresh(first.tokens.refreshToken, { userAgent: 'ua-2', lastIp: '2.2.2.2' });
    const after = (await db!.select().from(authSessions).where(eq(authSessions.userId, user.id)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    assert.equal(after.length, 2, 'exactly one new session minted');
    assert.ok(after[0].revokedAt, 'old session revoked by rotation');
    assert.equal(after[1].revokedAt, null, 'child session live');
    assert.equal(after[1].rotatedFromSid, after[0].id, 'child points at parent');
    assert.equal(after[1].userAgent, 'ua-2');
    assert.equal(after[1].lastIp, '2.2.2.2');

    const accessPayload = await jwt.verifyAsync<{ sub: string; sid: string }>(rotated.tokens.accessToken);
    assert.equal(accessPayload.sid, after[1].id, 'access token carries sid');
    const refreshPayload = await jwt.verifyAsync<{ sub: string; sid: string }>(rotated.tokens.refreshToken);
    assert.equal(refreshPayload.sid, after[1].id, 'refresh token carries sid');

    const listed = await auth.listSessions(user.id, after[1].id);
    assert.deepEqual(Object.keys(listed[0]).sort(), [
      'createdAt', 'current', 'lastIp', 'lastUsedAt', 'revoked', 'rotatedFromSid', 'sid', 'userAgent',
    ]);
    assert.equal(listed.find((s) => s.sid === after[1].id)?.current, true);
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('spent-token reuse is denied AND revokes the whole lineage (F2)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`reuse-${randomUUID()}@catlium.dev`);
    created.push(user.id);

    const first = await auth.login(user.email, PASSWORD);
    const rotated = await auth.refresh(first.tokens.refreshToken);
    const oldSid = await sidOf(first.tokens.refreshToken);
    const newSid = await sidOf(rotated.tokens.refreshToken);

    await assert.rejects(auth.refresh(first.tokens.refreshToken), UnauthorizedException);

    const [oldRow] = await db!.select().from(authSessions).where(eq(authSessions.id, oldSid));
    const [newRow] = await db!.select().from(authSessions).where(eq(authSessions.id, newSid));
    assert.ok(oldRow.revokedAt, 'replayed parent revoked');
    assert.ok(newRow.revokedAt, 'lineage child revoked with the family');
    assert.equal(await countLive(user.id), 0, 'replay can never mint');
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('wrong token against a live row revokes the session (theft) (F2)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`theft-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const first = await auth.login(user.email, PASSWORD);
    const sid = await sidOf(first.tokens.refreshToken);

    // Re-signing the same claims yields different bytes (fresh jti/iat) → the
    // stored hash no longer matches. Presenting it is a wrong-token attempt.
    const claims = await jwt.verifyAsync<{ sub: string; sid: string }>(first.tokens.refreshToken);
    const forged = await jwt.signAsync(
      { sub: claims.sub, sid: claims.sid, jti: randomUUID() },
      { expiresIn: '30d' },
    );

    await assert.rejects(auth.refresh(forged), UnauthorizedException);
    const [row] = await db!.select().from(authSessions).where(eq(authSessions.id, sid));
    assert.ok(row.revokedAt, 'session revoked on token mismatch');
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('concurrent refresh can never mint more than one live session (F2)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`race-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const first = await auth.login(user.email, PASSWORD);

    const settled = await Promise.allSettled([
      auth.refresh(first.tokens.refreshToken),
      auth.refresh(first.tokens.refreshToken),
    ]);
    const mints = settled.filter((r) => r.status === 'fulfilled').length;
    assert.ok(mints <= 1, 'the atomic claim allows at most one rotation');
    assert.equal(await countLive(user.id), 0, 'any reuse settles the whole family');
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('logout revokes; revoked sessions never refresh (F3)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`logout-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const first = await auth.login(user.email, PASSWORD);
    const sid = await sidOf(first.tokens.refreshToken);

    await auth.logout(sid);
    const [row] = await db!.select().from(authSessions).where(eq(authSessions.id, sid));
    assert.ok(row.revokedAt, 'logout revokes the session');
    await assert.rejects(auth.refresh(first.tokens.refreshToken), UnauthorizedException);

    await auth.logout(sid); // idempotent
    assert.equal(await countLive(user.id), 0);
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('expired session cannot refresh (F2)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`expired-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const first = await auth.login(user.email, PASSWORD);
    const sid = await sidOf(first.tokens.refreshToken);
    await db!
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(authSessions.id, sid));

    await assert.rejects(auth.refresh(first.tokens.refreshToken), UnauthorizedException);
    const [row] = await db!.select().from(authSessions).where(eq(authSessions.id, sid));
    assert.ok(row.revokedAt, 'expired session provably revoked');
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('revoke-all preserves the current session (F3)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`revokeall-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const a = await auth.login(user.email, PASSWORD, { userAgent: 'dev-a', lastIp: '10.0.0.1' });
    const b = await auth.login(user.email, PASSWORD, { userAgent: 'dev-b', lastIp: '10.0.0.2' });
    const sidB = await sidOf(b.tokens.refreshToken);

    await auth.revokeAllOtherSessions(user.id, sidB);

    const [rowA] = await db!.select().from(authSessions).where(eq(authSessions.id, await sidOf(a.tokens.refreshToken)));
    const [rowB] = await db!.select().from(authSessions).where(eq(authSessions.id, sidB));
    assert.ok(rowA.revokedAt, 'other device revoked');
    assert.equal(rowB.revokedAt, null, 'current device kept');
    await assert.rejects(auth.refresh(a.tokens.refreshToken), UnauthorizedException);
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('deactivated user: login, refresh and access are all denied (F5)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`dead-${randomUUID()}@catlium.dev`, 'active');
    created.push(user.id);
    const first = await auth.login(user.email, PASSWORD);

    // Deactivation happens out of band (no mutation exists yet) — emulate it.
    await db!.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));

    await assert.rejects(auth.refresh(first.tokens.refreshToken), UnauthorizedException);
    await assert.rejects(auth.login(user.email, PASSWORD), UnauthorizedException);

    // The access guard reads the cookie (session-bound plane), not a header.
    await assert.rejects(
      accessGuard.canActivate(ctxFor({ cookies: { access_token: first.tokens.accessToken } })),
      UnauthorizedException,
    );
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('login is non-enumerating (F5)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const email = `ghost-${randomUUID()}@catlium.dev`;
    const user = await createUser(email);
    created.push(user.id);
    await db!.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));

    // Same message whether the account is deactivated or does not exist.
    const dead = await auth.login(user.email, PASSWORD).catch((e: Error) => e.message);
    const missing = await auth.login(email.replace('ghost', 'nowhere'), PASSWORD).catch((e: Error) => e.message);
    assert.equal(dead, missing);
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('retention cleanup removes only expired/revoked-past-retention rows (F3)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`gc-${randomUUID()}@catlium.dev`);
    created.push(user.id);

    const a = await auth.login(user.email, PASSWORD); // to backdate (live expiry)
    const c = await auth.login(user.email, PASSWORD); // to backdate (revoked)
    const keep = await auth.login(user.email, PASSWORD);

    const days = 86_400_000;
    await db!
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() - 120 * days) })
      .where(eq(authSessions.id, await sidOf(a.tokens.refreshToken)));
    await db!
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() - 120 * days), revokedAt: new Date(Date.now() - 120 * days) })
      .where(eq(authSessions.id, await sidOf(c.tokens.refreshToken)));

    await auth.purgeExpiredSessions();

    const rows = await db!.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, user.id));
    assert.equal(rows.length, 1, 'both backdated rows purged, live session kept');
    assert.equal(rows[0].id, await sidOf(keep.tokens.refreshToken));
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('password reset: uniform request, swap, revoke-everything, one-shot token (F5)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`reset-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const newPwd = 'brand new trusted passphrase';

    const login1 = await auth.login(user.email, PASSWORD);
    const sid1 = await sidOf(login1.tokens.refreshToken);

    // Request phase is uniform (no enumeration) whether or not the account exists.
    const demandExisting = await auth.requestPasswordReset(user.email);
    const demandMissing = await auth.requestPasswordReset(`${randomUUID()}@nowhere.dev`);
    assert.deepEqual(demandMissing, demandExisting);

    const secret = randomUUID();
    const [reset] = await db!
      .insert(passwordResets)
      .values({ userId: user.id, tokenHash: await hash(secret), expiresAt: new Date(Date.now() + 3_600_000) })
      .returning();

    await auth.confirmPasswordReset(`${reset.id}.${secret}`, newPwd);

    assert.equal(await countLive(user.id), 0, 'confirm revokes every session');
    await assert.rejects(auth.refresh(login1.tokens.refreshToken), UnauthorizedException);
    assert.equal((await db!.select().from(authSessions).where(eq(authSessions.id, sid1)))[0].revokedAt !== null, true);

    await assert.rejects(auth.login(user.email, PASSWORD), UnauthorizedException, 'old password dead');
    const login2 = await auth.login(user.email, newPwd);
    assert.equal(await countLive(user.id), 1, 'new password mints a fresh session');
    void login2;

    await assert.rejects(
      auth.confirmPasswordReset(`${reset.id}.${secret}`, 'yet another'),
      UnauthorizedException,
      'consumed token cannot be replayed',
    );
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('expired reset token is rejected (F5)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`resetexp-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const secret = randomUUID();
    const [reset] = await db!
      .insert(passwordResets)
      .values({ userId: user.id, tokenHash: await hash(secret), expiresAt: new Date(Date.now() - 60_000) })
      .returning();

    await assert.rejects(auth.confirmPasswordReset(`${reset.id}.${secret}`, PASSWORD), UnauthorizedException);
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('AccessTokenGuard is session-aware and binds to sid (F1)', { skip }, async () => {
  const auth = svc();
  const created: string[] = [];
  try {
    const user = await createUser(`guard-${randomUUID()}@catlium.dev`);
    created.push(user.id);
    const first = await auth.login(user.email, PASSWORD);
    const sid = await sidOf(first.tokens.refreshToken);

    const okCtx = ctxFor({ cookies: { access_token: first.tokens.accessToken } });
    assert.equal(await accessGuard.canActivate(okCtx), true);
    const attached = (okCtx as unknown as { switchToHttp: () => { getRequest: () => { user?: { userId: string } } } })
      .switchToHttp()
      .getRequest().user;
    assert.equal(attached?.userId, user.id);

    // Revoking the session invalidates even a still-unexpired access token.
    await auth.logout(sid);
    await assert.rejects(
      accessGuard.canActivate(ctxFor({ cookies: { access_token: first.tokens.accessToken } })),
      UnauthorizedException,
    );

    // A token that carries no sid (pre-hardening shape) is rejected outright.
    const noSid = await jwt.signAsync({ sub: user.id }, { expiresIn: '15m' });
    await assert.rejects(
      accessGuard.canActivate(ctxFor({ cookies: { access_token: noSid } })),
      UnauthorizedException,
    );

    // An arbitrary sid that references nothing is rejected.
    const bogus = await jwt.signAsync({ sub: user.id, sid: randomUUID() }, { expiresIn: '15m' });
    await assert.rejects(
      accessGuard.canActivate(ctxFor({ cookies: { access_token: bogus } })),
      UnauthorizedException,
    );
  } finally {
    if (created.length) await db!.delete(users).where(inArray(users.id, created));
  }
});

test('CsrfGuard enforces double-submit only on the cookie-session plane (F4)', { skip }, async () => {
  // Safe methods pass regardless of cookies.
  assert.equal(await csrfGuard.canActivate(ctxFor({ cookies: { access_token: 'x' } }, 'GET')), true);

  // No cookie session → state-changers pass to the auth/worker layer.
  assert.equal(await csrfGuard.canActivate(ctxFor({}, 'POST')), true);

  // Cookie session + state-change requires the header token.
  await assert.rejects(
    async () => csrfGuard.canActivate(ctxFor({ cookies: { access_token: 'x' } }, 'POST')),
    ForbiddenException,
  );
  // Cookie matches nothing / mismatches.
  await assert.rejects(
    async () =>
      csrfGuard.canActivate(
        ctxFor(
          {
            cookies: { access_token: 'x', csrf_token: 'cookie-value' },
            headers: { 'x-csrf-token': 'other' },
          },
          'DELETE',
        ),
      ),
    ForbiddenException,
  );
  // Matching double-submit passes.
  assert.equal(
    await csrfGuard.canActivate(
      ctxFor(
        {
          cookies: { access_token: 'x', csrf_token: 'same' },
          headers: { 'x-csrf-token': 'same' },
        },
        'DELETE',
      ),
    ),
    true,
  );
});