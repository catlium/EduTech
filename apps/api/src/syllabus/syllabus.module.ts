import { Module } from '@nestjs/common';
import { SyllabusController } from './syllabus.controller.js';
import { SyllabusService } from './syllabus.service.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  controllers: [SyllabusController],
  providers: [SyllabusService],
  imports: [JobsModule],
})
export class SyllabusModule {}