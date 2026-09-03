import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller.js';
import { QuestionsService } from './questions.service.js';
import { QuestionGenerationService } from './question-generation.service.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  controllers: [QuestionsController],
  providers: [QuestionsService, QuestionGenerationService],
  imports: [JobsModule],
})
export class QuestionsModule {}
