import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { RolesService } from './roles.service.js';
import { CreateRoleDto, UpdateRoleDto, SetRolePermissionsDto } from './roles.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from './permissions.guard.js';
import { RequiredPermission } from './permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

// Institute-local role management (Phase C / D2 §14). Tenant-scoped via the
// x-institute-id model; authorization is permission-based — INSTITUTE_ADMIN
// holds roles.manage through the built-in mapping, custom roles only if the
// institute grants them roles.* (system roles are never mutated here).
@Controller('roles')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequiredPermission('roles.read')
  async list(@Tenant() tenant: TenantContext) {
    const roles = await this.rolesService.listRoles(tenant.instituteId);
    return { roles };
  }

  @Get(':roleId')
  @RequiredPermission('roles.read')
  async get(@Tenant() tenant: TenantContext, @Param('roleId', ParseUUIDPipe) roleId: string) {
    const role = await this.rolesService.getRole(tenant.instituteId, roleId);
    return { role };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('roles.create')
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateRoleDto) {
    const role = await this.rolesService.createRole(tenant.instituteId, dto);
    return { role };
  }

  @Patch(':roleId')
  @RequiredPermission('roles.update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const role = await this.rolesService.updateRole(tenant.instituteId, roleId, dto);
    return { role };
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('roles.delete')
  async remove(@Tenant() tenant: TenantContext, @Param('roleId', ParseUUIDPipe) roleId: string) {
    await this.rolesService.deleteRole(tenant.instituteId, roleId);
  }

  @Put(':roleId/permissions')
  @RequiredPermission('roles.update')
  async setPermissions(
    @Tenant() tenant: TenantContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    const role = await this.rolesService.setRolePermissions(
      tenant.instituteId,
      roleId,
      dto.permissionKeys,
      tenant.roles,
    );
    return { role };
  }
}