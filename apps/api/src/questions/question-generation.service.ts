import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { topics, chapters, subjects, paperPatterns } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';

const OPERATION = 'AI_GENERATE_QUESTIONS';

interface GenerateQuestionsInput {
  topicId: string;
  questionType: 'MCQ' | 'TRUE_FALSE' | 'FILL_IN_BLANK';
  count: number;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  blueprintId?: string;
}

@Injectable()
export class QuestionGenerationService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
  ) {}

  async requestGeneration(
    instituteId: string,
    userId: string,
    input: GenerateQuestionsInput,
  ) {
    const topic = await this.assertTopicInInstitute(instituteId, input.topicId);

    const payload: Record<string, unknown> = {
      operation: OPERATION,
      source: { type: 'TOPIC', id: input.topicId },
      requestedBy: userId,
      params: {
        questionType: input.questionType,
        count: input.count,
        difficulty: input.difficulty ?? 'MEDIUM',
      },
    };

    // Blueprint-constrained generation: the approved pattern's structure is
    // attached to the job so the worker can target it and report satisfaction.
    if (input.blueprintId) {
      const [pattern] = await this.db
        .select()
        .from(paperPatterns)
        .where(
          and(
            eq(paperPatterns.id, input.blueprintId),
            eq(paperPatterns.instituteId, instituteId),
          ),
        )
        .limit(1);
      if (!pattern || pattern.status !== 'APPROVED') {
        throw new BadRequestException(
          'Blueprint must be an approved paper pattern in this institute',
        );
      }
      if (topic.subjectId !== pattern.subjectId) {
        throw new BadRequestException(
          'Blueprint subject must match the generation topic subject',
        );
      }
      payload['params'] = {
        ...(payload['params'] as Record<string, unknown>),
        blueprint: { patternId: pattern.id, structure: pattern.structure },
      };
    }

    // Same partial-unique-index + isUniqueViolation -> 409 pattern as content
    // generation: only one active AI_GENERATE_QUESTIONS job per topic.
    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, OPERATION, payload);
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
      operation: OPERATION,
      sourceType: 'TOPIC',
      sourceId: input.topicId,
      status: 'QUEUED' as const,
    };
  }

  async getGenerationJob(instituteId: string, jobId: string): Promise<Job> {
    const job = await this.jobs.getJob(jobId, instituteId);
    if (job.type !== OPERATION) {
      throw new BadRequestException('This job is not a question-generation job');
    }
    return job;
  }

  private async assertTopicInInstitute(
    instituteId: string,
    topicId: string,
  ): Promise<{ topicId: string; subjectId: string }> {
    const [row] = await this.db
      .select({ topicId: topics.id, subjectId: subjects.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, topicId), eq(subjects.instituteId, instituteId)))
      .limit(1);

    if (!row) throw new NotFoundException('Topic not found');
    return row;
  }
}
