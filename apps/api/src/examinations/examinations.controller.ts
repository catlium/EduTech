import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { ExaminationsService } from './examinations.service.js';
import { CreateAssessmentDto } from './dto/create-assessment.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('assessments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class ExaminationsController {
  constructor(private readonly examinationsService: ExaminationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAssessmentDto,
  ) {
    const assessment = await this.examinationsService.createAssessment(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { assessment };
  }

  @Get()
  async list(@Tenant() tenant: TenantContext) {
    const assessments = await this.examinationsService.listAssessments(tenant.instituteId);
    return { assessments };
  }

  @Get(':assessmentId')
  async get(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.examinationsService.getAssessment(
      tenant.instituteId,
      assessmentId,
    );
    return { assessment };
  }
}