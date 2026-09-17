import type { BankBucket } from './build-bank-buckets.js';

/* Question-bank generation is batched (Goal E): a generation request spawns
 * one `AI_GENERATE_QUESTIONS` child job per (questionType, difficulty) bucket,
 * and a bucket larger than the type's max is split into several children. Each
 * child targets ONE (type, difficulty) with a small count, so the worker never
 * asks the model for 100+ questions at once. All children share the request's
 * batchId; each carries a unique dedupKey slot (the jobs_active_generation_unique
 * index dedupes active children while letting per-type jobs for the same source
 * run in parallel).
 *
 * Per-type min/max govern the plan: a type whose total request falls below its
 * min is floored up to the min (the surplus lands in the bank as PENDING for
 * future shortages), and the max caps every child job (quality control). The
 * caller's bucket counts are recommendations — the generation layer owns
 * batching, not the caller. */

/** Hard ceiling — mirrors the worker's MAX_QUESTION_COUNT (legacy path). */
export const MAX_QUESTION_BATCH_SIZE = 50;

export interface QuestionTypeBatchLimits {
  min: number;
  max: number;
}

/** Recommended min/max per question type (predefined codes). Unlisted or
 * institute-defined types fall back to DEFAULT_BATCH_LIMITS. */
export const QUESTION_TYPE_BATCH_LIMITS: Record<string, QuestionTypeBatchLimits> = {
  MCQ: { min: 20, max: 30 },
  TRUE_FALSE: { min: 15, max: 25 },
  FILL_IN_BLANK: { min: 15, max: 25 },
  SHORT_ANSWER: { min: 10, max: 15 },
  LONG_ANSWER: { min: 8, max: 12 },
  NUMERICAL: { min: 10, max: 15 },
  CASE_STUDY: { min: 5, max: 8 },
};

const DEFAULT_BATCH_LIMITS: QuestionTypeBatchLimits = { min: 10, max: 15 };

export function questionTypeBatchLimits(questionType: string): QuestionTypeBatchLimits {
  return QUESTION_TYPE_BATCH_LIMITS[questionType] ?? DEFAULT_BATCH_LIMITS;
}

export interface QuestionBatchInput {
  batchId: string;
  batchSource: { type: string; id: string };
  source: { type: string; id: string };
  userId: string;
  buckets: readonly BankBucket[];
  typeFormats: Record<string, string>;
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

/** Floor each type's total request up to its min, spreading the surplus across
 * the requested difficulty buckets proportionally (largest remainder) so the
 * difficulty mix the caller asked for survives a small request. */
function floorTypeTotals(buckets: readonly BankBucket[]): BankBucket[] {
  const byType = new Map<string, BankBucket[]>();
  for (const b of buckets) {
    if (!b.count || b.count < 1) continue;
    const list = byType.get(b.questionType) ?? [];
    list.push(b);
    byType.set(b.questionType, list);
  }

  const out: BankBucket[] = [];
  for (const [questionType, list] of byType) {
    const { min } = questionTypeBatchLimits(questionType);
    const total = list.reduce((sum, b) => sum + b.count, 0);
    if (total >= min) {
      out.push(...list);
      continue;
    }
    const extra = min - total;
    const shares = list.map((b) => ({ b, exact: (b.count / total) * extra }));
    const floors = shares.map((s) => ({ ...s, floor: Math.floor(s.exact) }));
    let remaining = extra - floors.reduce((sum, s) => sum + s.floor, 0);
    floors.sort((a, b) => b.exact - b.floor - (a.exact - a.floor));
    for (const f of floors) {
      if (remaining <= 0) break;
      f.floor += 1;
      remaining -= 1;
    }
    out.push(...floors.map((f) => ({ ...f.b, count: f.b.count + f.floor })));
  }
  return out;
}

export function planQuestionBankJobs(input: QuestionBatchInput): QuestionBatchPlan {
  const children: QuestionBatchChild[] = [];
  for (const bucket of floorTypeTotals(input.buckets)) {
    const chunk = Math.min(
      questionTypeBatchLimits(bucket.questionType).max,
      MAX_QUESTION_BATCH_SIZE,
    );
    const parts = Math.ceil(bucket.count / chunk);
    for (let sub = 1; sub <= parts; sub += 1) {
      const already = (sub - 1) * chunk;
      const count = Math.min(chunk, bucket.count - already);
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