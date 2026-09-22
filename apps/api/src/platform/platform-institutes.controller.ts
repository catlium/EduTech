import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { PlatformGuard } from '../authorization/platform.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { PlatformInstitutesService } from './platform-institutes.service.js';

// Institute lifecycle mutations (institute-lifecycle §7/§11) — platform plane:
// Authentication → PlatformGuard only. No TenantGuard, no x-institute-id by
// construction; SUPER_ADMIN holds institutes.update on the platform plane,
// institute-plane users hold no platform keys and are denied. Tenant access
// flips on the next request via TenantGuard's DB-fresh institute status
// check; memberships, institute data, and auth sessions stay untouched.
@Controller('platform/institutes')
@UseGuards(AccessTokenGuard, PlatformGuard)
export class PlatformInstitutesController {
  constructor(private readonly institutes: PlatformInstitutesService) {}

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
}
