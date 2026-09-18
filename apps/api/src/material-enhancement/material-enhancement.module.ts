import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module.js';
import { MaterialEnhancementService } from './enhancement.service.js';
import { MaterialEnhancementController } from './enhancement.controller.js';

@Module({
  imports: [JobsModule],
  controllers: [MaterialEnhancementController],
  providers: [MaterialEnhancementService],
  exports: [MaterialEnhancementService],
})
export class MaterialEnhancementModule {}