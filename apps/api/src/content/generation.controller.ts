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
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('content')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateContentDto,
  ) {
    const generation = await this.generationService.requestGeneration(
      dto.operation,
      tenant.instituteId,
      user.userId,
      dto.sourceType,
      dto.sourceId,
    );
    return { generation };
  }

  @Post('starter-material')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generateStarterMaterial(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateStarterMaterialDto,
  ) {
    const generation = await this.generationService.requestStarterMaterialGeneration(
      tenant.instituteId,
      user.userId,
      dto.topicId,
    );
    return { generation };
  }

  @Post('generate-package')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generatePackage(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateContentPackageDto,
  ) {
    const generation = await this.generationService.requestPackageGeneration(
      tenant.instituteId,
      user.userId,
      dto.sourceType,
      dto.sourceId,
      dto.includeTypes,
    );
    return { generation };
  }

  @Get('generation-status')
  @RequiredRoles(...WRITE_ROLES)
  async getGenerationStatus(
    @Tenant() tenant: TenantContext,
    @Query('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const status = await this.generationService.getContentGenerationStatus(
      tenant.instituteId,
      materialId,
    );
    return { generationStatus: status };
  }

  @Post('generate-batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generateBatch(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateBatchDto,
  ) {
    const batch = await this.generationService.requestBatchGeneration(
      tenant.instituteId,
      user.userId,
      dto.sourceType,
      dto.sourceId,
      dto.types,
      dto.mode,
    );
    return { batch };
  }

  @Get('generation-batches/:batchId')
  @RequiredRoles(...WRITE_ROLES)
  async getBatch(
    @Tenant() tenant: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    const batch = await this.generationService.getGenerationBatch(batchId, tenant.instituteId);
    return { batch };
  }

  @Post('generation-batches/:batchId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async cancelBatch(
    @Tenant() tenant: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    const batch = await this.generationService.cancelGenerationBatch(batchId, tenant.instituteId);
    return { batch };
  }
}
