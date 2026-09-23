import { Module } from '@nestjs/common';
import { PlatformInstitutesController } from './platform-institutes.controller.js';
import { PlatformInstitutesService } from './platform-institutes.service.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { PlatformUsersController } from './platform-users.controller.js';
import { PlatformUsersService } from './platform-users.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

@Module({
  controllers: [PlatformInstitutesController, PlatformAdminController, PlatformUsersController],
  providers: [PlatformInstitutesService, PlatformUsersService, PlatformAuditService],
})
export class PlatformModule {}
