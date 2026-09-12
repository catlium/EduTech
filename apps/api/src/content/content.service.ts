import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { contentItems, contentVersions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { ContentPayloadSchemas } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { resolveScopeChain } from '../common/utils/scope-resolver.js';

type ContentType = 'NOTE' | 'FLASHCARD_SET' | 'CORNELL_NOTE' | 'SUMMARY' | 'IMPORTANT_CONCEPTS';
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
    this.validatePayload(input.type, input.payload);

    const chain = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: false },
      input,
    );

    return this.db.transaction(async (tx) => {
      const [item] = await tx
        .insert(contentItems)
        .values({
          instituteId,
          subjectId: chain.subjectId,
          chapterId: chain.chapterId,
          topicId: chain.topicId,
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

      this.validatePayload(locked.type as ContentType, input.payload);

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

  private validatePayload(type: ContentType, payload: Record<string, unknown>): void {
    const schema = ContentPayloadSchemas[type];
    const result = schema.safeParse(payload);

    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.length ? issue.path.join('.') : 'root';
      throw new BadRequestException(
        `Invalid ${type} payload: ${path} — ${issue?.message ?? 'does not match schema'}`,
      );
    }
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
