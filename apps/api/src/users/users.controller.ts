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

/**
 * Institute-level user management, F5.5-migrated onto one `users.*` key per
 * operation. Every query is tenant-scoped in `UsersService`.
 *
 * `POST /users` takes `users.create` and `PATCH /users/:userId/status` takes
 * `users.update`. Both are satisfied by INSTITUTE_ADMIN through `users.manage`
 * implication and denied to TEACHER (which holds neither) — the same reachable
 * set the legacy `INSTITUTE_ADMIN` gate gave. `CreateUserDto.role` still admits
 * only `TEACHER`/`STUDENT`, so neither route can mint an admin, and the service
 * still blocks self-status and self-role changes.
 *
 * `GET /users` takes `users.read`. This is the one route where the migration
 * deliberately WIDENS: TEACHER already holds `users.read` in the built-in
 * mapping, and the web app already gates its `/users` nav entry on exactly that
 * key (`app-sidebar.tsx`, `layout.tsx`), so the shipped teacher-assignment and
 * student-placement roster pickers (`assignments-section.tsx`,
 * `placements-section.tsx`) were calling this route and receiving 403. The
 * permission is what the rest of the stack already assumed. Documented in
 * `docs/architecture/authorization.md` §13 F5.5.
 *
 * `PUT /users/:userId/roles` STAYS ROLE-GATED. It keeps `users.update` AND the
 * `INSTITUTE_ADMIN` role gate. Handing out a role is handing out a permission
 * bundle, so no single `users.*` action can express it: a custom role holding
 * `users.update` would otherwise grant itself `INSTITUTE_ADMIN` and take the
 * whole institute. The service's self-modification block and
 * `RoleAssignmentService`'s platform/cross-institute rejection stay as defence
 * in depth. A deliberate authorization ceiling, not technical debt.
 */
@Controller('users')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequiredPermission('users.read')
  async list(@Tenant() tenant: TenantContext) {
    const users = await this.usersService.listInstituteUsers(tenant.instituteId);
    return { users };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('users.create')
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateUserDto) {
    const user = await this.usersService.createInstituteUser(tenant.instituteId, dto);
    return { user };
  }

  @Patch(':userId/status')
  @RequiredPermission('users.update')
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

  // INTENTIONALLY ROLE-GATED — see the class comment: this is a
  // privilege-granting route, so `users.update` is an AND requirement on top of
  // the role gate, never a replacement for it.
  @Put(':userId/roles')
  @RequiredPermission('users.update')
  @RequiredRoles('INSTITUTE_ADMIN')
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
