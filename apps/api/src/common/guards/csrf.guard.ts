import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { decideCsrf } from './csrf-policy.js';

// F4 — double-submit CSRF token on every cookie-authenticated state-changing
// request (POST/PUT/PATCH/DELETE); GET/HEAD/OPTIONS exempt. Registered as a
// global APP_GUARD so it cannot be forgotten on a controller.
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const verdict = decideCsrf(
      request.method,
      Boolean(request.cookies?.['access_token']),
      request.cookies?.['csrf_token'] as string | undefined,
      request.headers['x-csrf-token'] as string | undefined,
    );

    if (verdict === 'missing') {
      throw new ForbiddenException('CSRF token missing');
    }
    if (verdict === 'mismatch') {
      throw new ForbiddenException('CSRF token mismatch');
    }
    return true;
  }
}