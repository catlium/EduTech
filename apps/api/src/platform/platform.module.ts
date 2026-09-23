import { Module } from '@nestjs/common';
import { PlatformInstitutesController } from './platform-institutes.controller.js';
import { PlatformInstitutesService } from './platform-institutes.service.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { PlatformAuditService } from './platform-audit.service.js';

@Module({
  controllers: [PlatformInstitutesController, PlatformAdminController],
  providers: [PlatformInstitutesService, PlatformAuditService],
})
export class PlatformModule {}
