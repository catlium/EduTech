import { Controller, Get, Post, Param, Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';

import { MaterialEnhancementService } from './enhancement.service.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('materials')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class MaterialEnhancementController {
  constructor(private readonly enhancements: MaterialEnhancementService) {}

  @Get(':materialId/enhancement')
  async latest(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.enhancements.getLatest(tenant.instituteId, materialId);
  }

  @Get(':materialId/enhancement/versions')
  async versions(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return { enhancements: await this.enhancements.listVersions(tenant.instituteId, materialId) };
  }

  @Get(':materialId/enhancement/segments')
  async segments(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Query('version') version?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('unitTitle') unitTitle?: string,
    @Query('level') level?: string,
  ) {
    return this.enhancements.listSegments(tenant.instituteId, materialId, {
      ...(version !== undefined ? { version: parseInt(version, 10) } : {}),
      ...(entityType !== undefined && entityId !== undefined ? { entityType, entityId } : {}),
      ...(entityType === 'unit' && unitTitle !== undefined ? { unitTitle } : {}),
      ...(level !== undefined ? { level } : {}),
    });
  }

  @Post(':materialId/enhancement')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async enhance(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const job = await this.enhancements.requestEnhancement(
      tenant.instituteId,
      materialId,
      'MANUAL',
      user.userId,
    );
    return { materialId, jobId: job.id, enhancementStatus: 'QUEUED' };
  }
}