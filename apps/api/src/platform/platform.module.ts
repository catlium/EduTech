import { Module } from '@nestjs/common';
import { PlatformInstitutesController } from './platform-institutes.controller.js';
import { PlatformInstitutesService } from './platform-institutes.service.js';
import { PlatformAdminController } from './platform-admin.controller.js';

@Module({
  controllers: [PlatformInstitutesController, PlatformAdminController],
  providers: [PlatformInstitutesService],
})
export class PlatformModule {}
