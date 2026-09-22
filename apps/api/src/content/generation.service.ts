import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
  materials,
  topics,
  chapters,
  subjects,
  contentItems,
  contentVersions,
  questions,
  jobs,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { AcademicScopeService } from '../authorization/academic-scope.service.js';
import type {
  GenerateContentResponse,
  GenerateContentPackageResponse,
  GenerationOperation,
  ContentGenerationStatus,
  ContentGenerationStatusResponse,
  MaterialResource,
  MaterialQuestionSummary,
  ContentPackageType,
  GenerateBatchJobIds,
  GenerationBatchResponse,
  GenerationBatchJob,
  GenerationSourceTypeEnum,
} from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';
import { planBatchJobs, type PlanPort, type BatchSource } from './batch-plan.js';

const CONTENT_PACKAGE_OPERATION = 'AI_GENERATE_CONTENT_PACKAGE' as const;
const STARTER_MATERIAL_OPERATION = 'AI_GENERATE_STARTER_MATERIAL' as const;

// API content-type names (DTO/contract) → worker package keys (lowercase).
const PACKAGE_TYPE_MAP: Record<string, string> = {
  NOTE: 'note',
  SUMMARY: 'summary',
  FLASHCARD_SET: 'flashcards',
  IMPORTANT_CONCEPTS: 'concepts',
  CORNELL_NOTE: 'cornell',
};
const AI_CONTENT_TYPES = [
  'NOTE',
  'SUMMARY',
  'FLASHCARD_SET',
  'IMPORTANT_CONCEPTS',
  'CORNELL_NOTE',
] as const;

// Batch resource type → job operation. CORNELL_NOTE reuses the content-package
// operation restricted to ["cornell"] — batches stay on the existing jobs
// system, never a second queue.
const BATCH_TYPE_TO_OPERATION: Record<string, string> = {
  NOTE: 'AI_GENERATE_NOTE',
  SUMMARY: 'AI_GENERATE_SUMMARY',
  FLASHCARD_SET: 'AI_GENERATE_FLASHCARDS',
  IMPORTANT_CONCEPTS: 'AI_GENERATE_CONCEPTS',
  CORNELL_NOTE: CONTENT_PACKAGE_OPERATION,
};

const ACTIVE_JOB_STATUSES = ['queued', 'processing', 'cancelling'] as const;

