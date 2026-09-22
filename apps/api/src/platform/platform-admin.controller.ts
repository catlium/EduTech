import { Controller, Get, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { PlatformGuard } from '../authorization/platform.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { PermissionCheckService } from '../authorization/permission-check.service.js';
import { resolveGrantedKeys } from '../authorization/permission-catalogue.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import {
  PlatformInstitutesService,
  type PlatformPlan,
} from './platform-institutes.service.js';

// Super Admin console helpers (institute-lifecycle §11) — platform plane, same
// guards as the institute management surface: Authentication → PlatformGuard,
// no x-institute-id. `plans` is the assignable catalog for the create/update
// forms (plans.read). `permissions` is the console's own gate probe: like
// GET /memberships on the institute plane, it resolves the caller's CURRENT
// platform grants DB-fresh (never from a JWT) so the UI can hide or show
// console surfaces without duplicating authorization logic — the API stays
// authoritative and every console action re-checks its own key.
@Controller('platform')
@UseGuards(AccessTokenGuard, PlatformGuard)
export class PlatformAdminController {
  constructor(
    private readonly institutes: PlatformInstitutesService,
    private readonly permissionCheck: PermissionCheckService,
  ) {}

  @Get('plans')
  @RequiredPermission('plans.read')
  plans(): Promise<PlatformPlan[]> {
    return this.institutes.listPlans();
  }

  // No @RequiredPermission on purpose (PlatformGuard allows an undeclared
  // route): an authenticated user with zero platform grants still learns their
  // own (empty) grant set — exactly what the console needs to render Forbidden
  // instead of looping on a 403.
  @Get('permissions')
  async permissions(@CurrentUser() user: AuthenticatedUser) {
    const granted = resolveGrantedKeys(
      await this.permissionCheck.platformGrantKeysForUser(user.userId),
      'platform',
    );
    return { permissions: [...granted].sort() };
  }
}