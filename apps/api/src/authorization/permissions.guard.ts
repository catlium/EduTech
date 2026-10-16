import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { PermissionCheckService } from './permission-check.service.js';
import { hasPermission, resolveGrantedKeys, type PermissionKey } from './permission-catalogue.js';
import { PERMISSIONS_KEY, PERMISSIONS_ALL_KEY } from './permissions.decorator.js';

/**
 * Permission authorization layer — runs after Authentication + Tenant
 * (request.tenant is populated by TenantGuard). Defaults to allow when no
 * permission is declared, so adoption is opt-in per endpoint/controller.
 *
 * Two independent requirement groups are combined with AND:
 *  - `RequiredPermission(...)` (any) — OR: at least one declared key granted.
 *  - `RequiredPermissions(...)` (all) — AND: EVERY declared key granted.
 * Either empty group passes trivially, so existing single-key routes are
 * unaffected and a route may combine both groups at once.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCheck: PermissionCheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAny = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAll = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_ALL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if ((!requiredAny || requiredAny.length === 0) && (!requiredAll || requiredAll.length === 0)) {
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
    const allowedAny =
      !requiredAny || requiredAny.length === 0 ||
      requiredAny.some((permission) => hasPermission(granted, permission));
    const allowedAll =
      !requiredAll || requiredAll.length === 0 ||
      requiredAll.every((permission) => hasPermission(granted, permission));

    if (!allowedAny || !allowedAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}