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

import { SyllabusService } from './syllabus.service.js';
import { GenerateSyllabusDto, UpdateSyllabusDto } from './dto/syllabus.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('academic/subjects/:subjectId/syllabus')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class SyllabusController {
  constructor(private readonly syllabusService: SyllabusService) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: GenerateSyllabusDto,
  ) {
    const generation = await this.syllabusService.generate(
      tenant.instituteId,
      user.userId,
      subjectId,
      dto.materialId,
    );
    return { generation };
  }

  @Get('jobs/:jobId')
  @RequiredRoles(...WRITE_ROLES)
  async getGeneration(
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.syllabusService.getGenerationJob(tenant.instituteId, jobId);
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

  @Get()
  async get(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const proposal = await this.syllabusService.getProposal(tenant.instituteId, subjectId);
    return { proposal };
  }

  @Patch()
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: UpdateSyllabusDto,
  ) {
    const proposal = await this.syllabusService.updateProposal(
      tenant.instituteId,
      user.userId,
      subjectId,
      dto.structure,
    );
    return { proposal };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async confirm(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const proposal = await this.syllabusService.confirmProposal(
      tenant.instituteId,
      user.userId,
      subjectId,
    );
    return { proposal };
  }
}