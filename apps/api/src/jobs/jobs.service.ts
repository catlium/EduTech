import { Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { jobs } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { RabbitMQService } from '../common/services/rabbitmq.service.js';

export interface Job {
  id: string;
  instituteId: string;
  type: string;
  status: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly rabbitmq: RabbitMQService,
  ) {}

  async createJob(
    instituteId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<Job> {
    const [job] = await this.db
      .insert(jobs)
      .values({
        instituteId,
        type,
        status: 'queued',
        payload: payload ?? null,
      })
      .returning();

    await this.rabbitmq.publish('jobs', {
      jobId: job!.id,
      instituteId: job!.instituteId,
      type: job!.type,
      payload: job!.payload,
    });

    return this.toJob(job!);
  }

  async getJob(jobId: string, instituteId: string): Promise<Job> {
    const [job] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.instituteId, instituteId)))
      .limit(1);

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return this.toJob(job);
  }

  async updateJobStatus(
    jobId: string,
    status: string,
    result?: Record<string, unknown>,
    error?: Record<string, unknown>,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    if (status === 'processing') {
      updateData.startedAt = new Date();
    }

    if (status === 'completed' || status === 'failed') {
      updateData.completedAt = new Date();
    }

    if (result !== undefined) {
      updateData.result = result;
    }

    if (error !== undefined) {
      updateData.error = error;
    }

    await this.db.update(jobs).set(updateData).where(eq(jobs.id, jobId));
  }

  private toJob(job: typeof jobs.$inferSelect): Job {
    return {
      id: job.id,
      instituteId: job.instituteId,
      type: job.type,
      status: job.status,
      payload: job.payload as Record<string, unknown> | null,
      result: job.result as Record<string, unknown> | null,
      error: job.error as Record<string, unknown> | null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }
}
