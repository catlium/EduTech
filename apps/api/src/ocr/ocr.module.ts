import { Module } from '@nestjs/common';
import { OcrWorkersController } from './ocr-workers.controller.js';
import { OcrWorkersService } from './ocr-workers.service.js';
import { OcrWorkerAuthGuard } from './guards/ocr-worker-auth.guard.js';

@Module({
  controllers: [OcrWorkersController],
  providers: [OcrWorkersService, OcrWorkerAuthGuard],
  exports: [OcrWorkersService, OcrWorkerAuthGuard],
})
export class OcrModule {}