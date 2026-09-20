import { Global, Module } from '@nestjs/common';

import { PermissionCheckService } from './permission-check.service.js';
import { PermissionSyncService } from './permission-sync.service.js';
import { PermissionGuard } from './permissions.guard.js';
import { PlatformGuard } from './platform.guard.js';
import { RoleAssignmentService } from './role-assignment.service.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

/**
 * Permission foundation (Phase B) + membership role assignment and custom
 * institute role management (Phase C) + the platform plane guard (Phase D),
 * global so guards/decorators resolve from any module; sync runs on API boot
 * to keep the DB catalogue aligned with the code catalogue.
 */
@Global()
@Module({
  controllers: [RolesController],
  providers: [
    PermissionSyncService,
    PermissionCheckService,
    PermissionGuard,
    PlatformGuard,
    RoleAssignmentService,
    RolesService,
  ],
  exports: [
    PermissionCheckService,
    PermissionGuard,
    PlatformGuard,
    RoleAssignmentService,
    RolesService,
  ],
})
export class AuthorizationModule {}