@Injectable()
export class GenerationService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
    private readonly scope: AcademicScopeService,
  ) {}

  async requestGeneration(
    operation: GenerationOperation,
    instituteId: string,
    membershipId: string,
    userId: string,
    sourceType: 'MATERIAL' | 'TOPIC',
    sourceId: string,
  ): Promise<GenerateContentResponse> {
    if (sourceType === 'MATERIAL') {
      await this.assertGeneratableMaterial(instituteId, membershipId, sourceId);
    } else {
      await this.assertWritableTopic(instituteId, membershipId, sourceId);
    }

    const payload = {
      operation,
      source: { type: sourceType, id: sourceId },
      requestedBy: userId,
    };

    // The partial unique index on jobs (active generation per source + operation)
    // guarantees a single active generation job; a concurrent duplicate
    // insert violates it and maps to a 409, consistent with material processing.
    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, operation, payload, userId);
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
      operation,
      sourceType,
      sourceId,
      status: 'QUEUED',
    };
  }

  async requestStarterMaterialGeneration(
    instituteId: string,
    membershipId: string,
    userId: string,
    topicId: string,
  ): Promise<GenerateContentResponse> {
    await this.assertWritableTopic(instituteId, membershipId, topicId);

    const payload = {
      operation: STARTER_MATERIAL_OPERATION,
      source: { type: 'TOPIC' as const, id: topicId },
      requestedBy: userId,
    };

    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, STARTER_MATERIAL_OPERATION, payload, userId);
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
      operation: STARTER_MATERIAL_OPERATION,
      sourceType: 'TOPIC',
      sourceId: topicId,
      status: 'QUEUED',
    };
  }

  async requestPackageGeneration(
    instituteId: string,
    membershipId: string,
    userId: string,
    sourceType: 'MATERIAL' | 'TOPIC',
    sourceId: string,
    includeTypes?: string[],
  ): Promise<GenerateContentPackageResponse> {
    if (sourceType === 'MATERIAL') {
      await this.assertGeneratableMaterial(instituteId, membershipId, sourceId);
    } else {
      await this.assertWritableTopic(instituteId, membershipId, sourceId);
    }

    const payload: Record<string, unknown> = {
      operation: CONTENT_PACKAGE_OPERATION,
      source: { type: sourceType, id: sourceId },
      requestedBy: userId,
    };
    if (includeTypes && includeTypes.length > 0) {
      payload.params = {
        types: includeTypes.map((t) => PACKAGE_TYPE_MAP[t]).filter((t): t is string => Boolean(t)),
      };
    }

    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, CONTENT_PACKAGE_OPERATION, payload, userId);
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
      operation: CONTENT_PACKAGE_OPERATION,
      sourceType,
      sourceId,
      status: 'QUEUED',
    };
  }

  async getContentGenerationStatus(
    instituteId: string,
    membershipId: string,
    materialId: string,
  ): Promise<ContentGenerationStatusResponse> {
    const [material] = await this.db
      .select({
        id: materials.id,
        revision: materials.revision,
        updatedAt: materials.updatedAt,
        subjectId: materials.subjectId,
      })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .limit(1);

    if (!material) throw new NotFoundException('Material not found');
    await this.scope.requireReadableSubject(instituteId, membershipId, material.subjectId);

    // Every derived-resource revision generated from this material (not just
    // the latest): the Material Detail hub shows the full provenance trail.
    const rows = await this.db
      .select({
        contentId: contentItems.id,
        type: contentItems.type,
        title: contentItems.title,
        status: contentItems.status,
        version: contentVersions.version,
        changeType: contentVersions.changeType,
        generatedAt: contentVersions.createdAt,
        sourceReference: contentVersions.sourceReference,
      })
      .from(contentItems)
      .innerJoin(contentVersions, eq(contentItems.id, contentVersions.contentId))
      .where(
        and(
          eq(contentItems.instituteId, instituteId),
          eq(contentItems.source, 'AI_GENERATED'),
          sql`${contentVersions.sourceReference} ->> 'id' = ${materialId}`,
          sql`${contentItems.type} IN (${sql.join(
            AI_CONTENT_TYPES.map((t) => sql`${t}`),
            sql`, `,
          )})`,
        ),
      )
      .orderBy(contentItems.type, desc(contentVersions.version));

    const isStale = (row: (typeof rows)[number]): boolean => {
      // Deterministic staleness: source revision recorded at generation time
      // vs. the material's current revision. Timestamp is only the fallback
      // for legacy rows written before revisions existed.
      const sourceRef = row.sourceReference as Record<string, unknown> | null;
      const revisions =
        sourceRef && typeof sourceRef.revisions === 'object' && sourceRef.revisions !== null
          ? (sourceRef.revisions as Record<string, unknown>)
          : {};
      const recorded =
        typeof (sourceRef?.revision as unknown) === 'number'
          ? (sourceRef?.revision as number)
          : typeof revisions[materialId] === 'number'
            ? (revisions[materialId] as number)
            : undefined;
      if (recorded !== undefined) {
        return material.revision > recorded;
      }
      return Boolean(material.updatedAt && row.generatedAt && material.updatedAt > row.generatedAt);
    };

    const resources: MaterialResource[] = rows.map((row) => ({
      contentId: row.contentId,
      type: row.type as MaterialResource['type'],
      title: row.title,
      status: row.status,
      version: row.version,
      changeType: row.changeType,
      generatedAt: row.generatedAt?.toISOString() ?? null,
      sourceRevision: (() => {
        const sourceRef = row.sourceReference as Record<string, unknown> | null;
        const revisions =
          sourceRef && typeof sourceRef.revisions === 'object' && sourceRef.revisions !== null
            ? (sourceRef.revisions as Record<string, unknown>)
            : {};
        const recorded =
          typeof (sourceRef?.revision as unknown) === 'number'
            ? (sourceRef?.revision as number)
            : typeof revisions[materialId] === 'number'
              ? (revisions[materialId] as number)
              : undefined;
        return recorded ?? null;
      })(),
      stale: isStale(row),
    }));

    const items: ContentGenerationStatus[] = AI_CONTENT_TYPES.map((type) => {
      const row = rows.find((r) => r.type === type);
      if (!row) {
        return { type, state: 'not_generated', contentId: null, version: null, generatedAt: null };
      }
      return {
        type,
        state: isStale(row) ? 'stale' : 'generated',
        contentId: row.contentId,
        version: row.version,
        generatedAt: row.generatedAt?.toISOString() ?? null,
      };
    });

    return {
      materialId,
      materialRevision: material.revision,
      items,
      resources,
      questions: await this.getMaterialQuestionSummary(instituteId, materialId),
    };
  }

  private async getMaterialQuestionSummary(
    instituteId: string,
    materialId: string,
  ): Promise<MaterialQuestionSummary> {
    const rows = await this.db
      .select({
        approvalStatus: questions.approvalStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(questions)
      .where(
        and(
          eq(questions.instituteId, instituteId),
          eq(questions.status, 'ACTIVE'),
          sql`${questions.provenance}->'materialIds' ? ${materialId}`,
        ),
      )
      .groupBy(questions.approvalStatus);

    const summary: MaterialQuestionSummary = { total: 0, pending: 0, approved: 0 };
    for (const row of rows) {
      summary.total += row.count;
      if (row.approvalStatus === 'PENDING') summary.pending += row.count;
      if (row.approvalStatus === 'APPROVED') summary.approved += row.count;
    }
    return summary;
  }

  // ── Generation batches ────────────────────────────────────────────

  async requestBatchGeneration(
    instituteId: string,
    membershipId: string,
    userId: string,
    sourceType: (typeof GenerationSourceTypeEnum.options)[number],
    sourceId: string,
    types: string[],
    mode: 'missing' | 'regenerate' = 'missing',
  ): Promise<GenerateBatchJobIds> {
    const resourceTypes = types as ContentPackageType[];
    const batchId = randomUUID();
    const batchSource: BatchSource = { type: sourceType, id: sourceId };

    // The batch source must be inside the actor's writable scope — all jobs
    // deriving resources from it create content in that scope (§18.5).
    await this.gateWritableBatchSource(instituteId, membershipId, sourceType, sourceId);

    const port: PlanPort = {
      hasUsableMaterial: (topicId) => this.hasUsableTopicMaterial(instituteId, topicId),
      dedupTopicId: (source) => this.generationDedupTopicId(instituteId, source),
      hasExistingDerived: (topicId, type) =>
        this.hasExistingDerivedContent(instituteId, topicId, type),
      enqueueJob: async (operation, payload) => {
        try {
          const job = await this.jobs.issueJob(instituteId, operation, payload, userId);
          return { jobId: job.id, duplicate: false };
        } catch (error) {
          if (isUniqueViolation(error)) return { jobId: '', duplicate: true };
          throw error;
        }
      },
    };

    const result = await planBatchJobs(port, {
      sources: await this.resolveBatchSources(instituteId, membershipId, sourceType, sourceId),
      productTypes: resourceTypes,
      mode,
      batchId,
      batchSource,
      userId,
    });

    return { batchId, sourceType, sourceId, ...result };
  }

  /** Resolve a batch's per-resource sources: MATERIAL/TOPIC stay 1:1; a
   * CHAPTER/SUBJECT batch expands to every active topic under the scope. */
  private async resolveBatchSources(
    instituteId: string,
    membershipId: string,
    sourceType: (typeof GenerationSourceTypeEnum.options)[number],
    sourceId: string,
  ): Promise<Array<{ type: 'MATERIAL' | 'TOPIC'; id: string }>> {
    if (sourceType === 'MATERIAL') {
      await this.assertGeneratableMaterial(instituteId, membershipId, sourceId);
      return [{ type: 'MATERIAL', id: sourceId }];
    }
    if (sourceType === 'TOPIC') {
      await this.assertWritableTopic(instituteId, membershipId, sourceId);
      return [{ type: 'TOPIC', id: sourceId }];
    }

    const topicIds = await this.listActiveTopicIds(instituteId, sourceType, sourceId);
    if (topicIds.length === 0) {
      throw new ConflictException('No active topics in this source scope');
    }
    return topicIds.map((id) => ({ type: 'TOPIC', id }));
  }

  /** A batch source must sit inside the actor's writable scope — CHAPTER/SUBJECT
   *  expansion gates every expanded topic (§18.5). */
  private async gateWritableBatchSource(
    instituteId: string,
    membershipId: string,
    sourceType: (typeof GenerationSourceTypeEnum.options)[number],
    sourceId: string,
  ): Promise<void> {
    if (sourceType === 'MATERIAL') {
      await this.assertGeneratableMaterial(instituteId, membershipId, sourceId);
      return;
    }
    if (sourceType === 'TOPIC') {
      await this.assertWritableTopic(instituteId, membershipId, sourceId);
      return;
    }
    const topicIds = await this.listActiveTopicIds(instituteId, sourceType, sourceId);
    if (topicIds.length === 0) {
      throw new ConflictException('No active topics in this source scope');
    }
    for (const topicId of topicIds) {
      await this.assertWritableTopic(instituteId, membershipId, topicId);
    }
  }

  private async listActiveTopicIds(
    instituteId: string,
    scopeType: 'CHAPTER' | 'SUBJECT',
    scopeId: string,
  ): Promise<string[]> {
    const [scope] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(
        and(
          eq(subjects.instituteId, instituteId),
          scopeType === 'CHAPTER' ? eq(chapters.id, scopeId) : eq(subjects.id, scopeId),
        ),
      )
      .limit(1);
    if (!scope) {
      throw new NotFoundException(
        scopeType === 'CHAPTER' ? 'Chapter not found' : 'Subject not found',
      );
    }

    const rows = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(
        and(
          eq(subjects.instituteId, instituteId),
          scopeType === 'CHAPTER' ? eq(chapters.id, scopeId) : eq(subjects.id, scopeId),
          eq(chapters.status, 'active'),
          eq(topics.status, 'active'),
        ),
      )
      .orderBy(chapters.sortOrder, topics.sortOrder);
    return rows.map((row) => row.id);
  }

  async getGenerationBatch(batchId: string, instituteId: string): Promise<GenerationBatchResponse> {
    const rows = await this.db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        error: jobs.error,
        payload: jobs.payload,
      })
      .from(jobs)
      .where(and(eq(jobs.instituteId, instituteId), sql`${jobs.payload}->>'batchId' = ${batchId}`))
      .orderBy(desc(jobs.createdAt));

    if (rows.length === 0) throw new NotFoundException('Generation batch not found');

    const first = rows[0];
    const payload = first.payload as Record<string, unknown> | null;
    const batchSource =
      (payload?.batchSource as
        { type?: (typeof GenerationSourceTypeEnum.options)[number]; id?: string } | undefined) ??
      (payload?.source as
        { type?: (typeof GenerationSourceTypeEnum.options)[number]; id?: string } | undefined);
    const jobsList: GenerationBatchJob[] = rows.map((row) => {
      const jobPayload = row.payload as Record<string, unknown> | null;
      const resourceType =
        typeof jobPayload?.resourceType === 'string'
          ? (jobPayload.resourceType as GenerationBatchJob['type'])
          : BATCH_TYPE_TO_OPERATION[row.type] === CONTENT_PACKAGE_OPERATION
            ? 'CORNELL_NOTE'
            : 'NOTE';
      return {
        jobId: row.id,
        type: resourceType,
        operation: row.type,
        status: row.status,
        error:
          (row.error as Record<string, unknown> | null) &&
          typeof (row.error as Record<string, unknown>).message === 'string'
            ? ((row.error as Record<string, unknown>).message as string)
            : null,
      };
    });

    const count = (statuses: readonly string[]) =>
      jobsList.filter((j) => statuses.includes(j.status)).length;

    return {
      batchId,
      sourceType: batchSource?.type ?? 'MATERIAL',
      sourceId: batchSource?.id ?? '',
      total: rows.length,
      completed: count(['completed']),
      failed: count(['failed']),
      cancelled: count(['cancelled']),
      active: count(ACTIVE_JOB_STATUSES),
      jobs: jobsList,
    };
  }

  async cancelGenerationBatch(batchId: string, instituteId: string) {
    // Fail-safe: cancel what exists; an unknown batch still returns its listing
    // if the row set is empty → NotFound from getGenerationBatch.
    const rows = await this.db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.instituteId, instituteId), sql`${jobs.payload}->>'batchId' = ${batchId}`));

    if (rows.length === 0) throw new NotFoundException('Generation batch not found');

    for (const row of rows) {
      await this.jobs.cancelJob(row.id, instituteId);
    }
    return this.getGenerationBatch(batchId, instituteId);
  }

  /** Regenerate ONE existing derived resource. The item's topic is the
   * generation source (derived resources are Topic-owned), so the job uses the
   * latest topic/materials context and the worker re-resolves the sources at
   * run time. The partial unique index on jobs dedupes concurrent requests for
   * the same resource → 409 while one is already running. The old resource
   * stays live until the worker bumps its version on success. */
  async requestResourceRegeneration(
    instituteId: string,
    membershipId: string,
    userId: string,
    contentId: string,
  ): Promise<{ jobId: string; contentId: string; type: string; status: 'QUEUED' }> {
    const [item] = await this.db
      .select({
        id: contentItems.id,
        type: contentItems.type,
        topicId: contentItems.topicId,
        subjectId: contentItems.subjectId,
        source: contentItems.source,
      })
      .from(contentItems)
      .where(and(eq(contentItems.id, contentId), eq(contentItems.instituteId, instituteId)))
      .limit(1);

    if (!item) throw new NotFoundException('Content item not found');
    if (item.source !== 'AI_GENERATED' || !item.topicId) {
      throw new ConflictException('Only AI-generated Topic-owned resources can be regenerated');
    }
    // Regeneration rewrites the resource inside its scope → writable.
    await this.scope.requireWritableSubject(instituteId, membershipId, item.subjectId);

    const operation = BATCH_TYPE_TO_OPERATION[item.type];
    if (!operation) {
      throw new ConflictException(`Resource type ${item.type} cannot be regenerated`);
    }

    const payload = {
      operation,
      source: { type: 'TOPIC' as const, id: item.topicId },
      requestedBy: userId,
      resourceType: item.type,
      regenerationOf: contentId,
    };

    let job: Job;
    try {
      job = await this.jobs.issueJob(instituteId, operation, payload, userId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A generation is already in progress for this resource');
      }
      throw error;
    }

    return { jobId: job.id, contentId, type: item.type, status: 'QUEUED' };
  }

  private async assertGeneratableMaterial(
    instituteId: string,
    membershipId: string,
    materialId: string,
  ): Promise<void> {
    const [material] = await this.db
      .select({
        id: materials.id,
        status: materials.status,
        processingStatus: materials.processingStatus,
        textContent: materials.textContent,
        topicId: materials.topicId,
        subjectId: materials.subjectId,
      })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .limit(1);

    if (!material) throw new NotFoundException('Material not found');
    // Generation derives new content → the source must be in writable scope.
    await this.scope.requireWritableSubject(instituteId, membershipId, material.subjectId);
    if (material.status !== 'ACTIVE') throw new ConflictException('Material is not active');
    if (material.processingStatus !== 'READY') {
      throw new ConflictException('Material is not ready for generation');
    }
    if (!material.textContent?.trim()) {
      throw new ConflictException('Material has no extracted text');
    }
    // Derived resources are Topic-owned: a material without a topic cannot be
    // a generation source (it would produce a topic-less resource). Generate
    // from the topic instead.
    if (!material.topicId) {
      throw new ConflictException(
        'Material is not linked to a topic; generate from its topic instead',
      );
    }
  }

  /** Topic exists in the institute AND is writable — generation derives new
   *  content inside the topic's scope (§18.5). */
  private async assertWritableTopic(
    instituteId: string,
    membershipId: string,
    topicId: string,
  ): Promise<void> {
    const [topic] = await this.db
      .select({ subjectId: subjects.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, topicId), eq(subjects.instituteId, instituteId)))
      .limit(1);

    if (!topic) throw new NotFoundException('Topic not found');
    await this.scope.requireWritableSubject(instituteId, membershipId, topic.subjectId);
  }

  /** True when the topic already has extracted material usable as a generation
   * source — same predicate the worker uses in `get_topic_materials`. */
  private async hasUsableTopicMaterial(instituteId: string, topicId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: materials.id })
      .from(materials)
      .where(
        and(
          eq(materials.instituteId, instituteId),
          eq(materials.topicId, topicId),
          eq(materials.status, 'ACTIVE'),
          eq(materials.processingStatus, 'READY'),
          sql`length(btrim(${materials.textContent})) > 0`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** True when a live AI_GENERATED derived resource of `type` already exists for
   * the topic — same dedup predicate as the worker's `insert_ai_content`. */
  private async hasExistingDerivedContent(
    instituteId: string,
    topicId: string,
    type: ContentPackageType,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.instituteId, instituteId),
          eq(contentItems.topicId, topicId),
          eq(contentItems.type, type),
          eq(contentItems.source, 'AI_GENERATED'),
          sql`${contentItems.status} <> 'ARCHIVED'`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** For a resolved source, the topic whose AI_GENERATED resources it maps to.
   * TOPIC → itself; MATERIAL → the material's owning topic (generated resources
   * are Topic-owned, so mode=missing dedup compares against that topic). */
  private async generationDedupTopicId(
    instituteId: string,
    source: { type: string; id: string },
  ): Promise<string | null> {
    if (source.type === 'TOPIC') return source.id;
    const [row] = await this.db
      .select({ topicId: materials.topicId })
      .from(materials)
      .where(and(eq(materials.id, source.id), eq(materials.instituteId, instituteId)))
      .limit(1);
    return row?.topicId ?? null;
  }
}
