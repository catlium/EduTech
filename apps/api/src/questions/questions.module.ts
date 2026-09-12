import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller.js';
import { QuestionTypesController } from './question-types.controller.js';
import { QuestionsService } from './questions.service.js';
import { QuestionTypesService } from './question-types.service.js';
import { QuestionGenerationService } from './question-generation.service.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  controllers: [QuestionsController, QuestionTypesController],
  providers: [QuestionsService, QuestionTypesService, QuestionGenerationService],
  imports: [JobsModule],
})
export class QuestionsModule {}
