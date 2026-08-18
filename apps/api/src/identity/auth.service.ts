import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { users, authSessions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { normalizeEmail } from '@catlium/shared';
import { DATABASE_TOKEN } from '../database/database.module.js';

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

  async register(email: string, name: string, password: string): Promise<SafeUser> {
    const normalizedEmail = normalizeEmail(email);

    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcryptjs.hash(password, 12);

    const [user] = await this.db
      .insert(users)
      .values({
        email: normalizedEmail,
        name,
        passwordHash,
      })
      .returning();

    return this.toSafeUser(user!);
  }

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

    if (session.revokedAt) {
      throw new UnauthorizedException('Session revoked');
    }

    if (new Date() > session.expiresAt) {
      throw new UnauthorizedException('Session expired');
    }

    const tokenValid = await bcryptjs.compare(refreshToken, session.refreshTokenHash);

    if (!tokenValid) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

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

  private async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(authSessions.id, sessionId));
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
