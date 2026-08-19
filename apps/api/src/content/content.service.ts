import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { contentItems, contentVersions, subjects, chapters, topics } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

type ScopeKind = 'subject' | 'chapter' | 'topic';
type ContentType = 'NOTE' | 'FLASHCARD_SET' | 'CORNELL_NOTE';
type ContentSource = 'MANUAL' | 'AI_GENERATED' | 'OCR_EXTRACTED' | 'IMPORTED';
type ContentChangeType = 'CREATION' | 'EDIT' | 'REGENERATION' | 'CORRECTION';
type ContentStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

interface CreateContentInput {
  title: string;
  type: ContentType;
  source: ContentSource;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  payload: Record<string, unknown>;
  renderedHtml?: string;
  aiContext?: Record<string, unknown>;
  sourceReference?: Record<string, unknown>;
  changeReason?: string;
}

interface UpdateContentInput {
  payload: Record<string, unknown>;
  renderedHtml?: string;
  aiContext?: Record<string, unknown>;
  sourceReference?: Record<string, unknown>;
  changeType?: ContentChangeType;
  changeReason?: string;
}

interface ListContentFilters {
  type?: ContentType;
  status?: ContentStatus;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

@Injectable()
export class ContentService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // ── Create ────────────────────────────────

  async createContent(instituteId: string, createdBy: string, input: CreateContentInput) {
    const scope = this.resolveScope(input);

    await this.assertScopeInInstitute(instituteId, scope.kind, scope.id);

    return this.db.transaction(async (tx) => {
      const [item] = await tx
        .insert(contentItems)
        .values({
          instituteId,
          subjectId: scope.kind === 'subject' ? scope.id : null,
          chapterId: scope.kind === 'chapter' ? scope.id : null,
          topicId: scope.kind === 'topic' ? scope.id : null,
          type: input.type,
          title: input.title,
          source: input.source,
          currentVersion: 1,
          createdBy,
          updatedBy: createdBy,
        })
        .returning();

      const [current] = await tx
        .insert(contentVersions)
        .values({
          contentId: item!.id,
          version: 1,
          payload: input.payload,
          renderedHtml: input.renderedHtml,
          aiContext: input.aiContext,
          sourceReference: input.sourceReference,
          changeType: 'CREATION',
          changeReason: input.changeReason,
          createdBy,
        })
        .returning();

      return { item: item!, current: current! };
    });
  }

  // ── Read ──────────────────────────────────

  async listContent(instituteId: string, filters: ListContentFilters) {
    const conditions: SQL[] = [eq(contentItems.instituteId, instituteId)];

    if (filters.type) conditions.push(eq(contentItems.type, filters.type));
    if (filters.status) conditions.push(eq(contentItems.status, filters.status));
    if (filters.subjectId) conditions.push(eq(contentItems.subjectId, filters.subjectId));
    if (filters.chapterId) conditions.push(eq(contentItems.chapterId, filters.chapterId));
    if (filters.topicId) conditions.push(eq(contentItems.topicId, filters.topicId));

    return this.db
      .select()
      .from(contentItems)
      .where(and(...conditions))
      .orderBy(desc(contentItems.updatedAt));
  }

  async getContent(instituteId: string, contentId: string) {
    const item = await this.assertContentExists(instituteId, contentId);

    const [current] = await this.db
      .select()
      .from(contentVersions)
      .where(
        and(
          eq(contentVersions.contentId, contentId),
          eq(contentVersions.version, item.currentVersion),
        ),
      )
      .limit(1);

    return { item, current: current! };
  }

  // ── Update (creates a new version) ────────

  async updateContent(
    instituteId: string,
    userId: string,
    contentId: string,
    input: UpdateContentInput,
  ) {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.id, contentId), eq(contentItems.instituteId, instituteId)))
        .for('update')
        .limit(1);

      if (!locked) {
        throw new NotFoundException('Content not found');
      }

      const nextVersion = locked.currentVersion + 1;

      const [current] = await tx
        .insert(contentVersions)
        .values({
          contentId: locked.id,
          version: nextVersion,
          payload: input.payload,
          renderedHtml: input.renderedHtml,
          aiContext: input.aiContext,
          sourceReference: input.sourceReference,
          changeType: input.changeType ?? 'EDIT',
          changeReason: input.changeReason,
          createdBy: userId,
        })
        .returning();

      const [item] = await tx
        .update(contentItems)
        .set({ currentVersion: nextVersion, updatedBy: userId, updatedAt: new Date() })
        .where(eq(contentItems.id, contentId))
        .returning();

      return { item: item!, current: current! };
    });
  }

  // ── Version history ───────────────────────

  async listVersions(instituteId: string, contentId: string) {
    await this.assertContentExists(instituteId, contentId);

    return this.db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentId, contentId))
      .orderBy(desc(contentVersions.version));
  }

  async getVersion(instituteId: string, contentId: string, version: number) {
    await this.assertContentExists(instituteId, contentId);

    const [row] = await this.db
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.contentId, contentId), eq(contentVersions.version, version)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Content version not found');
    }

    return row;
  }

  // ── Status ────────────────────────────────

  async setStatus(instituteId: string, contentId: string, status: ContentStatus) {
    const [updated] = await this.db
      .update(contentItems)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(contentItems.id, contentId), eq(contentItems.instituteId, instituteId)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Content not found');
    }

    return updated;
  }

  // ── Helpers ───────────────────────────────

  private resolveScope(input: CreateContentInput): { kind: ScopeKind; id: string } {
    const provided = [
      input.subjectId !== undefined ? { kind: 'subject' as const, id: input.subjectId } : null,
      input.chapterId !== undefined ? { kind: 'chapter' as const, id: input.chapterId } : null,
      input.topicId !== undefined ? { kind: 'topic' as const, id: input.topicId } : null,
    ].filter((x): x is { kind: ScopeKind; id: string } => x !== null);

    if (provided.length !== 1) {
      throw new BadRequestException(
        'Exactly one of subjectId, chapterId, topicId must be provided',
      );
    }

    return provided[0];
  }

  private async assertScopeInInstitute(
    instituteId: string,
    kind: ScopeKind,
    id: string,
  ): Promise<void> {
    if (kind === 'subject') {
      const [row] = await this.db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.id, id), eq(subjects.instituteId, instituteId)))
        .limit(1);

      if (!row) throw new NotFoundException('Subject not found');
      return;
    }

    if (kind === 'chapter') {
      const [row] = await this.db
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
        .where(and(eq(chapters.id, id), eq(subjects.instituteId, instituteId)))
        .limit(1);

      if (!row) throw new NotFoundException('Chapter not found');
      return;
    }

    const [row] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, id), eq(subjects.instituteId, instituteId)))
      .limit(1);

    if (!row) throw new NotFoundException('Topic not found');
  }

  private async assertContentExists(instituteId: string, contentId: string) {
    const [item] = await this.db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, contentId), eq(contentItems.instituteId, instituteId)))
      .limit(1);

    if (!item) {
      throw new NotFoundException('Content not found');
    }

    return item;
  }
}
