import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';

import { authSessions, users } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../../database/database.module.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';

// F1 — access tokens are session-bound ({sub, sid}). Besides signature +
// expiry, the guard verifies the referenced session row is still live
// (not revoked, not expired) and the user's status is still 'active'. Session
// revocation / user deactivation therefore take effect on the next request —
// no ≤15-minute residual window.
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.['access_token'] as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: { sub: string; sid?: string };
    try {
      payload = await this.jwtService.verifyAsync<{ sub: string; sid?: string }>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload.sid) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const [session] = await this.db
      .select({ userId: authSessions.userId, revokedAt: authSessions.revokedAt, expiresAt: authSessions.expiresAt })
      .from(authSessions)
      .where(eq(authSessions.id, payload.sid));

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt !== null ||
      new Date(session.expiresAt).getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, payload.sub));

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid or expired token');
    }

    (request as unknown as Record<string, unknown>)['user'] = {
      userId: payload.sub,
    } satisfies AuthenticatedUser;
    return true;
  }
}