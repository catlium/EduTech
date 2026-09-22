import { Module } from '@nestjs/common';
import { PlatformInstitutesController } from './platform-institutes.controller.js';
import { PlatformInstitutesService } from './platform-institutes.service.js';

@Module({
  controllers: [PlatformInstitutesController],
  providers: [PlatformInstitutesService],
})
export class PlatformModule {}
