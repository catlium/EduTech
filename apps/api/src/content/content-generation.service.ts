import { Injectable, BadRequestException } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { MaterialsService } from '../materials/materials.service.js';
import { AIGenerateNotePayload } from '@catlium/contracts';

@Injectable()
export class ContentGenerationService {
  constructor(
    private readonly jobsService: JobsService,
    private readonly materialsService: MaterialsService,
  ) {}

  async generateNote(instituteId: string, payload: AIGenerateNotePayload) {
    const material = await this.materialsService.getMaterial(instituteId, payload.materialId);
    
    if (material.processingStatus !== 'READY') {
      throw new BadRequestException('Material must be READY to generate notes');
    }

    const job = await this.jobsService.createJob(instituteId, 'AI_GENERATE_NOTE', {
      materialId: payload.materialId,
      title: payload.title,
    });

    return { jobId: job.id };
  }
}
