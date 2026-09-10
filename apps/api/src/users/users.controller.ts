import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';

import { UsersService } from './users.service.js';
import { CreateUserDto, UpdateUserStatusDto } from './users.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

// Institute-level user management. INSTITUTE_ADMIN ONLY: teachers and students
// must never manage institute membership, and every query is tenant-scoped.
@Controller('users')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
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
}
