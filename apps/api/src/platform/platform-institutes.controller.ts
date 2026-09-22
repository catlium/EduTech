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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { PlatformGuard } from '../authorization/platform.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import {
  PlatformInstitutesService,
  type InstituteAdmin,
  type InstituteDetail,
  type InstituteSubscriptionResult,
  type InstituteSummary,
} from './platform-institutes.service.js';
import type { CreateInstituteDto, UpdateInstituteDto } from './platform-institutes.dto.js';

// Institute management (institute-lifecycle §5/§6/§7/§9/§11) — platform plane:
// Authentication → PlatformGuard only. No TenantGuard, no x-institute-id by
// construction; SUPER_ADMIN holds the institutes.* keys on the platform plane,
// institute-plane users hold no platform keys and are denied. Institute status
// NEVER gates these endpoints (they carry no institute context by design);
// tenant access flips on the next request via TenantGuard's DB-fresh status
// check. Lifecycle state transitions stay owned by deactivate/reactivate.
@Controller('platform/institutes')
@UseGuards(AccessTokenGuard, PlatformGuard)
export class PlatformInstitutesController {
  constructor(private readonly institutes: PlatformInstitutesService) {}

  @Get()
  @RequiredPermission('institutes.read')
  list(@Query('status') status?: string): Promise<InstituteSummary[]> {
    return this.institutes.list(status);
  }

  @Post()
  @RequiredPermission('institutes.create')
  create(@Body() dto: CreateInstituteDto): Promise<InstituteDetail> {
    return this.institutes.create(dto);
  }

  @Get(':id')
  @RequiredPermission('institutes.read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InstituteDetail> {
    return this.institutes.get(id);
  }

  @Patch(':id')
  @RequiredPermission('institutes.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInstituteDto): Promise<InstituteSummary> {
    return this.institutes.update(id, dto);
  }

  @Get(':id/admins')
  @RequiredPermission('institutes.read')
  admins(@Param('id', ParseUUIDPipe) id: string): Promise<InstituteAdmin[]> {
    return this.institutes.listAdmins(id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('institutes.update')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string; status: string; deactivatedAt: Date | null }> {
    return this.institutes.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('institutes.update')
  reactivate(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string; status: string; deactivatedAt: Date | null }> {
    return this.institutes.reactivate(id);
  }

  @Get(':id/subscription')
  @RequiredPermission('institutes.read')
  subscription(@Param('id', ParseUUIDPipe) id: string): Promise<InstituteSubscriptionResult> {
    return this.institutes.getSubscription(id);
  }

  @Put(':id/subscription')
  @RequiredPermission('institutes.manage')
  updateSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { planCode: string },
  ): Promise<InstituteSubscriptionResult> {
    return this.institutes.updateSubscription(id, body);
  }
}
