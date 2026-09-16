import { Module } from '@nestjs/common';
import { QuestionPapersController } from './question-papers.controller.js';
import { QuestionPapersService } from './question-papers.service.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';

@Module({
  imports: [ExaminationsModule],
  controllers: [QuestionPapersController],
  providers: [QuestionPapersService],
  exports: [QuestionPapersService],
})
export class QuestionPapersModule {}