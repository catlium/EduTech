import { Global, Module } from '@nestjs/common';

import { PermissionCheckService } from './permission-check.service.js';
import { PermissionSyncService } from './permission-sync.service.js';
import { PermissionGuard } from './permissions.guard.js';

/**
 * Permission foundation (Phase B). Global so guards/decorators resolve from
 * any module; sync runs on API boot to keep the DB catalogue aligned with
 * the code catalogue.
 */
@Global()
@Module({
  providers: [PermissionSyncService, PermissionCheckService, PermissionGuard],
  exports: [PermissionCheckService, PermissionGuard],
})
export class AuthorizationModule {}