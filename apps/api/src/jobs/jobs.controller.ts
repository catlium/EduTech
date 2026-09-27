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
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';

/**
 *  * F5.5 — job monitor guard migration (§13 `jobs`). `GET /jobs` and
 * `GET /jobs/:jobId` take `jobs.read`; retry and cancel take `jobs.update`; and
 * the insert takes the `jobs.create` action F5.5 added to the catalogue,
 * because `update` cannot honestly express "no job is being updated" and an
 * explicit `manage` decorator on ordinary CRUD is forbidden by §13 (it would
 * also have silently revoked TEACHER). TEACHER already reaches all five through
 * the legacy `INSTITUTE_ADMIN`/`TEACHER` gate and still does, because
 * `jobs.create` is granted to TEACHER and INSTITUTE_ADMIN satisfies it through
 * `jobs.manage` implication; STUDENT holds nothing on `jobs` and is still
 * denied all five.
 *
 * Job OWNERSHIP is deliberately unchanged: `JobsService` still scopes every
 * query by `jobs.instituteId` and the existing `job-ownership` regression suite
 * still covers the service rules. F5.5 did not narrow the monitor to a
 * caller's own jobs — that would be a behaviour change, not a migration.

 */
@Controller('jobs')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('jobs.create')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateJobDto,
  ) {
    // The owner is stamped from the authenticated actor — never taken from the
    // client payload (which carries no userId/requestedBy for these types).
    const job = await this.jobsService.createJob(
      tenant.instituteId,
      dto.type,
      dto.payload,
      user.userId,
    );
    return { job };
  }

  @Get()
  @RequiredPermission('jobs.read')
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
  @RequiredPermission('jobs.read')
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
  @RequiredPermission('jobs.update')
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
  @RequiredPermission('jobs.update')
  async cancel(
    @CurrentUser() _user: AuthenticatedUser,
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.jobsService.cancelJob(jobId, tenant.instituteId);
    return { job };
  }
}
