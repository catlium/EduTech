import { Module } from '@nestjs/common';
import { SyllabusController } from './syllabus.controller.js';
import { SyllabusService } from './syllabus.service.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { LocalStorageProvider } from '../materials/storage/local-storage.provider.js';
import { STORAGE_PROVIDER } from '../materials/storage/storage-provider.interface.js';

@Module({
  controllers: [SyllabusController],
  providers: [
    SyllabusService,
    {
      provide: STORAGE_PROVIDER,
      useClass: LocalStorageProvider,
    },
  ],
  imports: [JobsModule],
})
export class SyllabusModule {}