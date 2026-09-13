import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@catlium/database';
import { chapters, materials, subjects, syllabusProposals, topics } from '@catlium/database';
import { SyllabusStructureSchema, type SyllabusStructure } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';

const OPERATION = 'AI_GENERATE_SYLLABUS';

type ProposalStatus = 'PROCESSING' | 'PENDING_REVIEW' | 'CONFIRMED' | 'FAILED';

@Injectable()
export class SyllabusService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
  ) {}

  async generate(
    instituteId: string,
    userId: string,
    subjectId: string,
    materialId?: string,
  ) {
    await this.getSubject(instituteId, subjectId);

    const [confirmed] = await this.db
      .select({ id: syllabusProposals.id })
      .from(syllabusProposals)
      .where(
        and(
          eq(syllabusProposals.subjectId, subjectId),
          eq(syllabusProposals.status, 'CONFIRMED'),
        ),
      )
      .limit(1);
    if (confirmed) {
      throw new ConflictException('Syllabus for this subject is already confirmed');
    }

    // Syllabus generation is subject-based; a Material is only optional
    // enrichment. When supplied it is still subject-validated (never bypassed).
    const material = materialId
      ? await this.resolveMaterial(instituteId, subjectId, materialId)
      : null;

    const payload = {
      operation: OPERATION,
      source: { type: 'SUBJECT', id: subjectId },
      subjectId,
      requestedBy: userId,
      params: material ? { materialId: material.id } : {},
    };

    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, OPERATION, payload);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Syllabus generation is already in progress for this subject',
        );
      }
      throw error;
    }

    await this.setProposalGenerating(instituteId, subjectId, userId, job.id);

    try {
      await this.jobs.publishJob(job);
    } catch (error) {
      await this.failProposalOnEnqueue(job.id);
      throw error;
    }

    return {
      jobId: job.id,
      operation: OPERATION,
      sourceType: 'SUBJECT' as const,
      sourceId: subjectId,
      subjectId,
      status: 'QUEUED' as const,
    };
  }

  async getGenerationJob(instituteId: string, jobId: string): Promise<Job> {
    const job = await this.jobs.getJob(jobId, instituteId);
    if (job.type !== OPERATION) {
      throw new BadRequestException('This job is not a syllabus-generation job');
    }
    return job;
  }

  async getProposal(instituteId: string, subjectId: string) {
    const row = await this.getProposalRow(instituteId, subjectId);
    return this.toSyllabus(row);
  }

  async updateProposal(
    instituteId: string,
    userId: string,
    subjectId: string,
    structure: unknown,
  ) {
    const row = await this.getProposalRow(instituteId, subjectId);
    this.assertEditable(row.status);
    const parsed = this.parseStructure(structure);

    const [updated] = await this.db
      .update(syllabusProposals)
      .set({ structure: parsed, updatedBy: userId, updatedAt: new Date() })
      .where(eq(syllabusProposals.id, row.id))
      .returning();

    return this.toSyllabus(updated!);
  }

  async confirmProposal(instituteId: string, userId: string, subjectId: string) {
    const row = await this.getProposalRow(instituteId, subjectId);
    this.assertEditable(row.status);

    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(syllabusProposals)
        .where(eq(syllabusProposals.id, row.id))
        .for('update')
        .limit(1);
      if (!locked) throw new NotFoundException('Syllabus proposal not found');
      this.assertEditable(locked.status);

      const structure = this.parseStructure(locked.structure);

      const chapterRows = await tx
        .select({ slug: chapters.slug })
        .from(chapters)
        .where(eq(chapters.subjectId, subjectId));
      const usedChapterSlugs = new Set(chapterRows.map((c) => c.slug));

      let chapterSort = 0;
      for (const chapter of structure.chapters) {
        const chapterSlug = this.uniqueSlug(this.slugify(chapter.name), usedChapterSlugs);

        const [created] = await tx
          .insert(chapters)
          .values({
            subjectId,
            name: chapter.name,
            slug: chapterSlug,
            description: chapter.description ?? null,
            sortOrder: chapterSort,
          })
          .returning();
        chapterSort += 1;

        const topicRows = await tx
          .select({ slug: topics.slug })
          .from(topics)
          .where(eq(topics.chapterId, created!.id));
        const usedTopicSlugs = new Set(topicRows.map((t) => t.slug));

        let topicSort = 0;
        for (const topic of chapter.topics) {
          const topicSlug = this.uniqueSlug(this.slugify(topic.name), usedTopicSlugs);
          await tx.insert(topics).values({
            chapterId: created!.id,
            name: topic.name,
            slug: topicSlug,
            description: topic.description ?? null,
            sortOrder: topicSort,
          });
          topicSort += 1;
        }
      }

      await tx
        .update(syllabusProposals)
        .set({
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(syllabusProposals.id, row.id));
    });

    const [updated] = await this.db
      .select()
      .from(syllabusProposals)
      .where(eq(syllabusProposals.id, row.id))
      .limit(1);

    return this.toSyllabus(updated!);
  }

  private parseStructure(structure: unknown): SyllabusStructure {
    try {
      return SyllabusStructureSchema.parse(structure);
    } catch {
      throw new BadRequestException('Invalid syllabus structure');
    }
  }

  private async getSubject(instituteId: string, subjectId: string) {
    const [subject] = await this.db
      .select()
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  private async getProposalRow(instituteId: string, subjectId: string) {
    const [row] = await this.db
      .select()
      .from(syllabusProposals)
      .where(
        and(
          eq(syllabusProposals.subjectId, subjectId),
          eq(syllabusProposals.instituteId, instituteId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('No syllabus proposal yet — generate one first');
    return row;
  }

  /**
   * Optional syllabus enrichment material. Only reached when a `materialId`
   * was supplied by the teacher; the subject-boundary check is never bypassed.
   * No auto-fallback to "the latest material" — a syllabus is generatable from
   * subject context alone.
   */
  private async resolveMaterial(
    instituteId: string,
    subjectId: string,
    materialId: string,
  ) {
    const [material] = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .limit(1);
    if (!material || material.subjectId !== subjectId) {
      throw new BadRequestException('Material not found for this subject');
    }
    this.assertReady(material);
    return material;
  }

  private assertReady(material: typeof materials.$inferSelect): void {
    if (material.status !== 'ACTIVE' || material.processingStatus !== 'READY') {
      throw new BadRequestException('Material is not ready to generate from');
    }
    if (!(material.textContent ?? '').trim()) {
      throw new BadRequestException('Material has no extracted text');
    }
  }

  private assertEditable(status: string): void {
    if (status === 'CONFIRMED') {
      throw new ConflictException('Syllabus is already confirmed');
    }
    if (status === 'PROCESSING') {
      throw new ConflictException('Syllabus is still generating — wait for it to complete');
    }
    if (status === 'FAILED') {
      throw new ConflictException('Syllabus generation failed — regenerate it first');
    }
  }

  /** Mark the proposal PROCESSING so a generation is never a silent ghost. */
  private async setProposalGenerating(
    instituteId: string,
    subjectId: string,
    userId: string,
    jobId: string,
  ): Promise<void> {
    const [existing] = await this.db
      .select({ id: syllabusProposals.id, status: syllabusProposals.status })
      .from(syllabusProposals)
      .where(and(eq(syllabusProposals.subjectId, subjectId), eq(syllabusProposals.instituteId, instituteId)))
      .limit(1);

    if (existing) {
      // Regeneration is blocked up front, but never trust that single check:
      // if a CONFIRMED row slipped through, retire the orphaned job and fail.
      if (existing.status === 'CONFIRMED') {
        await this.jobs.updateJobStatus(jobId, 'failed', undefined, {
          message: 'Syllabus for this subject is already confirmed',
        });
        throw new ConflictException('Syllabus for this subject is already confirmed');
      }
      await this.db
        .update(syllabusProposals)
        .set({
          status: 'PROCESSING',
          generationJobId: jobId,
          generationError: null,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(syllabusProposals.id, existing.id));
      return;
    }

    await this.db.insert(syllabusProposals).values({
      instituteId,
      subjectId,
      status: 'PROCESSING',
      generationJobId: jobId,
      createdBy: userId,
      updatedBy: userId,
    });
  }

  /** Publish failure: the draft will never arrive — say so honestly. */
  private async failProposalOnEnqueue(jobId: string): Promise<void> {
    await this.db
      .update(syllabusProposals)
      .set({
        status: 'FAILED',
        generationError: 'Failed to enqueue the generation job',
        updatedAt: new Date(),
      })
      .where(and(eq(syllabusProposals.generationJobId, jobId), eq(syllabusProposals.status, 'PROCESSING')));
    await this.jobs.updateJobStatus(jobId, 'failed', undefined, {
      message: 'Failed to enqueue the generation job',
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private slugify(name: string): string {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'untitled';
  }

  private uniqueSlug(base: string, used: Set<string>): string {
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);
    return slug;
  }

  private toSyllabus(row: typeof syllabusProposals.$inferSelect) {
    return {
      id: row.id,
      instituteId: row.instituteId,
      subjectId: row.subjectId,
      status: row.status as ProposalStatus,
      structure: row.structure as SyllabusStructure | null,
      sourceMaterialId: row.sourceMaterialId,
      generationJobId: row.generationJobId,
      generationError: row.generationError ?? null,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}