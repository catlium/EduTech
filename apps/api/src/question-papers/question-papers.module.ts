import { Module } from '@nestjs/common';
import { QuestionPapersController } from './question-papers.controller.js';
import { QuestionPapersService } from './question-papers.service.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';
import { QuestionsModule } from '../questions/questions.module.js';

@Module({
  imports: [ExaminationsModule, QuestionsModule],
  controllers: [QuestionPapersController],
  providers: [QuestionPapersService],
  exports: [QuestionPapersService],
})
export class QuestionPapersModule {}