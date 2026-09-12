import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { materials, topics, chapters, subjects, contentItems, contentVersions } from '@catlium/database';
import type { Database } from '@catlium/database';
import type { GenerateContentResponse, GenerateContentPackageResponse, GenerationOperation, ContentGenerationStatus } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';

const CONTENT_PACKAGE_OPERATION = 'AI_GENERATE_CONTENT_PACKAGE' as const;
const AI_CONTENT_TYPES = [
  'NOTE',
  'SUMMARY',
  'FLASHCARD_SET',
  'IMPORTANT_CONCEPTS',
  'CORNELL_NOTE',
] as const;

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

  async requestPackageGeneration(
    instituteId: string,
    userId: string,
    sourceType: 'MATERIAL' | 'TOPIC',
    sourceId: string,
    includeTypes?: string[],
  ): Promise<GenerateContentPackageResponse> {
    if (sourceType === 'MATERIAL') {
      await this.assertGeneratableMaterial(instituteId, sourceId);
    } else {
      await this.assertTopicInInstitute(instituteId, sourceId);
    }

    const payload: Record<string, unknown> = {
      operation: CONTENT_PACKAGE_OPERATION,
      source: { type: sourceType, id: sourceId },
      requestedBy: userId,
    };
    if (includeTypes && includeTypes.length > 0) {
      payload.params = { types: includeTypes };
    }

    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, CONTENT_PACKAGE_OPERATION, payload);
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
      operation: CONTENT_PACKAGE_OPERATION,
      sourceType,
      sourceId,
      status: 'QUEUED',
    };
  }

  async getContentGenerationStatus(
    instituteId: string,
    materialId: string,
  ): Promise<ContentGenerationStatus[]> {
    const [material] = await this.db
      .select({ id: materials.id, updatedAt: materials.updatedAt })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .limit(1);

    if (!material) throw new NotFoundException('Material not found');

    const rows = await this.db
      .select({
        type: contentItems.type,
        contentId: contentItems.id,
        version: contentItems.currentVersion,
        generatedAt: contentVersions.createdAt,
        model: sql<string | null>`(${contentVersions.aiContext} ->> 'model')`,
      })
      .from(contentItems)
      .innerJoin(
        contentVersions,
        and(
          eq(contentItems.id, contentVersions.contentId),
          eq(contentItems.currentVersion, contentVersions.version),
        ),
      )
      .where(
        and(
          eq(contentItems.instituteId, instituteId),
          eq(contentItems.source, 'AI_GENERATED'),
          sql`${contentVersions.sourceReference} ->> 'id' = ${materialId}`,
          sql`${contentItems.type} IN (${sql.join(
            AI_CONTENT_TYPES.map((t) => sql`${t}`),
            sql`, `,
          )})`,
        ),
      )
      .orderBy(contentItems.type, desc(contentVersions.version));

    const materialUpdatedAt = material.updatedAt;

    const items: ContentGenerationStatus[] = AI_CONTENT_TYPES.map((type) => {
      const row = rows.find((r) => r.type === type);
      if (!row) {
        return { type, state: 'not_generated', contentId: null, version: null, generatedAt: null };
      }
      const isStale = materialUpdatedAt && row.generatedAt && materialUpdatedAt > row.generatedAt;
      return {
        type,
        state: isStale ? 'stale' : 'generated',
        contentId: row.contentId,
        version: row.version,
        generatedAt: row.generatedAt?.toISOString() ?? null,
      };
    });

    return items;
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
