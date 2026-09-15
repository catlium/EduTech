import { Module } from '@nestjs/common';
import { OcrWorkersController } from './ocr-workers.controller.js';
import { OcrWorkerController } from './ocr-worker.controller.js';
import { OcrWorkersService } from './ocr-workers.service.js';
import { OcrCoordinatorService } from './ocr-coordinator.service.js';
import { OcrWorkerAuthGuard } from './guards/ocr-worker-auth.guard.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { LocalStorageProvider } from '../materials/storage/local-storage.provider.js';
import { STORAGE_PROVIDER } from '../materials/storage/storage-provider.interface.js';

@Module({
  imports: [JobsModule],
  controllers: [OcrWorkersController, OcrWorkerController],
  providers: [
    OcrWorkersService,
    OcrCoordinatorService,
    OcrWorkerAuthGuard,
    {
      provide: STORAGE_PROVIDER,
      useClass: LocalStorageProvider,
    },
  ],
  exports: [OcrWorkersService, OcrCoordinatorService, OcrWorkerAuthGuard],
})
export class OcrModule {}