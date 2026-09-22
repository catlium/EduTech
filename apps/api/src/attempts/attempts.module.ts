import { Module } from '@nestjs/common';
import { AttemptsController } from './attempts.controller.js';
import { AttemptsService } from './attempts.service.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';

@Module({
  imports: [ExaminationsModule],
  controllers: [AttemptsController],
  providers: [AttemptsService],
})
export class AttemptsModule {}