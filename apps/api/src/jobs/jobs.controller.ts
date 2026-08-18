import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';

import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';

@Controller('jobs')
@UseGuards(AccessTokenGuard, TenantGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateJobDto,
  ) {
    const job = await this.jobsService.createJob(tenant.instituteId, dto.type, dto.payload);
    return { job };
  }

  @Get(':jobId')
  async findOne(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.jobsService.getJob(jobId, tenant.instituteId);
    return { job };
  }
}
