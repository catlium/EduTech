import { Module } from '@nestjs/common';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';
import { PuppeteerService } from './puppeteer.service.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';
import { ContentModule } from '../content/content.module.js';
import { PaperPatternsModule } from '../paper-patterns/paper-patterns.module.js';
import { QuestionPapersModule } from '../question-papers/question-papers.module.js';

@Module({
  imports: [ExaminationsModule, ContentModule, PaperPatternsModule, QuestionPapersModule],
  controllers: [ExportController],
  providers: [ExportService, PuppeteerService],
  exports: [ExportService],
})
export class ExportModule {}
