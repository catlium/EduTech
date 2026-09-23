import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { PlatformGuard } from '../authorization/platform.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import {
  PlatformUsersService,
  type PlatformUserDetail,
  type PlatformUserLifecycleResult,
  type PlatformUserRevokeResult,
  type PlatformUserRoleResult,
  type PlatformUserSummary,
} from './platform-users.service.js';
import type { GrantPlatformRoleDto } from './platform-users.dto.js';

// Platform-user lifecycle (platform-user-lifecycle §12) — platform plane:
// Authentication → PlatformGuard only; no TenantGuard, no x-institute-id by
// construction. SUPER_ADMIN holds platform-users.* on the platform plane while
// institute-plane users hold no platform keys → 403. The target's account
// status never gates the permission layer (guards check the ACTOR via
// AccessTokenGuard; the TARGET is swam by suspend/reactivate units).
@Controller('platform/users')
@UseGuards(AccessTokenGuard, PlatformGuard)
export class PlatformUsersController {
  constructor(private readonly platformUsers: PlatformUsersService) {}

  @Get()
  @RequiredPermission('platform-users.read')
  list(@Query('status') status?: string): Promise<PlatformUserSummary[]> {
    return this.platformUsers.list(status);
  }

  @Get(':userId')
  @RequiredPermission('platform-users.read')
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<PlatformUserDetail> {
    return this.platformUsers.get(userId);
  }

  @Post(':userId/roles')
  @RequiredPermission('platform-users.update')
  grantRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantPlatformRoleDto,
  ): Promise<PlatformUserRoleResult> {
    return this.platformUsers.grantRole(userId, dto.roleKey, user.userId);
  }

  @Delete(':userId/roles/:roleId')
  @RequiredPermission('platform-users.update')
  revokeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<PlatformUserRevokeResult> {
    return this.platformUsers.revokeRole(userId, roleId, user.userId);
  }

  @Post(':userId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('platform-users.update')
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<PlatformUserLifecycleResult> {
    return this.platformUsers.suspend(userId, user.userId);
  }

  @Post(':userId/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('platform-users.update')
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<PlatformUserLifecycleResult> {
    return this.platformUsers.reactivate(userId, user.userId);
  }
}