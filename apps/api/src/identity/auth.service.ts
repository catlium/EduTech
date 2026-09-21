import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq, and, ne, isNull, inArray, desc, lt, or } from 'drizzle-orm';
import * as bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';

import { users, authSessions, passwordResets } from '@catlium/database';
import type { Database } from '@catlium/database';
import { normalizeEmail } from '@catlium/shared';
import { DATABASE_TOKEN } from '../database/database.module.js';

export interface SessionMetadata {
  userAgent?: string | null;
  lastIp?: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
    metadata: SessionMetadata = {},
  ): Promise<{ user: SafeUser; tokens: TokenPair }> {
    const normalizedEmail = normalizeEmail(email);

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcryptjs.compare(password, user.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.purgeExpiredSessions();

    const tokens = await this.createSession(user.id, metadata);

    return {
      user: this.toSafeUser(user),
      tokens,
    };
  }

  /**
   * Strict one-time refresh rotation (D7 §19 F2). The access+refresh boundary
   * is an atomic claim: a single `UPDATE ... WHERE revoked_at IS NULL AND
   * refresh_token_hash = <stored>` wins the right to mint the one next session
   * (no 60-second grace window — re-rotation of a spent token is replay).
   * Presenting a spent or wrong token revokes the session's lineage
   * (`rotated_from_sid` descendants) so the whole family requires re-login.
   */
  async refresh(
    refreshToken: string,
    metadata: SessionMetadata = {},
  ): Promise<{ user: SafeUser; tokens: TokenPair }> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const [session] = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, payload.sid))
      .limit(1);

    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, payload.sub)).limit(1);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // F5 — a deactivated/disabled user must never obtain a refresh; same
    // uniform error as a dead session (no account-state enumeration).
    if (user.status !== 'active') {
      throw new UnauthorizedException('Session revoked');
    }

    const tokenMatches = session.refreshTokenHash === this.hashToken(refreshToken);

    if (session.revokedAt) {
      // A spent token on an already-claimed row is confirmed reuse — revoke
      // the whole lineage and never mint.
      if (tokenMatches) {
        await this.revokeLineage(session.id);
      }
      throw new UnauthorizedException('Session revoked');
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException('Session expired');
    }

    if (!tokenMatches) {
      // Wrong token against a live row — suspected theft. Revoke the session.
      await this.revokeSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Atomic claim: exactly one concurrent presenter may rotate. A lost claim
    // means the token is now spent — treat as reuse and revoke the lineage.
    const [claimed] = await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(authSessions.id, session.id),
          isNull(authSessions.revokedAt),
          eq(authSessions.refreshTokenHash, session.refreshTokenHash),
        ),
      )
      .returning({ id: authSessions.id });

    if (!claimed) {
      await this.revokeLineage(session.id);
      throw new UnauthorizedException('Session revoked');
    }

    await this.purgeExpiredSessions();

    const tokens = await this.createSession(user.id, {
      ...metadata,
      rotatedFromSid: session.id,
    });

    return {
      user: this.toSafeUser(user),
      tokens,
    };
  }

  async verifyRefreshToken(refreshToken: string): Promise<{ sub: string; sid: string }> {
    try {
      return await this.jwtService.verifyAsync<{ sub: string; sid: string }>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(sessionId: string): Promise<void> {
    await this.revokeSession(sessionId);
  }

  async getUser(userId: string): Promise<SafeUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.toSafeUser(user);
  }

  // D7 §19 F2 — a refresh-token fingerprint is stored, never the token. The
  // token is a high-entropy random secret, so SHA-256 (hex) is the standard
  // choice; bcrypt was a poor fit because it truncates input at 72 bytes and
  // a JWT's signature sits past that — two *different* tokens sharing the
  // header+payload prefix would bcrypt-compare equal, silently treating a
  // wrong-token rotation as valid.
  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private async createSession(
    userId: string,
    opts: SessionMetadata & { rotatedFromSid?: string } = {},
  ): Promise<TokenPair> {
    const sid = uuidv4();
    const refreshDays = parseInt(process.env['REFRESH_TOKEN_EXPIRY_DAYS'] ?? '30', 10);
    const refreshExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    const accessMinutes = parseInt(process.env['ACCESS_TOKEN_EXPIRY_MINUTES'] ?? '15', 10);
    // F1 — access tokens are session-bound: {sub, sid}. The AccessTokenGuard
    // verifies the live session + active user on every request.
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, sid },
      { expiresIn: `${accessMinutes}m` },
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, sid },
      { expiresIn: `${refreshDays}d` },
    );

    const refreshTokenHash = this.hashToken(refreshToken);

    await this.db.insert(authSessions).values({
      id: sid,
      userId,
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
      rotatedFromSid: opts.rotatedFromSid ?? null,
      userAgent: opts.userAgent ?? null,
      lastIp: opts.lastIp ?? null,
      lastUsedAt: new Date(),
    });

    return { accessToken, refreshToken, refreshExpiresAt };
  }

  // F2 — walk the refresh lineage (children via `rotated_from_sid`, recursively)
  // and revoke every member. Reuse of a spent token revokes the token family.
  private async revokeLineage(rootSid: string): Promise<void> {
    const toRevoke = new Set<string>([rootSid]);
    let frontier = [rootSid];

    while (frontier.length > 0) {
      const children = await this.db
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(inArray(authSessions.rotatedFromSid, frontier));
      frontier = children.map((c) => c.id).filter((id) => !toRevoke.has(id));
      for (const id of frontier) toRevoke.add(id);
    }

    if (toRevoke.size > 0) {
      await this.db
        .update(authSessions)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(inArray(authSessions.id, [...toRevoke]));
    }
  }

  // F6 — opportunistic GC piggybacked on login/rotation: drop revoked/expired
  // rows past the retention window (default 90 days). Re-login always creates
  // fresh rows, so purging never blocks a live session.
  async purgeExpiredSessions(now: Date = new Date()): Promise<number> {
    const retentionDays = parseInt(process.env['AUTH_SESSION_RETENTION_DAYS'] ?? '90', 10);
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const purged = await this.db
      .delete(authSessions)
      .where(
        and(
          lt(authSessions.expiresAt, cutoff),
          or(isNull(authSessions.revokedAt), lt(authSessions.revokedAt, cutoff)),
        ),
      )
      .returning({ id: authSessions.id });

    return purged.length;
  }

  // Phase K F3 — session listing. `currentSid` comes from the authenticated
  // refresh-token claim (`sid`), never inferred from user-agent/IP.
  async listSessions(userId: string, currentSid?: string) {
    const rows = await this.db
      .select({
        sid: authSessions.id,
        createdAt: authSessions.createdAt,
        lastUsedAt: authSessions.lastUsedAt,
        userAgent: authSessions.userAgent,
        lastIp: authSessions.lastIp,
        revokedAt: authSessions.revokedAt,
        rotatedFromSid: authSessions.rotatedFromSid,
      })
      .from(authSessions)
      .where(eq(authSessions.userId, userId))
      .orderBy(desc(authSessions.lastUsedAt), desc(authSessions.createdAt));

    return rows.map((row) => ({
      sid: row.sid,
      current: currentSid !== undefined && row.sid === currentSid,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      userAgent: row.userAgent,
      lastIp: row.lastIp,
      revoked: row.revokedAt !== null,
      rotatedFromSid: row.rotatedFromSid,
    }));
  }

  // Phase K F3 — owner-scoped revoke of ONE session. The `userId` filter is
  // mandatory: an authenticated user may only ever revoke their own sessions.
  async revokeSessionByOwner(sessionId: string, userId: string) {
    const [row] = await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)))
      .returning({ id: authSessions.id });

    if (!row) {
      throw new UnauthorizedException('Session not found');
    }
  }

  // Phase K F3 — revoke every session of the user except the current one.
  async revokeAllOtherSessions(userId: string, currentSid?: string) {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(authSessions.userId, userId),
          currentSid ? ne(authSessions.id, currentSid) : undefined,
          isNull(authSessions.revokedAt),
        ),
      );
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(authSessions.id, sessionId));
  }

  // ---------------------------------------------------------------------------
  // Phase K / D7 §19 — Session management (F3)
  // Owner-scoped by construction: every query below filters on `userId`.

  // ---------------------------------------------------------------------------
  // Phase K / D7 §19 — Password reset (F5)
  // Token = `${resetId}.${secret}`; only the bcrypt hash of `secret` is stored.
  // The controller answers uniformly whether or not the account exists — no
  // user enumeration. The raw token leaves this class only via the delivery
  // seam and is never logged.
  // ---------------------------------------------------------------------------

  // Seam: where the plaintext reset token is handed to the (future) email /
  // notification provider. No provider is wired yet — ponytail: plug the
  // transport in here when one exists; never log `rawToken`.
  private deliverPasswordReset(email: string, rawToken: string): void {
    void email;
    void rawToken;
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      const secret = randomBytes(32).toString('base64url');
      const tokenHash = await bcryptjs.hash(secret, 10); // seam: hash only the secret
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      const [reset] = await this.db
        .insert(passwordResets)
        .values({
          userId: existing.id,
          tokenHash,
          expiresAt,
        })
        .returning({ id: passwordResets.id });

      // Delivery seam: raw `${resetId}.${secret}` goes to the provider, not to logs.
      this.deliverPasswordReset(email, `${reset.id}.${secret}`);
    }

    // Uniform response — never reveals whether the address exists.
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  async confirmPasswordReset(rawToken: string, newPassword: string): Promise<{ message: string }> {
    const [resetId, secret] = rawToken.split('.', 2) as [string, string | undefined];
    if (!resetId || !secret) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const [reset] = await this.db
      .select({
        id: passwordResets.id,
        userId: passwordResets.userId,
        tokenHash: passwordResets.tokenHash,
        expiresAt: passwordResets.expiresAt,
        usedAt: passwordResets.usedAt,
        createdAt: passwordResets.createdAt,
      })
      .from(passwordResets)
      .where(eq(passwordResets.id, resetId))
      .limit(1);

    const expired = reset && new Date(reset.expiresAt).getTime() <= Date.now();
    if (!reset || reset.usedAt || !expired === false) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const secretOk = await bcryptjs.compare(secret, reset.tokenHash);
    if (!secretOk) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    // Atomic single-use: mark used only if still unused.
    const [consumed] = await this.db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt)))
      .returning({ id: passwordResets.id });

    if (!consumed) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    // Mirror registration policy: bcrypt cost 12 (users.service).
    const passwordHash = await bcryptjs.hash(newPassword, 12);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));

    // A password change invalidates every session the user holds.
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(authSessions.userId, reset.userId), isNull(authSessions.revokedAt)));

    return { message: 'Password updated. Please sign in again.' };
  }

  private toSafeUser(user: typeof users.$inferSelect): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      createdAt: user.createdAt,
    };
  }
}

