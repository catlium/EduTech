import type { BankBucket } from './build-bank-buckets.js';

/* Question-bank generation is batched (Goal E): a generation request for a
 * source spawns one `AI_GENERATE_QUESTIONS` child job per (questionType,
 * difficulty) bucket, and a bucket larger than maxPerJob is split into
 * several children. Each child targets ONE (type, difficulty) with a small
 * count, so the worker never asks the model for 100+ questions at once. All
 * children share the request's batchId; each carries a unique dedupKey slot
 * (the jobs_active_generation_unique index dedupes active children while
 * letting per-type jobs for the same source run in parallel). */

export const DEFAULT_QUESTION_BATCH_SIZE = 10;
/** Hard ceiling — mirrors the worker's MAX_QUESTION_COUNT (legacy path). */
export const MAX_QUESTION_BATCH_SIZE = 50;

export interface QuestionBatchInput {
  batchId: string;
  batchSource: { type: string; id: string };
  source: { type: string; id: string };
  userId: string;
  buckets: readonly BankBucket[];
  typeFormats: Record<string, string>;
  maxPerJob?: number;
}

export interface QuestionBatchChildPayload {
  operation: 'AI_GENERATE_QUESTIONS';
  source: { type: string; id: string };
  requestedBy: string;
  batchId: string;
  batchSource: { type: string; id: string };
  params: {
    dedupKey: string;
    questionType: string;
    difficulty: string;
    count: number;
    types: Record<string, string>;
  };
}

export interface QuestionBatchChild {
  dedupKey: string;
  payload: QuestionBatchChildPayload;
}

export interface QuestionBatchPlan {
  batchId: string;
  totalQuestions: number;
  children: QuestionBatchChild[];
}

export function planQuestionBankJobs(input: QuestionBatchInput): QuestionBatchPlan {
  const max = Math.min(
    Math.max(1, input.maxPerJob ?? DEFAULT_QUESTION_BATCH_SIZE),
    MAX_QUESTION_BATCH_SIZE,
  );

  const children: QuestionBatchChild[] = [];
  for (const bucket of input.buckets) {
    if (!bucket.count || bucket.count < 1) continue;
    const parts = Math.ceil(bucket.count / max);
    for (let sub = 1; sub <= parts; sub += 1) {
      const already = (sub - 1) * max;
      const count = Math.min(max, bucket.count - already);
      const dedupKey = `qbank:${input.batchId}:${bucket.questionType}:${bucket.difficulty}:${sub}`;
      children.push({
        dedupKey,
        payload: {
          operation: 'AI_GENERATE_QUESTIONS',
          source: { type: input.source.type, id: input.source.id },
          requestedBy: input.userId,
          batchId: input.batchId,
          batchSource: input.batchSource,
          params: {
            dedupKey,
            questionType: bucket.questionType,
            difficulty: bucket.difficulty,
            count,
            types: input.typeFormats,
          },
        },
      });
    }
  }

  return {
    batchId: input.batchId,
    totalQuestions: children.reduce((sum, child) => sum + child.payload.params.count, 0),
    children,
  };
}
