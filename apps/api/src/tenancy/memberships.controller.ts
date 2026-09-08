import { Controller, Get, UseGuards } from '@nestjs/common';

import { TenancyService } from './tenancy.service.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

// Not tenant-scoped: lists a user's institutes so the frontend can build the
// institute picker before any x-institute-id is chosen.
@Controller('memberships')
@UseGuards(AccessTokenGuard)
export class MembershipsController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const memberships = await this.tenancyService.listMemberships(user.userId);
    return { memberships };
  }
}