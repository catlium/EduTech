import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { QuestionsModule } from '../questions/questions.module.js';
import { MaterialEnhancementModule } from '../material-enhancement/material-enhancement.module.js';
import { QuestionPapersModule } from '../question-papers/question-papers.module.js';
import { MaterialsModule } from '../materials/materials.module.js';
import { QuestionExtractionController } from './question-extraction.controller.js';
import { QuestionExtractionService } from './question-extraction.service.js';

@Module({
  imports: [
    JobsModule,
    QuestionsModule,
    MaterialEnhancementModule,
    QuestionPapersModule,
    MaterialsModule,
  ],
  controllers: [QuestionExtractionController],
  providers: [QuestionExtractionService],
})
export class QuestionExtractionModule {}