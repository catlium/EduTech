import { Controller, Get, UseGuards } from '@nestjs/common';

import { TenancyService } from './tenancy.service.js';
import { AcademicScopeService } from '../authorization/academic-scope.service.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

// `GET /memberships` is intentionally NOT tenant-scoped: it lists a user's
// institutes so the frontend can build the institute picker before any
// x-institute-id is chosen. `GET /memberships/scope` IS tenant-scoped and
// returns only the actor's OWN academic scope for the active institute.
@Controller('memberships')
@UseGuards(AccessTokenGuard)
export class MembershipsController {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly academicScopeService: AcademicScopeService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const memberships = await this.tenancyService.listMemberships(user.userId);
    return { memberships };
  }

  @Get('scope')
  @UseGuards(TenantGuard)
  async scope(@Tenant() tenant: TenantContext) {
    const scope = await this.academicScopeService.describeScope(
      tenant.instituteId,
      tenant.membershipId,
    );
    return { scope };
  }
}