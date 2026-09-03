import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { topics, chapters, subjects } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';

const OPERATION = 'AI_GENERATE_QUESTIONS';

interface GenerateQuestionsInput {
  topicId: string;
  questionType: 'MCQ' | 'TRUE_FALSE' | 'FILL_IN_BLANK';
  count: number;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
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
    await this.assertTopicInInstitute(instituteId, input.topicId);

    const payload = {
      operation: OPERATION,
      source: { type: 'TOPIC', id: input.topicId },
      requestedBy: userId,
      params: {
        questionType: input.questionType,
        count: input.count,
        difficulty: input.difficulty ?? 'MEDIUM',
      },
    };

    const job = await this.jobs.createJob(instituteId, OPERATION, payload);

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
  ): Promise<void> {
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
