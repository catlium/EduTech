// Phase B batch production plan: decides, per resolved generation source,
// whether a starter material must be generated first and which derived-resource
// jobs to enqueue. Pure and DB-free so it is unit-testable with `node --test`
// (no NestJS decorators); `GenerationService.requestBatchGeneration` injects
// the port (its own Drizzle/Jobs bindings) and runs the plan.
import type { ContentPackageType, GenerateBatchJobIds } from '@catlium/contracts';

export const CONTENT_PACKAGE_OPERATION = 'AI_GENERATE_CONTENT_PACKAGE' as const;
export const STARTER_MATERIAL_OPERATION = 'AI_GENERATE_STARTER_MATERIAL' as const;

export type BatchSource = { type: string; id: string };

// Batch resource type → job operation. CORNELL_NOTE reuses the content-package
// operation restricted to ["cornell"] — batches stay on the existing jobs
// system, never a second queue.
const BATCH_TYPE_TO_OPERATION: Record<ContentPackageType, string> = {
  NOTE: 'AI_GENERATE_NOTE',
  SUMMARY: 'AI_GENERATE_SUMMARY',
  FLASHCARD_SET: 'AI_GENERATE_FLASHCARDS',
  IMPORTANT_CONCEPTS: 'AI_GENERATE_CONCEPTS',
  CORNELL_NOTE: CONTENT_PACKAGE_OPERATION,
};

export interface PlanPort {
  /** Whether the topic already has extracted material usable as a source. */
  hasUsableMaterial(topicId: string): Promise<boolean>;
  /** The topic whose AI_GENERATED resources a source maps to (TOPIC → itself,
   * MATERIAL → the material's owning topic; null when none). */
  dedupTopicId(source: BatchSource): Promise<string | null>;
  /** True when a live AI_GENERATED derived resource of `type` exists for the topic. */
  hasExistingDerived(topicId: string, type: ContentPackageType): Promise<boolean>;
  /** Persist + publish one job; `duplicate` means the active-generation unique
   * index rejected it (a concurrent batch already carries this work). */
  enqueueJob(
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<{ jobId: string; duplicate: boolean }>;
}

export interface BatchPlanInput {
  sources: BatchSource[];
  productTypes: ContentPackageType[];
  mode: 'missing' | 'regenerate';
  batchId: string;
  batchSource: BatchSource;
  userId: string;
}

export interface BatchPlanOutput {
  jobIds: string[];
  alreadyActive: ContentPackageType[];
  skipped: NonNullable<GenerateBatchJobIds['skipped']>;
}

export async function planBatchJobs(
  port: PlanPort,
  input: BatchPlanInput,
): Promise<BatchPlanOutput> {
  const jobIds: string[] = [];
  const alreadyActive: ContentPackageType[] = [];
  const skipped: NonNullable<GenerateBatchJobIds['skipped']> = [];

  for (const source of input.sources) {
    // A TOPIC source with no usable material cannot produce derived resources
    // yet. Instead of enqueuing jobs that would immediately fail in the worker,
    // enqueue ONE starter-material job carrying the dependent requests; on
    // starter completion the worker enqueues the dependents with the SAME
    // batchId, so the batch status view shows the prerequisite then the derived
    // jobs as they appear. A concurrent starter for the same topic collides on
    // the unique index → the existing starter is reused (skipped).
    if (source.type === 'TOPIC' && !(await port.hasUsableMaterial(source.id))) {
      const starter = await port.enqueueJob(STARTER_MATERIAL_OPERATION, {
        operation: STARTER_MATERIAL_OPERATION,
        batchId: input.batchId,
        batchSource: input.batchSource,
        source: { type: 'TOPIC', id: source.id },
        requestedBy: input.userId,
        dependentResources: input.productTypes.map(dependentParam),
      });
      if (starter.duplicate) {
        for (const type of input.productTypes) {
          skipped.push({ type, topicId: source.id, reason: 'starter_pending' });
        }
        continue;
      }
      jobIds.push(starter.jobId);
      continue;
    }

    const dedupTopicId = await port.dedupTopicId(source);

    for (const type of input.productTypes) {
      // mode=missing (default): a live topic-owned AI_GENERATED resource of
      // this type already exists → nothing to generate. Regenerate forces it.
      if (
        input.mode === 'missing' &&
        dedupTopicId &&
        (await port.hasExistingDerived(dedupTopicId, type))
      ) {
        skipped.push({ type, topicId: dedupTopicId, reason: 'exists' });
        continue;
      }

      const result = await port.enqueueJob(BATCH_TYPE_TO_OPERATION[type], {
        ...dependentParam(type),
        batchId: input.batchId,
        batchSource: input.batchSource,
        source: { type: source.type, id: source.id },
        requestedBy: input.userId,
      });
      if (result.duplicate) {
        alreadyActive.push(type);
        continue;
      }
      jobIds.push(result.jobId);
    }
  }

  return { jobIds, alreadyActive, skipped };
}

function dependentParam(type: ContentPackageType): Record<string, unknown> {
  const operation = BATCH_TYPE_TO_OPERATION[type];
  const dep: Record<string, unknown> = { operation, resourceType: type };
  if (operation === CONTENT_PACKAGE_OPERATION) {
    dep.params = { types: ['cornell'] };
  }
  return dep;
}
