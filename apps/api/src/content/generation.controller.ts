import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';

import { GenerationService } from './generation.service.js';
import { GenerateContentDto } from './dto/generate-content.dto.js';
import { GenerateContentPackageDto } from './dto/generate-content-package.dto.js';
import { GenerateBatchDto } from './dto/generate-batch.dto.js';
import { GenerateStarterMaterialDto } from './dto/generate-starter-material.dto.js';
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
 *  * F5.5 — AI generation guard migration (§13 `content` + `jobs`). Every route
 * here enqueues or inspects generation work, so the four that WRITE content
 * take `content.create` / `content.update` and the three that only REPORT
 * generation-job state (per-material status, batch progress, batch cancel) take
 * `jobs.read` / `jobs.update`.
 *
 * `jobs.*` rather than `content.read` is deliberate and behaviour-preserving:
 * these three routes carried the write role gate even though they are reads,
 * and `content.read` is held by STUDENT — mapping them there would have handed
 * students the institute-wide generation-job ledger. `jobs.read`/`jobs.update`
 * are held by TEACHER and (implied) INSTITUTE_ADMIN only, so the reachable set
 * is unchanged. `GenerationService` keeps its `requireWritableSubject` /
 * `requireReadableSubject` checks per material, topic and batch source.

 */
@Controller('content')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('content.create')
  async generate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateContentDto,
  ) {
    const generation = await this.generationService.requestGeneration(
      dto.operation,
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto.sourceType,
      dto.sourceId,
    );
    return { generation };
  }

  @Post('starter-material')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('content.create')
  async generateStarterMaterial(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateStarterMaterialDto,
  ) {
    const generation = await this.generationService.requestStarterMaterialGeneration(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto.topicId,
    );
    return { generation };
  }

  @Post('generate-package')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('content.create')
  async generatePackage(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateContentPackageDto,
  ) {
    const generation = await this.generationService.requestPackageGeneration(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto.sourceType,
      dto.sourceId,
      dto.includeTypes,
    );
    return { generation };
  }

  @Get('generation-status')
  @RequiredPermission('jobs.read')
  async getGenerationStatus(
    @Tenant() tenant: TenantContext,
    @Query('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const status = await this.generationService.getContentGenerationStatus(
      tenant.instituteId,
      tenant.membershipId,
      materialId,
    );
    return { generationStatus: status };
  }

  @Post('generate-batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('content.create')
  async generateBatch(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateBatchDto,
  ) {
    const batch = await this.generationService.requestBatchGeneration(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto.sourceType,
      dto.sourceId,
      dto.types,
      dto.mode,
    );
    return { batch };
  }

  @Post(':contentId/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('content.update')
  async regenerateResource(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const regeneration = await this.generationService.requestResourceRegeneration(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
    );
    return { regeneration };
  }

  @Get('generation-batches/:batchId')
  @RequiredPermission('jobs.read')
  async getBatch(
    @Tenant() tenant: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    const batch = await this.generationService.getGenerationBatch(batchId, tenant.instituteId);
    return { batch };
  }

  @Post('generation-batches/:batchId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('jobs.update')
  async cancelBatch(
    @Tenant() tenant: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    const batch = await this.generationService.cancelGenerationBatch(batchId, tenant.instituteId);
    return { batch };
  }
}
