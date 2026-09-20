import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';

import { UsersService } from './users.service.js';
import { CreateUserDto, SetMembershipRolesDto, UpdateUserStatusDto } from './users.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';

// Institute-level user management. INSTITUTE_ADMIN ONLY: teachers and students
// must never manage institute membership, and every query is tenant-scoped.
// The permission layer (roles.manage implied by users.update) closes the loop
// for Phase C role assignment at the same boundary.
@Controller('users')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequiredRoles('INSTITUTE_ADMIN')
  async list(@Tenant() tenant: TenantContext) {
    const users = await this.usersService.listInstituteUsers(tenant.instituteId);
    return { users };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles('INSTITUTE_ADMIN')
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateUserDto) {
    const user = await this.usersService.createInstituteUser(tenant.instituteId, dto);
    return { user };
  }

  @Patch(':userId/status')
  @RequiredRoles('INSTITUTE_ADMIN')
  async updateStatus(
    @Tenant() tenant: TenantContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    const user = await this.usersService.setMembershipStatus(
      tenant.instituteId,
      tenant.membershipId,
      userId,
      dto,
    );
    return { user };
  }

  @Put(':userId/roles')
  @RequiredRoles('INSTITUTE_ADMIN')
  @RequiredPermission('users.update')
  async setMembershipRoles(
    @Tenant() tenant: TenantContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetMembershipRolesDto,
  ) {
    const user = await this.usersService.setMembershipRoles(
      tenant.instituteId,
      tenant.membershipId,
      userId,
      dto.roleIds,
    );
    return { user };
  }
}
