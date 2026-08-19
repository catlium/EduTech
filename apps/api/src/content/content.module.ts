import { Module } from '@nestjs/common';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { MaterialsModule } from '../materials/materials.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { ContentGenerationService } from './content-generation.service.js';

@Module({
  imports: [MaterialsModule, JobsModule],
  controllers: [ContentController],
  providers: [ContentService, ContentGenerationService],
  exports: [ContentService],
})
export class ContentModule {}
