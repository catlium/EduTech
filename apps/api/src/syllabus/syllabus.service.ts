import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '@catlium/database';
import { chapters, materials, subjects, syllabusProposals, topics } from '@catlium/database';
import { SyllabusStructureSchema, type SyllabusStructure } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';

const OPERATION = 'AI_GENERATE_SYLLABUS';

type ProposalStatus = 'PENDING_REVIEW' | 'CONFIRMED';

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

    const material = await this.resolveMaterial(instituteId, subjectId, materialId);
    if (!material) {
      throw new BadRequestException(
        'No processed syllabus material found for this subject — upload and process one first',
      );
    }

    const payload = {
      operation: OPERATION,
      source: { type: 'MATERIAL', id: material.id },
      subjectId,
      requestedBy: userId,
    };

    const job = await this.jobs.createJob(instituteId, OPERATION, payload);

    return {
      jobId: job.id,
      operation: OPERATION,
      sourceType: 'MATERIAL' as const,
      sourceId: material.id,
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
    this.assertPendingReview(row.status);
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
    this.assertPendingReview(row.status);

    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(syllabusProposals)
        .where(eq(syllabusProposals.id, row.id))
        .for('update')
        .limit(1);
      if (!locked) throw new NotFoundException('Syllabus proposal not found');
      this.assertPendingReview(locked.status);

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

  private async resolveMaterial(
    instituteId: string,
    subjectId: string,
    materialId?: string,
  ) {
    if (materialId) {
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

    const [latest] = await this.db
      .select()
      .from(materials)
      .where(
        and(
          eq(materials.instituteId, instituteId),
          eq(materials.subjectId, subjectId),
          eq(materials.status, 'ACTIVE'),
          eq(materials.processingStatus, 'READY'),
          sql`coalesce(trim(${materials.textContent}), '') <> ''`,
        ),
      )
      .orderBy(desc(materials.createdAt))
      .limit(1);
    return latest ?? null;
  }

  private assertReady(material: typeof materials.$inferSelect): void {
    if (material.status !== 'ACTIVE' || material.processingStatus !== 'READY') {
      throw new BadRequestException('Material is not ready to generate from');
    }
    if (!(material.textContent ?? '').trim()) {
      throw new BadRequestException('Material has no extracted text');
    }
  }

  private assertPendingReview(status: string): void {
    if (status !== 'PENDING_REVIEW') {
      throw new ConflictException('Syllabus is already confirmed');
    }
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
      structure: row.structure as SyllabusStructure,
      sourceMaterialId: row.sourceMaterialId,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}