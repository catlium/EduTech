import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Database } from '@catlium/database';
import { chapters, syllabi, subjects, topics } from '@catlium/database';
import {
  SyllabusContextSchema,
  SyllabusStructureSchema,
  type SyllabusContext,
  type SyllabusStructure,
} from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import { STORAGE_PROVIDER } from '../materials/storage/storage-provider.interface.js';
import type { StorageProvider } from '../materials/storage/storage-provider.interface.js';

type DbTx = Parameters<Parameters<Database['transaction']>[0]>[0];

const OPERATION = 'AI_ANALYZE_SYLLABUS';

export const SyllabusValidator = {
  parseStructure(structure: unknown): SyllabusStructure {
    try {
      return SyllabusStructureSchema.parse(structure);
    } catch {
      throw new BadRequestException('Invalid syllabus structure');
    }
  },

  parseContext(context: unknown): SyllabusContext {
    try {
      return SyllabusContextSchema.parse(context);
    } catch {
      throw new BadRequestException('Invalid syllabus context');
    }
  },
};

@Injectable()
export class SyllabusService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ── Create ────────────────────────────────

  async createTextSyllabus(instituteId: string, userId: string, input: CreateTextSyllabusInput) {
    await this.assertSubject(instituteId, input.subjectId);
    const version = await this.nextVersion(input.subjectId);

    const [row] = await this.db
      .insert(syllabi)
      .values({
        instituteId,
        subjectId: input.subjectId,
        version,
        title: input.title,
        program: input.program ?? null,
        academicYear: input.academicYear ?? null,
        sourceType: 'TEXT',
        textContent: input.text,
        processingStatus: 'READY',
        status: 'PROPOSED',
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    return this.toSyllabus(row!);
  }

  async createFileSyllabus(
    instituteId: string,
    userId: string,
    input: CreateFileSyllabusInput,
    file: Express.Multer.File,
  ) {
    await this.assertSubject(instituteId, input.subjectId);
    const version = await this.nextVersion(input.subjectId);

    const syllabusId = randomUUID();
    const extension = this.extensionFromName(file.originalname);
    const storageKey = `syllabi/${instituteId}/${syllabusId}/${randomUUID()}${extension ? `.${extension}` : ''}`;

    await this.storage.save({ key: storageKey, data: file.buffer });

    try {
      const [row] = await this.db
        .insert(syllabi)
        .values({
          id: syllabusId,
          instituteId,
          subjectId: input.subjectId,
          version,
          title: input.title,
          program: input.program ?? null,
          academicYear: input.academicYear ?? null,
          sourceType: 'UPLOAD',
          fileName: basename(file.originalname).slice(0, 255),
          mimeType: file.mimetype,
          fileSize: file.size,
          storageProvider: 'local',
          storageKey,
          processingStatus: 'UPLOADED',
          status: 'PROPOSED',
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      return this.toSyllabus(row!);
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  // ── Read ──────────────────────────────────

  /** Latest version per subject. */
  async listSyllabi(instituteId: string, subjectId?: string) {
    const rows = await this.db
      .select()
      .from(syllabi)
      .where(
        subjectId
          ? and(eq(syllabi.instituteId, instituteId), eq(syllabi.subjectId, subjectId))
          : eq(syllabi.instituteId, instituteId),
      )
      .orderBy(desc(syllabi.createdAt));

    const latestBySubject = new Map<string, (typeof rows)[number]>();
    const subjectNames = new Map<string, string>();
    for (const row of rows) {
      if (!latestBySubject.has(row.subjectId)) {
        latestBySubject.set(row.subjectId, row);
      }
    }

    const subjectIds = [...latestBySubject.keys()];
    if (subjectIds.length) {
      const subj = await this.db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(inArray(subjects.id, subjectIds));
      for (const s of subj) subjectNames.set(s.id, s.name);
    }

    return [...latestBySubject.values()].map((row) => ({
      ...this.toSyllabus(row),
      subjectName: subjectNames.get(row.subjectId) ?? null,
    }));
  }

  async getSyllabus(instituteId: string, syllabusId: string) {
    const row = await this.getSyllabusRow(instituteId, syllabusId);
    const [subj] = await this.db
      .select({ name: subjects.name })
      .from(subjects)
      .where(eq(subjects.id, row.subjectId))
      .limit(1);
    return { ...this.toSyllabus(row), subjectName: subj?.name ?? null };
  }

  async getVersions(instituteId: string, syllabusId: string) {
    const row = await this.getSyllabusRow(instituteId, syllabusId);
    const rows = await this.db
      .select()
      .from(syllabi)
      .where(and(eq(syllabi.subjectId, row.subjectId), eq(syllabi.instituteId, instituteId)))
      .orderBy(desc(syllabi.version));

    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      status: row.status,
      processingStatus: row.processingStatus,
      analysisStatus: row.analysisStatus,
      isCurrent: row.version === rows[0]?.version,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ── Update ────────────────────────────────

  async updateSyllabus(
    instituteId: string,
    userId: string,
    syllabusId: string,
    input: UpdateSyllabusInput,
  ) {
    const row = await this.getSyllabusRow(instituteId, syllabusId);
    this.assertUnconfirmed(row, 'Syllabus');

    if (row.processingStatus === 'PROCESSING' || row.analysisStatus === 'PROCESSING') {
      throw new ConflictException(
        'Syllabus is being processed — edits are unavailable while a job runs',
      );
    }

    const updates: Record<string, unknown> = {
      updatedBy: userId,
      updatedAt: new Date(),
    };
    if (input.title !== undefined) updates['title'] = input.title;
    if (input.program !== undefined) updates['program'] = input.program;
    if (input.academicYear !== undefined) updates['academicYear'] = input.academicYear;
    if (input.context !== undefined) updates['context'] = this.parseContext(input.context);
    if (input.structure !== undefined) updates['structure'] = this.parseStructure(input.structure);

    const [updated] = await this.db
      .update(syllabi)
      .set(updates)
      .where(and(eq(syllabi.id, syllabusId), eq(syllabi.instituteId, instituteId)))
      .returning();
    return this.toSyllabus(updated!);
  }

  // ── Processing (OCR text extraction) ──────

  /** Enqueue the OCR extraction of an uploaded syllabus document. */
  async processSyllabus(instituteId: string, syllabusId: string) {
    return this.enqueueProcessing(instituteId, syllabusId, 'process');
  }

  async retryProcessing(instituteId: string, syllabusId: string) {
    return this.enqueueProcessing(instituteId, syllabusId, 'retry');
  }

  private async enqueueProcessing(
    instituteId: string,
    syllabusId: string,
    action: 'process' | 'retry',
  ) {
    let was: string | null = null;
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(syllabi)
        .where(and(eq(syllabi.id, syllabusId), eq(syllabi.instituteId, instituteId)))
        .for('update')
        .limit(1);
      if (!locked) throw new NotFoundException('Syllabus not found');

      was = locked.processingStatus;
      const verb = action === 'retry' ? 'retried' : 'processed';

      if (locked.status === 'ARCHIVED') {
        throw new ConflictException(`Archived syllabi cannot be ${verb}`);
      }
      if (locked.sourceType !== 'UPLOAD') {
        throw new ConflictException('Only uploaded syllabus documents need processing');
      }
      if (locked.processingStatus === 'PROCESSING') {
        throw new ConflictException('Syllabus is already being processed');
      }
      if (locked.processingStatus === 'QUEUED' && action !== 'retry') {
        throw new ConflictException('Syllabus is already queued for processing');
      }

      if (action === 'retry') {
        if (!['FAILED', 'QUEUED'].includes(locked.processingStatus)) {
          throw new ConflictException(
            `Only failed or interrupted syllabi can be retried (current: ${locked.processingStatus})`,
          );
        }
      } else if (locked.processingStatus !== 'UPLOADED') {
        throw new ConflictException(
          `Syllabus cannot be processed from state ${locked.processingStatus}`,
        );
      }

      const live = await this.jobs.latestSyllabusJob(instituteId, syllabusId);
      if (live && ['queued', 'processing'].includes(live.status)) {
        throw new ConflictException('A processing job for this syllabus is already active');
      }

      await tx
        .update(syllabi)
        .set({ processingStatus: 'QUEUED', analysisStatus: 'PENDING', updatedAt: new Date() })
        .where(eq(syllabi.id, syllabusId));
    });

    let job = await this.jobs.insertJob(instituteId, 'PROCESS_SYLLABUS', { syllabusId });
    try {
      await this.jobs.publishJob(job);
    } catch (error) {
      if (was !== null) {
        await this.db
          .update(syllabi)
          .set({ processingStatus: was, updatedAt: new Date() })
          .where(and(eq(syllabi.id, syllabusId), eq(syllabi.processingStatus, 'QUEUED')));
      }
      throw error;
    }

    return {
      syllabusId,
      jobId: job.id,
      processingStatus: 'QUEUED',
    } as const;
  }

  // ── Deep analysis ─────────────────────────

  async analyzeSyllabus(instituteId: string, userId: string, syllabusId: string) {
    const row = await this.getSyllabusRow(instituteId, syllabusId);
    this.assertUnconfirmed(row, 'Syllabus');

    if (row.status === 'ARCHIVED') {
      throw new ConflictException('Archived syllabi cannot be analyzed');
    }
    if (row.processingStatus !== 'READY') {
      throw new ConflictException('Syllabus text is not READY — process the document first');
    }
    if (!(row.textContent ?? '').trim()) {
      throw new ConflictException('Syllabus has no extracted text to analyze');
    }
    if (row.analysisStatus === 'PROCESSING') {
      throw new ConflictException('Syllabus analysis is already in progress');
    }
    if (row.analysisStatus === 'READY') {
      throw new ConflictException(
        'Syllabus is already analyzed — create a new version to analyze again',
      );
    }

    const payload = {
      operation: OPERATION,
      source: { type: 'SYLLABUS', id: syllabusId },
      syllabusId,
      requestedBy: userId,
    };

    let job;
    try {
      job = await this.jobs.insertJob(instituteId, OPERATION, payload);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Syllabus analysis is already in progress for this syllabus');
      }
      throw error;
    }

    await this.markAnalysisInProgress(syllabusId, userId, job.id);

    try {
      await this.jobs.publishJob(job);
    } catch (error) {
      await this.db
        .update(syllabi)
        .set({
          analysisStatus: 'FAILED',
          analysisError: 'Failed to enqueue the analysis job',
          updatedAt: new Date(),
        })
        .where(eq(syllabi.id, syllabusId));
      throw error;
    }

    return { jobId: job.id, operation: OPERATION, status: 'QUEUED' } as const;
  }

  // ── Confirm (reconciliation-aware) ────────

  async confirmSyllabus(instituteId: string, userId: string, syllabusId: string) {
    const row = await this.getSyllabusRow(instituteId, syllabusId);
    this.assertUnconfirmed(row, 'Syllabus');
    if (row.status === 'ARCHIVED') {
      throw new ConflictException('Archived syllabi cannot be confirmed');
    }
    if (row.analysisStatus !== 'READY' || !row.structure) {
      throw new ConflictException('Syllabus has no analyzed structure to confirm yet');
    }

    let report = {} as ConfirmReport;

    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(syllabi)
        .where(eq(syllabi.id, syllabusId))
        .for('update')
        .limit(1);
      if (!locked) throw new NotFoundException('Syllabus not found');
      this.assertUnconfirmed(locked, 'Syllabus');

      const structure = this.parseStructure(locked.structure);
      report = await this.applyStructure(tx, locked, structure, userId);
    });

    const [updated] = await this.db
      .select()
      .from(syllabi)
      .where(eq(syllabi.id, syllabusId))
      .limit(1);

    return { syllabus: this.toSyllabus(updated!), report };
  }

  /**
   * Apply the analyzed structure to the real academic hierarchy, reconciling
   * against whatever another syllabus version already created for this
   * subject:
   *   - exact normalized-name match   → reuse (identity preserved)
   *   - single >60% token-overlap     → reuse as a rename (identity preserved)
   *   - multiple/ambiguous candidates → create new + flag uncertain (never a
   *     silent merge)
   *   - existing items not in the new structure → archived (never deleted;
   *     resources attached to them keep working)
   * Chapters/topics are created with `status='active'` so the generic
   * academic lists (filtered to active) expose the structure the confirmation
   * decided on.
   */
  private async applyStructure(
    tx: DbTx,
    syllabusRow: typeof syllabi.$inferSelect,
    structure: SyllabusStructure,
    userId: string,
  ): Promise<ConfirmReport> {
    const existingChapters: (typeof chapters.$inferSelect)[] = await tx
      .select()
      .from(chapters)
      .where(and(eq(chapters.subjectId, syllabusRow.subjectId), eq(chapters.status, 'active')));

    const existingTopics: (typeof topics.$inferSelect)[] = existingChapters.length
      ? await tx
          .select()
          .from(topics)
          .where(
            inArray(
              topics.chapterId,
              existingChapters.map((c) => c.id),
            ),
          )
      : [];

    const chapterTopics = new Map<string, typeof existingTopics>();
    for (const topic of existingTopics) {
      const list = chapterTopics.get(topic.chapterId) ?? [];
      list.push(topic);
      chapterTopics.set(topic.chapterId, list);
    }

    const report: ConfirmReport = {
      createdChapters: [],
      reusedChapters: [],
      createdTopics: [],
      reusedTopics: [],
      removedChapters: [],
      removedTopics: [],
      uncertain: [],
    };

    const usedChapterIds = new Set<string>();
    let chapterSort = 0;
    for (const chapter of structure.chapters) {
      const match = this.matchChapter(chapter.name, existingChapters, usedChapterIds);
      let chapterId: string;
      if (match?.chapter) {
        chapterId = match.chapter.id;
        report.reusedChapters.push(chapterId);
        await tx
          .update(chapters)
          .set({
            name: chapter.name,
            description: chapter.description ?? null,
            sortOrder: chapterSort,
            updatedAt: new Date(),
          })
          .where(eq(chapters.id, chapterId));
        if (match.uncertain.length) report.uncertain.push(...match.uncertain);
      } else {
        const [created] = await tx
          .insert(chapters)
          .values({
            subjectId: syllabusRow.subjectId,
            name: chapter.name,
            slug: this.uniqueSlug(
              this.slugify(chapter.name),
              new Set(existingChapters.map((c) => c.slug)),
            ),
            description: chapter.description ?? null,
            sortOrder: chapterSort,
            status: 'active',
          })
          .returning();
        chapterId = created!.id;
        report.createdChapters.push(chapterId);
      }

      const activeChapterTopics = (chapterTopics.get(chapterId) ?? []).filter(
        (t) => t.status === 'active',
      );
      const usedTopicIds = new Set<string>();
      let topicSort = 0;
      for (const topic of chapter.topics) {
        const topicMatch = this.matchTopic(topic.name, activeChapterTopics, usedTopicIds);
        if (topicMatch?.topic) {
          usedTopicIds.add(topicMatch.topic.id);
          report.reusedTopics.push(topicMatch.topic.id);
          await tx
            .update(topics)
            .set({
              name: topic.name,
              description: topic.description ?? null,
              sortOrder: topicSort,
              updatedAt: new Date(),
            })
            .where(eq(topics.id, topicMatch.topic.id));
          if (topicMatch.uncertain.length) report.uncertain.push(...topicMatch.uncertain);
        } else {
          const [created] = await tx
            .insert(topics)
            .values({
              chapterId,
              name: topic.name,
              slug: this.uniqueSlug(
                this.slugify(topic.name),
                new Set(activeChapterTopics.map((t) => t.slug)),
              ),
              description: topic.description ?? null,
              sortOrder: topicSort,
              status: 'active',
            })
            .returning();
          usedTopicIds.add(created!.id);
          report.createdTopics.push(created!.id);
        }
        topicSort += 1;
      }

      const removedTopics = activeChapterTopics.filter((t) => !usedTopicIds.has(t.id));
      if (removedTopics.length) {
        await tx
          .update(topics)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(
            inArray(
              topics.id,
              removedTopics.map((t) => t.id),
            ),
          );
        report.removedTopics.push(...removedTopics.map((t) => t.id));
      }

      chapterSort += 1;
    }

    const removedChapters = existingChapters.filter((c) => !usedChapterIds.has(c.id));
    if (removedChapters.length) {
      await tx
        .update(chapters)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(
          inArray(
            chapters.id,
            removedChapters.map((c) => c.id),
          ),
        );
      report.removedChapters.push(...removedChapters.map((c) => c.id));
    }

    await tx
      .update(syllabi)
      .set({
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(syllabi.id, syllabusRow.id));

    return report;
  }

  // ── Archive / Delete ──────────────────────

  async archiveSyllabus(instituteId: string, userId: string, syllabusId: string) {
    const row = await this.getSyllabusRow(instituteId, syllabusId);
    if (row.status === 'CONFIRMED') {
      throw new ConflictException(
        'Confirmed syllabi are immutable history — they cannot be archived',
      );
    }
    if (row.status === 'ARCHIVED') {
      throw new ConflictException('Syllabus is already archived');
    }

    const [updated] = await this.db
      .update(syllabi)
      .set({ status: 'ARCHIVED', updatedBy: userId, updatedAt: new Date() })
      .where(eq(syllabi.id, syllabusId))
      .returning();

    return this.toSyllabus(updated!);
  }

  async deleteSyllabus(instituteId: string, syllabusId: string) {
    const row = await this.getSyllabusRow(instituteId, syllabusId);
    if (row.status === 'CONFIRMED') {
      throw new ConflictException(
        'Confirmed syllabi are immutable history — they cannot be deleted',
      );
    }
    if (row.status === 'ARCHIVED') {
      throw new ConflictException('Archived syllabi must be restored before deletion');
    }
    if (row.processingStatus === 'PROCESSING' || row.analysisStatus === 'PROCESSING') {
      throw new ConflictException('A job is still running for this syllabus');
    }

    if (row.storageKey) {
      try {
        await this.storage.delete(row.storageKey);
      } catch {
        // best-effort; DB deletion is the source of truth
      }
    }

    await this.db.delete(syllabi).where(eq(syllabi.id, syllabusId));
    return { deleted: true };
  }

  // ── Helpers ───────────────────────────────

  private async assertSubject(instituteId: string, subjectId: string) {
    const [subject] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!subject) throw new NotFoundException('Subject not found');
  }

  private async getSyllabusRow(instituteId: string, syllabusId: string) {
    const [row] = await this.db
      .select()
      .from(syllabi)
      .where(and(eq(syllabi.id, syllabusId), eq(syllabi.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Syllabus not found');
    return row;
  }

  private async nextVersion(subjectId: string) {
    const [latest] = await this.db
      .select({ version: syllabi.version })
      .from(syllabi)
      .where(eq(syllabi.subjectId, subjectId))
      .orderBy(desc(syllabi.version))
      .limit(1);
    return (latest?.version ?? 0) + 1;
  }

  private async markAnalysisInProgress(syllabusId: string, userId: string, jobId: string) {
    await this.db
      .update(syllabi)
      .set({
        analysisStatus: 'PROCESSING',
        analysisJobId: jobId,
        analysisError: null,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(syllabi.id, syllabusId));
  }

  private assertUnconfirmed(row: { status: string }, what: string) {
    if (row.status === 'CONFIRMED') {
      throw new ConflictException(`${what} is already confirmed`);
    }
  }

  private matchChapter(
    name: string,
    candidates: (typeof chapters.$inferSelect)[],
    usedIds: Set<string>,
  ) {
    const available = candidates.filter((c) => !usedIds.has(c.id));
    const exact = available.find((c) => this.normalizedKey(name) === this.normalizedKey(c.name));
    if (exact) return { chapter: exact, uncertain: [] };

    const scored = available
      .map((c) => ({ chapter: c, score: this.tokensOverlap(name, c.name) }))
      .filter((m) => m.score >= 0.6)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) return { chapter: scored[0].chapter, uncertain: [] };
    if (scored.length > 1) {
      return { chapter: null, uncertain: [name] };
    }
    return { chapter: null, uncertain: [] };
  }

  private matchTopic(
    name: string,
    candidates: (typeof topics.$inferSelect)[],
    usedIds: Set<string>,
  ) {
    const available = candidates.filter((t) => !usedIds.has(t.id));
    const exact = available.find((t) => this.normalizedKey(name) === this.normalizedKey(t.name));
    if (exact) return { topic: exact, uncertain: [] };

    const scored = available
      .map((t) => ({ topic: t, score: this.tokensOverlap(name, t.name) }))
      .filter((m) => m.score >= 0.6)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) return { topic: scored[0].topic, uncertain: [] };
    if (scored.length > 1) {
      return { topic: null, uncertain: [name] };
    }
    return { topic: null, uncertain: [] };
  }

  private normalizedKey(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private tokensOverlap(a: string, b: string) {
    const ta = new Set(this.normalizedKey(a).split(' ').filter(Boolean));
    const tb = this.normalizedKey(b).split(' ').filter(Boolean);
    if (!ta.size || !tb.length) return 0;
    const inter = tb.filter((t) => ta.has(t)).length;
    return (2 * inter) / (ta.size + tb.length);
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

  private extensionFromName(name: string): string | null {
    const index = name.lastIndexOf('.');
    if (index === -1 || index === name.length - 1) return null;
    return name.slice(index + 1).toLowerCase();
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private parseStructure(structure: unknown): SyllabusStructure {
    return SyllabusValidator.parseStructure(structure);
  }

  private parseContext(context: unknown): SyllabusContext {
    return SyllabusValidator.parseContext(context);
  }

  private toSyllabus(row: typeof syllabi.$inferSelect) {
    return {
      id: row.id,
      instituteId: row.instituteId,
      subjectId: row.subjectId,
      version: row.version,
      title: row.title,
      program: row.program ?? null,
      academicYear: row.academicYear ?? null,
      sourceType: row.sourceType as 'UPLOAD' | 'TEXT' | 'IMPORTED',
      fileName: row.fileName ?? null,
      mimeType: row.mimeType ?? null,
      fileSize: row.fileSize ?? null,
      textContent: row.textContent ?? null,
      processingStatus: row.processingStatus,
      processingJobId: row.processingJobId ?? null,
      processingError: row.processingError ?? null,
      analysisStatus: row.analysisStatus,
      analysisJobId: row.analysisJobId ?? null,
      analysisError: row.analysisError ?? null,
      context: row.context as SyllabusContext | null,
      structure: row.structure as SyllabusStructure | null,
      status: row.status,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

interface CreateTextSyllabusInput {
  subjectId: string;
  title: string;
  program?: string | null;
  academicYear?: string | null;
  text: string;
}

interface CreateFileSyllabusInput {
  subjectId: string;
  title: string;
  program?: string | null;
  academicYear?: string | null;
}

interface UpdateSyllabusInput {
  title?: string;
  program?: string | null;
  academicYear?: string | null;
  context?: Record<string, unknown> | null;
  structure?: Record<string, unknown> | null;
}

export interface ConfirmReport {
  createdChapters: string[];
  reusedChapters: string[];
  createdTopics: string[];
  reusedTopics: string[];
  removedChapters: string[];
  removedTopics: string[];
  uncertain: string[];
}
