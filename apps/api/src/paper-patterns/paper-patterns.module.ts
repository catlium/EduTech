import { Module } from '@nestjs/common';
import { PaperPatternsController } from './paper-patterns.controller.js';
import { PaperPatternsService } from './paper-patterns.service.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MaterialsModule } from '../materials/materials.module.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';

@Module({
  imports: [JobsModule, MaterialsModule, ExaminationsModule],
  controllers: [PaperPatternsController],
  providers: [PaperPatternsService],
})
export class PaperPatternsModule {}