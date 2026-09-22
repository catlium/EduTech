import { Module } from '@nestjs/common';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';
import { PuppeteerService } from './puppeteer.service.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';

@Module({
  imports: [ExaminationsModule],
  controllers: [ExportController],
  providers: [ExportService, PuppeteerService],
  exports: [ExportService],
})
export class ExportModule {}
