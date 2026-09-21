import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq, and, ne, isNull, desc } from 'drizzle-orm';
import * as bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';

import { users, authSessions, passwordResets } from '@catlium/database';
import type { Database } from '@catlium/database';
import { normalizeEmail } from '@catlium/shared';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { decideRefreshRace } from './refresh-race.js';

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

  async login(email: string, password: string): Promise<{ user: SafeUser; tokens: TokenPair }> {
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

    const tokens = await this.createSession(user.id);

    return {
      user: this.toSafeUser(user),
      tokens,
    };
  }

  async refresh(refreshToken: string): Promise<{ user: SafeUser; tokens: TokenPair }> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const [session] = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, payload.sid))
      .limit(1);

    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    const decision = decideRefreshRace(session, await bcryptjs.compare(refreshToken, session.refreshTokenHash));

    if (decision === 'revoked') {
      throw new UnauthorizedException('Session revoked');
    }

    if (decision === 'expired') {
      throw new UnauthorizedException('Session expired');
    }

    if (decision === 'token-mismatch') {
      await this.revokeSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 'rotate' covers both the normal rotation and a just-revoked session being
    // re-rotated by a concurrent refresh that shared the same token. revoke is
    // idempotent on an already-revoked row, so both paths converge.
    await this.revokeSession(session.id);

    const tokens = await this.createSession(payload.sub);

    const [user] = await this.db.select().from(users).where(eq(users.id, payload.sub)).limit(1);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

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

  private async createSession(userId: string): Promise<TokenPair> {
    const sid = uuidv4();
    const refreshDays = parseInt(process.env['REFRESH_TOKEN_EXPIRY_DAYS'] ?? '30', 10);
    const refreshExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    const accessMinutes = parseInt(process.env['ACCESS_TOKEN_EXPIRY_MINUTES'] ?? '15', 10);
    const accessToken = await this.jwtService.signAsync(
      { sub: userId },
      { expiresIn: `${accessMinutes}m` },
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, sid },
      { expiresIn: `${refreshDays}d` },
    );

    const refreshTokenHash = await bcryptjs.hash(refreshToken, 10);

    await this.db.insert(authSessions).values({
      id: sid,
      userId,
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
    });

    return { accessToken, refreshToken, refreshExpiresAt };
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

