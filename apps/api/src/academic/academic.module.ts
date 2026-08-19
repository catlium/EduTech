import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller.js';
import { AcademicService } from './academic.service.js';

@Module({
  controllers: [AcademicController],
  providers: [AcademicService],
  exports: [AcademicService],
})
export class AcademicModule {}