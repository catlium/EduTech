import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { PermissionCheckService } from './permission-check.service.js';
import { hasPermission, resolveGrantedKeys, type PermissionKey } from './permission-catalogue.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';

/**
 * Permission authorization layer — runs after Authentication + Tenant
 * (request.tenant is populated by TenantGuard). Defaults to allow when no
 * permission is declared, so adoption is opt-in per endpoint/controller.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
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
    const tenant = (request as unknown as Record<string, unknown>)['tenant'] as
      | TenantContext
      | undefined;

    if (!tenant) {
      throw new ForbiddenException('Tenant context required');
    }

    // DB-fresh grants, filtered to the supported institute catalogue.
    const granted = resolveGrantedKeys(
      await this.permissionCheck.grantKeysForMembership(tenant.membershipId),
      'institute',
    );
    const allowed = required.some((permission) => hasPermission(granted, permission));

    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}