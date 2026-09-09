import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { PaperPatternsService } from './paper-patterns.service.js';
import {
  AnalyzePaperPatternDto,
  CreateAssessmentFromBlueprintDto,
  CreatePaperPatternDto,
  UpdatePaperPatternDto,
} from './paper-patterns.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('paper-patterns')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class PaperPatternsController {
  constructor(private readonly paperPatternsService: PaperPatternsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaperPatternDto,
  ) {
    const pattern = await this.paperPatternsService.createPattern(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { pattern };
  }

  @Get()
  @RequiredRoles(...WRITE_ROLES)
  async list(@Tenant() tenant: TenantContext) {
    const patterns = await this.paperPatternsService.listPatterns(tenant.instituteId);
    return { patterns };
  }

  @Get(':patternId')
  @RequiredRoles(...WRITE_ROLES)
  async get(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.getPattern(tenant.instituteId, patternId);
    return { pattern };
  }

  @Patch(':patternId')
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: UpdatePaperPatternDto,
  ) {
    const pattern = await this.paperPatternsService.updatePattern(
      tenant.instituteId,
      user.userId,
      patternId,
      dto,
    );
    return { pattern };
  }

  @Post(':patternId/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async analyze(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: AnalyzePaperPatternDto,
  ) {
    const generation = await this.paperPatternsService.analyze(
      tenant.instituteId,
      user.userId,
      patternId,
      dto.source,
    );
    return { generation };
  }

  @Get(':patternId/analyze/:jobId')
  @RequiredRoles(...WRITE_ROLES)
  async getAnalysis(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.paperPatternsService.getAnalysisJob(
      tenant.instituteId,
      patternId,
      jobId,
    );
    return {
      generation: {
        jobId: job.id,
        operation: job.type,
        status: job.status,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
    };
  }

  @Post(':patternId/validate')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async validate(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    return this.paperPatternsService.validate(tenant.instituteId, patternId);
  }

  @Post(':patternId/approve')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async approve(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.approve(
      tenant.instituteId,
      user.userId,
      patternId,
    );
    return { pattern };
  }

  @Post(':patternId/assessment')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createAssessment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: CreateAssessmentFromBlueprintDto,
  ) {
    const assessment = await this.paperPatternsService.createAssessmentFromBlueprint(
      tenant.instituteId,
      user.userId,
      patternId,
      dto,
    );
    return { assessment };
  }
}