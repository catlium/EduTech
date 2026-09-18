import { Module } from '@nestjs/common';
import { MaterialsController } from './materials.controller.js';
import { MaterialsService } from './materials.service.js';
import { LocalStorageProvider } from './storage/local-storage.provider.js';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { MaterialEnhancementModule } from '../material-enhancement/material-enhancement.module.js';

@Module({
  imports: [JobsModule, OcrModule, MaterialEnhancementModule],
  controllers: [MaterialsController],
  providers: [
    MaterialsService,
    {
      provide: STORAGE_PROVIDER,
      useClass: LocalStorageProvider,
    },
  ],
  exports: [MaterialsService],
})
export class MaterialsModule {}
