import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';

import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('jobs')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateJobDto,
  ) {
    const job = await this.jobsService.createJob(tenant.instituteId, dto.type, dto.payload);
    return { job };
  }

  @Get()
  @RequiredRoles(...WRITE_ROLES)
  async list(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('batchId') batchId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 100);
    const parsedOffset = Math.max(Number(offset ?? 0) || 0, 0);
    const result = await this.jobsService.listJobs(
      tenant.instituteId,
      { status, type, batchId, sourceType },
      parsedLimit,
      parsedOffset,
    );
    return result;
  }

  @Get(':jobId')
  @RequiredRoles(...WRITE_ROLES)
  async findOne(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.jobsService.getJob(jobId, tenant.instituteId);
    return { job };
  }

  @Post(':jobId/retry')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async retry(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.jobsService.retryJob(jobId, tenant.instituteId);
    return { job };
  }

  @Post(':jobId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async cancel(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.jobsService.cancelJob(jobId, tenant.instituteId);
    return { job };
  }
}
