import { Controller, Get, Post, Param, Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';

import { MaterialEnhancementService } from './enhancement.service.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

/**
 * F5.5 — material enhancement guard migration (§13 `materials`). The three
 * ungated reads take `materials.read` (TEACHER + STUDENT, so they stay open to
 * every member); the manual trigger takes `materials.update`, which TEACHER
 * holds and STUDENT does not — the same reachable set the legacy write gate
 * gave.
 *
 * KNOWN GAP, deliberately NOT closed here: `MaterialEnhancementService` scopes
 * by institute only (`assertMaterialScoped`) and never consults
 * `AcademicScopeService`, so a teacher can read and re-enhance a material under
 * a subject they are not assigned to. That is pre-existing service behaviour,
 * identical before and after this migration; adding a scope check would be a
 * behaviour change, not a guard migration. Recorded in
 * `docs/architecture/authorization.md` §13 F5.5 as remaining work.
 */
@Controller('materials')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class MaterialEnhancementController {
  constructor(private readonly enhancements: MaterialEnhancementService) {}

  @Get(':materialId/enhancement')
  @RequiredPermission('materials.read')
  async latest(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.enhancements.getLatest(tenant.instituteId, materialId);
  }

  @Get(':materialId/enhancement/versions')
  @RequiredPermission('materials.read')
  async versions(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return { enhancements: await this.enhancements.listVersions(tenant.instituteId, materialId) };
  }

  @Get(':materialId/enhancement/segments')
  @RequiredPermission('materials.read')
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
  @RequiredPermission('materials.update')
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