import { Module } from '@nestjs/common';
import { PracticeController } from './practice.controller.js';
import { PracticeService } from './practice.service.js';

@Module({
  controllers: [PracticeController],
  providers: [PracticeService],
})
export class PracticeModule {}