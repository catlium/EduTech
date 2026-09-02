import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { materials, topics, chapters, subjects } from '@catlium/database';
import type { Database } from '@catlium/database';
import type { GenerateContentResponse, GenerationOperation } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';

function isUniqueViolation(error: unknown): boolean {
  // Drizzle >=0.44 wraps driver errors in DrizzleQueryError, exposing the
  // original pg DatabaseError via `cause`; older versions throw it directly.
  let current = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class GenerationService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
  ) {}

  async requestGeneration(
    operation: GenerationOperation,
    instituteId: string,
    userId: string,
    sourceType: 'MATERIAL' | 'TOPIC',
    sourceId: string,
  ): Promise<GenerateContentResponse> {
    if (sourceType === 'MATERIAL') {
      await this.assertGeneratableMaterial(instituteId, sourceId);
    } else {
      await this.assertTopicInInstitute(instituteId, sourceId);
    }

    const payload = {
      operation,
      source: { type: sourceType, id: sourceId },
      requestedBy: userId,
    };

    // The partial unique index on jobs (active generation per source + operation)
    // guarantees a single active generation job; a concurrent duplicate
    // insert violates it and maps to a 409, consistent with material processing.
    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, operation, payload);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A generation is already in progress for this source');
      }
      throw error;
    }

    try {
      await this.jobs.publishJob(job);
    } catch {
      await this.jobs.updateJobStatus(job.id, 'failed', undefined, {
        message: 'Failed to enqueue generation job',
      });
      throw new InternalServerErrorException('Failed to enqueue generation job');
    }

    return {
      jobId: job.id,
      operation,
      sourceType,
      sourceId,
      status: 'QUEUED',
    };
  }

  private async assertGeneratableMaterial(instituteId: string, materialId: string): Promise<void> {
    const [material] = await this.db
      .select({
        id: materials.id,
        status: materials.status,
        processingStatus: materials.processingStatus,
        textContent: materials.textContent,
      })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .limit(1);

    if (!material) throw new NotFoundException('Material not found');
    if (material.status !== 'ACTIVE') throw new ConflictException('Material is not active');
    if (material.processingStatus !== 'READY') {
      throw new ConflictException('Material is not ready for generation');
    }
    if (!material.textContent?.trim()) {
      throw new ConflictException('Material has no extracted text');
    }
  }

  private async assertTopicInInstitute(instituteId: string, topicId: string): Promise<void> {
    const [topic] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, topicId), eq(subjects.instituteId, instituteId)))
      .limit(1);

    if (!topic) throw new NotFoundException('Topic not found');
  }
}
