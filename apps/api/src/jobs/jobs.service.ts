import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { jobs, materials, topics, chapters, subjects, syllabi } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { RabbitMQService } from '../common/services/rabbitmq.service.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';

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

export interface JobListItem {
  id: string;
  type: string;
  status: string;
  error: string | null;
  sourceType: string | null;
  sourceId: string | null;
  batchId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// Job-type → queue routing. Jobs without an explicit mapping default to the
// generic `jobs` queue consumed by the material-processing worker. AI jobs are
// routed to a dedicated queue so the AI worker can run (and scale) independently.
const JOB_QUEUE_BY_TYPE: Record<string, string> = {
  AI_GENERATE_NOTE: 'ai_generation',
  AI_GENERATE_SUMMARY: 'ai_generation',
  AI_GENERATE_FLASHCARDS: 'ai_generation',
  AI_GENERATE_CONCEPTS: 'ai_generation',
  AI_GENERATE_CONTENT_PACKAGE: 'ai_generation',
  AI_GENERATE_QUESTIONS: 'ai_generation',
  AI_GENERATE_BLUEPRINT: 'ai_generation',
  AI_GENERATE_STARTER_MATERIAL: 'ai_generation',
  AI_ANALYZE_SYLLABUS: 'ai_generation',
};

// Types the generic `POST /jobs` endpoint accepts. Anything else is rejected
// up front instead of being consumed (acked) and never progressed by a worker.
export const ALLOWED_JOB_TYPES = ['MATERIAL_PROCESS', 'MATERIAL_ENHANCE', ...Object.keys(JOB_QUEUE_BY_TYPE)] as const;

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
    return this.issueJob(instituteId, type, payload);
  }

  /** Insert a job row and publish it. If publishing fails the row is marked
   * ``failed`` (never left silently ``queued``) and the error is rethrown so
   * the caller surfaces a coherent failure instead of an orphaned job. */
  async issueJob(
    instituteId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<Job> {
    const job = await this.insertJob(instituteId, type, payload);
    try {
      await this.publishJob(job);
    } catch (error) {
      await this.updateJobStatus(job.id, 'failed', undefined, {
        message: 'Failed to enqueue job',
      });
      throw error;
    }
    return job;
  }

  async insertJob(
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

    return this.toJob(job!);
  }

  async publishJob(job: Job): Promise<void> {
    // OCR and enhancement are coordinator-owned: MATERIAL_PROCESS and
    // MATERIAL_ENHANCE are never published to RabbitMQ (no consumer in the
    // distributed design). Their sweeps adopt queued jobs instead.
    if (job.type === 'MATERIAL_PROCESS' || job.type === 'MATERIAL_ENHANCE') return;
    const queue = JOB_QUEUE_BY_TYPE[job.type] ?? 'jobs';
    await this.rabbitmq.publish(queue, {
      jobId: job.id,
      instituteId: job.instituteId,
      type: job.type,
      payload: job.payload ?? undefined,
    });
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

  /** Most recent MATERIAL_PROCESS job for a material, or null when none exists. */
  async latestMaterialJob(instituteId: string, materialId: string): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.instituteId, instituteId),
          eq(jobs.type, 'MATERIAL_PROCESS'),
          sql`${jobs.payload}->>'materialId' = ${materialId}`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return row ? this.toJob(row) : null;
  }

  /** Most recent job (processing or analysis) for a syllabus, or null. */
  async latestSyllabusJob(instituteId: string, syllabusId: string): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.instituteId, instituteId),
          inArray(jobs.type, ['PROCESS_SYLLABUS', 'AI_ANALYZE_SYLLABUS']),
          sql`${jobs.payload}->>'syllabusId' = ${syllabusId}`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return row ? this.toJob(row) : null;
  }

  /** True when an active blueprint-analysis job references this paper pattern. */
  async hasActivePatternJob(instituteId: string, patternId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.instituteId, instituteId),
          eq(jobs.type, 'AI_GENERATE_BLUEPRINT'),
          inArray(jobs.status, ['queued', 'processing', 'cancelling']),
          sql`${jobs.payload}->>'patternId' = ${patternId}`,
        ),
      )
      .limit(1);
    return row !== undefined;
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

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
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

  /**
   * Cancel a job. Honest cancellation only:
   * - queued → cancelled (never started)
   * - processing → cancelling (the worker settles it to cancelled at the next
   *   chunk or persist boundary; it never becomes failed, and nothing is
   *   persisted after cancellation)
   * - completed/failed/cancelled → no-op, current state returned
   * Completed derived resources are never deleted by cancellation.
   */
  async cancelJob(jobId: string, instituteId: string): Promise<Job> {
    const job = await this.getJob(jobId, instituteId);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
    const nextStatus = job.status === 'queued' ? 'cancelled' : 'cancelling';
    await this.updateJobStatus(job.id, nextStatus);
    return { ...job, status: nextStatus };
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

  // ── Job monitor ─────────────────────────────────────────────────

  /** Bulk human labels for payload references (topics/materials/chapters/
   * subjects and syllabi). Scoped to the institute via joins. */
  private async resolveLabels(
    instituteId: string,
    rows: (typeof jobs.$inferSelect)[],
  ): Promise<Record<string, Record<string, string>>> {
    const byType = new Map<string, Set<string>>();
    const collect = (type: string | undefined, id: string | undefined) => {
      if (!type || !id) return;
      if (!byType.has(type)) byType.set(type, new Set());
      byType.get(type)!.add(id);
    };
    for (const job of rows) {
      const payload = job.payload as Record<string, unknown> | null;
      if (!payload) continue;
      const source =
        typeof payload.source === 'object' && payload.source !== null
          ? (payload.source as { type?: string; id?: string })
          : null;
      collect(source?.type, source?.id);
      const batchSource =
        typeof payload.batchSource === 'object' && payload.batchSource !== null
          ? (payload.batchSource as { type?: string; id?: string })
          : null;
      collect(batchSource?.type, batchSource?.id);
      collect(
        'materialId',
        typeof payload.materialId === 'string' ? payload.materialId : undefined,
      );
      collect(
        'syllabusId',
        typeof payload.syllabusId === 'string' ? payload.syllabusId : undefined,
      );
    }

    const labels: Record<string, Record<string, string>> = {};
    for (const [kind, idSet] of byType) {
      const ids = [...idSet];
      let nameRows: Array<{ id: string; name: string }> = [];
      switch (kind) {
        case 'MATERIAL':
        case 'materialId':
          nameRows = await this.db
            .select({ id: materials.id, name: materials.title })
            .from(materials)
            .where(and(eq(materials.instituteId, instituteId), inArray(materials.id, ids)));
          break;
        case 'TOPIC':
          nameRows = await this.db
            .select({ id: topics.id, name: topics.name })
            .from(topics)
            .innerJoin(chapters, eq(topics.chapterId, chapters.id))
            .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
            .where(and(eq(subjects.instituteId, instituteId), inArray(topics.id, ids)));
          break;
        case 'CHAPTER':
          nameRows = await this.db
            .select({ id: chapters.id, name: chapters.name })
            .from(chapters)
            .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
            .where(and(eq(subjects.instituteId, instituteId), inArray(chapters.id, ids)));
          break;
        case 'SUBJECT':
          nameRows = await this.db
            .select({ id: subjects.id, name: subjects.name })
            .from(subjects)
            .where(and(eq(subjects.instituteId, instituteId), inArray(subjects.id, ids)));
          break;
        case 'syllabusId':
          nameRows = await this.db
            .select({ id: syllabi.id, name: subjects.name })
            .from(syllabi)
            .innerJoin(subjects, eq(syllabi.subjectId, subjects.id))
            .where(and(eq(syllabi.instituteId, instituteId), inArray(syllabi.id, ids)));
          break;
        default:
          continue;
      }
      labels[kind] = Object.fromEntries(nameRows.map((r) => [r.id, r.name]));
    }
    return labels;
  }

  /** Re-enqueue a failed/cancelled job with its original payload. */
  async retryJob(jobId: string, instituteId: string): Promise<Job> {
    const job = await this.getJob(jobId, instituteId);
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      throw new ConflictException('Only failed or cancelled jobs can be retried');
    }
    try {
      await this.updateJobStatus(job.id, 'queued');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A generation is already in progress for this source');
      }
      throw error;
    }
    try {
      await this.publishJob({ ...job, status: 'queued' });
    } catch {
      await this.updateJobStatus(job.id, 'failed', undefined, {
        message: 'Failed to re-enqueue job',
      });
      throw new ConflictException('Failed to re-enqueue job');
    }
    return this.getJob(job.id, instituteId);
  }

  async listJobs(
    instituteId: string,
    filters: {
      status?: string;
      type?: string;
      batchId?: string;
      sourceType?: string;
    },
    limit: number,
    offset: number,
  ): Promise<{
    jobs: JobListItem[];
    labels: Record<string, Record<string, string>>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const conditions = [eq(jobs.instituteId, instituteId)];
    if (filters.status) conditions.push(eq(jobs.status, filters.status.toLowerCase()));
    if (filters.type) conditions.push(eq(jobs.type, filters.type.toUpperCase()));
    if (filters.batchId) conditions.push(sql`${jobs.payload}->>'batchId' = ${filters.batchId}`);
    if (filters.sourceType) {
      conditions.push(
        sql`${jobs.payload}->'source'->>'type' = ${filters.sourceType.toUpperCase()}`,
      );
    }
    const where = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(jobs)
        .where(where)
        .orderBy(desc(jobs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(where),
    ]);

    return {
      jobs: rows.map((row) => this.toListItem(row)),
      labels: await this.resolveLabels(instituteId, rows),
      total: totalRows[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  private toListItem(job: typeof jobs.$inferSelect): JobListItem {
    const payload = job.payload as Record<string, unknown> | null;
    const source =
      payload && typeof payload.source === 'object' && payload.source !== null
        ? (payload.source as { type?: string; id?: string })
        : null;
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      error:
        job.error && typeof job.error === 'object' && 'message' in job.error
          ? String(job.error.message)
          : null,
      sourceType: source?.type ?? null,
      sourceId: source?.id ?? null,
      batchId: typeof payload?.batchId === 'string' ? payload.batchId : null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }
}
