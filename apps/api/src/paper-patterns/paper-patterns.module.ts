import { Module } from '@nestjs/common';
import { PaperPatternsController } from './paper-patterns.controller.js';
import { PaperPatternExtractionService } from './paper-pattern-extraction.service.js';
import { PaperPatternsService } from './paper-patterns.service.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MaterialsModule } from '../materials/materials.module.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';
import { QuestionsModule } from '../questions/questions.module.js';

@Module({
  imports: [JobsModule, MaterialsModule, ExaminationsModule, QuestionsModule],
  controllers: [PaperPatternsController],
  providers: [PaperPatternsService, PaperPatternExtractionService],
})
export class PaperPatternsModule {}
