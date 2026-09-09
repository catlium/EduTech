import { Module } from '@nestjs/common';
import { ExaminationsController } from './examinations.controller.js';
import { ExaminationsService } from './examinations.service.js';

@Module({
  controllers: [ExaminationsController],
  providers: [ExaminationsService],
  exports: [ExaminationsService],
})
export class ExaminationsModule {}