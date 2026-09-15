import { Module } from '@nestjs/common';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';
import { PuppeteerService } from './puppeteer.service.js';

@Module({
  controllers: [ExportController],
  providers: [ExportService, PuppeteerService],
  exports: [ExportService],
})
export class ExportModule {}
