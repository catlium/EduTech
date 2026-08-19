import { Module } from '@nestjs/common';
import { MaterialsController } from './materials.controller.js';
import { MaterialsService } from './materials.service.js';
import { LocalStorageProvider } from './storage/local-storage.provider.js';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface.js';

@Module({
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