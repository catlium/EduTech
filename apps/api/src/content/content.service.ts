import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { eq, and, desc, ilike, isNull, not, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { contentItems, contentVersions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { ContentPayloadSchemas } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { resolveScopeChain } from '../common/utils/scope-resolver.js';
import { AcademicScopeService } from '../authorization/academic-scope.service.js';

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
  q?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

@Injectable()
export class ContentService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly scope: AcademicScopeService,
  ) {}

  // ── Create ────────────────────────────────

  async createContent(
    instituteId: string,
    membershipId: string,
    createdBy: string,
    input: CreateContentInput,
  ) {
    this.validatePayload(input.type, input.payload);

    const chain = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: false },
      input,
    );

    // Create inside the actor's writable scope (§18.5).
    await this.scope.requireWritableSubject(instituteId, membershipId, chain.subjectId ?? null);

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

  async listContent(
    instituteId: string,
    membershipId: string,
    userId: string,
    filters: ListContentFilters,
  ) {
    const conditions: SQL[] = [
      eq(contentItems.instituteId, instituteId),
      isNull(contentItems.deletedAt),
    ];

    // DRAFT is staging → owner+admin (O1); ACTIVE/ARCHIVED → pure scope (O2).
    const scopeFilter = await this.scope.subjectScopePredicate(
      instituteId, membershipId, contentItems.subjectId,
    );
    if (scopeFilter) {
      conditions.push(
        or(
          and(eq(contentItems.createdBy, userId), eq(contentItems.status, 'DRAFT')),
          and(not(eq(contentItems.status, 'DRAFT')), scopeFilter),
        )!,
      );
    }

    if (filters.type) conditions.push(eq(contentItems.type, filters.type));
    if (filters.status) conditions.push(eq(contentItems.status, filters.status));
    if (filters.q) conditions.push(ilike(contentItems.title, `%${filters.q}%`));
    if (filters.subjectId) conditions.push(eq(contentItems.subjectId, filters.subjectId));
    if (filters.chapterId) conditions.push(eq(contentItems.chapterId, filters.chapterId));
    if (filters.topicId) conditions.push(eq(contentItems.topicId, filters.topicId));

    return this.db
      .select()
      .from(contentItems)
      .where(and(...conditions))
      .orderBy(desc(contentItems.updatedAt));
  }

  async getContent(
    instituteId: string,
    membershipId: string,
    userId: string,
    contentId: string,
  ) {
    const item = await this.assertContentExists(instituteId, contentId);
    await this.gateContent(instituteId, membershipId, userId, item, false);

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
    membershipId: string,
    userId: string,
    contentId: string,
    input: UpdateContentInput,
  ) {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(contentItems)
        .where(
          and(
            eq(contentItems.id, contentId),
            eq(contentItems.instituteId, instituteId),
            isNull(contentItems.deletedAt),
          ),
        )
        .for('update')
        .limit(1);

      if (!locked) {
        throw new NotFoundException('Content not found');
      }

      await this.gateContent(instituteId, membershipId, userId, locked, true);

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

  async listVersions(
    instituteId: string,
    membershipId: string,
    userId: string,
    contentId: string,
  ) {
    const item = await this.assertContentExists(instituteId, contentId);
    await this.gateContent(instituteId, membershipId, userId, item, false);

    return this.db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentId, contentId))
      .orderBy(desc(contentVersions.version));
  }

  async getVersion(
    instituteId: string,
    membershipId: string,
    userId: string,
    contentId: string,
    version: number,
  ) {
    const item = await this.assertContentExists(instituteId, contentId);
    await this.gateContent(instituteId, membershipId, userId, item, false);

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

  async setStatus(
    instituteId: string,
    membershipId: string,
    userId: string,
    contentId: string,
    status: ContentStatus,
  ) {
    const [existing] = await this.db
      .select()
      .from(contentItems)
      .where(
        and(
          eq(contentItems.id, contentId),
          eq(contentItems.instituteId, instituteId),
          isNull(contentItems.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new NotFoundException('Content not found');
    }
    await this.gateContent(instituteId, membershipId, userId, existing, true);

    const [updated] = await this.db
      .update(contentItems)
      .set({ status, updatedAt: new Date(), updatedBy: userId })
      .where(and(eq(contentItems.id, contentId), eq(contentItems.instituteId, instituteId)))
      .returning();

    return updated!;
  }

  // ── Helpers ───────────────────────────────

  /** Gate content access (§18): DRAFT is owner+admin staging (O1); ACTIVE and
   *  ARCHIVED are finalized, pure academic scope on the stored subject (O2).
   *  Null-subject content is admin-only (read 404 / write 403). */
  private async gateContent(
    instituteId: string,
    membershipId: string,
    userId: string,
    item: { status: string; subjectId: string | null; createdBy: string },
    mutating: boolean,
  ): Promise<void> {
    const scope = await this.scope.resolveScope(instituteId, membershipId);
    if (scope.kind === 'whole-institute') return;

    if (item.status === 'DRAFT') {
      if (item.createdBy === userId) return;
      if (mutating) {
        throw new ForbiddenException('Only the creator may modify this DRAFT content');
      }
      throw new NotFoundException('Content not found');
    }

    const inScope = item.subjectId !== null && scope.subjectIds.includes(item.subjectId);
    if (inScope) return;
    if (mutating) {
      throw new ForbiddenException('Resource is outside your academic scope');
    }
    throw new NotFoundException('Content not found');
  }

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
      .where(
        and(
          eq(contentItems.id, contentId),
          eq(contentItems.instituteId, instituteId),
          isNull(contentItems.deletedAt),
        ),
      )
      .limit(1);

    if (!item) {
      throw new NotFoundException('Content not found');
    }

    return item;
  }
}
