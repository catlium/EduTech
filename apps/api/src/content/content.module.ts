import { Module } from '@nestjs/common';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { GenerationController } from './generation.controller.js';
import { GenerationService } from './generation.service.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  controllers: [GenerationController, ContentController],
  providers: [ContentService, GenerationService],
  exports: [ContentService],
  imports: [JobsModule],
})
export class ContentModule {}
