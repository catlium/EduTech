import { Module } from '@nestjs/common';
import { QuestionPapersController } from './question-papers.controller.js';
import { QuestionPapersService } from './question-papers.service.js';
import { QuestionPaperExtractionService } from './question-paper-extraction.service.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';
import { QuestionsModule } from '../questions/questions.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MaterialsModule } from '../materials/materials.module.js';

@Module({
  imports: [ExaminationsModule, QuestionsModule, JobsModule, MaterialsModule],
  controllers: [QuestionPapersController],
  providers: [QuestionPapersService, QuestionPaperExtractionService],
  exports: [QuestionPapersService, QuestionPaperExtractionService],
})
export class QuestionPapersModule {}