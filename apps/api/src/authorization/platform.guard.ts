import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import { PermissionCheckService } from './permission-check.service.js';
import { type PermissionKey } from './permission-catalogue.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';

/**
 * Platform authorization plane (D3/§15) — runs after Authentication and is
 * deliberately INDEPENDENT of TenantGuard / x-institute-id: platform endpoints
 * resolve the user's `platform_user_roles` → platform permissions instead of
 * an institute membership. Defaults to allow when no permission is declared,
 * so adoption is opt-in; an undeclared guard never grants a platform
 * permission (platform grants only resolve to platform-domain keys, so a
 * `@RequiredPermission` with an institute key is unsatisfiable here by
 * default-deny).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCheck: PermissionCheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)['user'] as
      | AuthenticatedUser
      | undefined;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // DB-fresh platform grants, filtered to the platform-domain catalogue.
    const allowed = (
      await Promise.all(required.map((permission) => this.permissionCheck.canOnPlatform(user.userId, permission)))
    ).some(Boolean);

    if (!allowed) {
      throw new ForbiddenException('Insufficient platform permissions');
    }

    return true;
  }
}