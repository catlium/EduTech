import { Controller, Post, Get, Body, Query, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';

import { GenerationService } from './generation.service.js';
import { GenerateContentDto } from './dto/generate-content.dto.js';
import { GenerateContentPackageDto } from './dto/generate-content-package.dto.js';
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
    const items = await this.generationService.getContentGenerationStatus(
      tenant.instituteId,
      materialId,
    );
    return { materialId, items };
  }
}
