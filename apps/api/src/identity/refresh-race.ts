/**
 * Refresh-rotation race decision.
 *
 * Rotation revokes the old session row, then issues a fresh one. If two
 * refresh requests share the same token (two tabs, or an in-flight refresh
 * racing a page reload), the second request loads an already-revoked session
 * and the old code answered with a hard 401 "Session revoked" — which the
 * frontend treats as "logged out" and redirects to /login even though the
 * browser still holds perfectly valid cookies.
 *
 * The abuse-detection property (one refresh token must never be usable twice)
 * is NOT in the revocation flag — it is in the token↔hash comparison. We keep
 * that comparison, and only let a token that still matches the stored hash
 * re-rotate when the session was revoked moments ago (a concurrent refresh of
 * the SAME client). A replay of a spent token outside the grace window is
 * still denied, so stolen-token reuse detection survives.
 */
export const REFRESH_GRACE_WINDOW_MS = 60_000;

export interface RefreshSessionState {
  revokedAt: Date | null;
  expiresAt: Date;
}

export type RefreshDecision = 'rotate' | 'revoked' | 'expired' | 'token-mismatch';

export function decideRefreshRace(
  session: RefreshSessionState,
  tokenMatches: boolean,
  now: Date = new Date(),
  graceMs: number = REFRESH_GRACE_WINDOW_MS,
): RefreshDecision {
  if (now > session.expiresAt) return 'expired';

  if (session.revokedAt) {
    const revokedMs = session.revokedAt.getTime();
    const concurrent = tokenMatches && Number.isFinite(revokedMs) && now.getTime() - revokedMs <= graceMs;
    return concurrent ? 'rotate' : 'revoked';
  }

  return tokenMatches ? 'rotate' : 'token-mismatch';
}