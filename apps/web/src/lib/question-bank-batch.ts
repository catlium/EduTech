import type { QuestionBankBatchResponse } from '@catlium/contracts';

// B3: the question-bank batch is the async generation unit. Its only
// authoritative status source is GET /questions/bank/batches/:batchId, which
// reports per-status child-job counts (active/completed/failed/cancelled) —
// there is no per-batch status field. These helpers pin the state machine so
// every generation surface derives the same pending/running/completed/partial/
// failed/cancelled phase, terminal boundary, and retry/cancel affordances.

export type QuestionBankBatchPhase =
  'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

type BatchCounts = Pick<QuestionBankBatchResponse, 'active' | 'completed' | 'failed' | 'cancelled'>;

/** Derive the display phase from the child-job counts.
 * - pending: active work, nothing settled yet (queued/processing).
 * - running: active work with at least one settled child.
 * - completed: every child settled successfully.
 * - partial: settled with a mix of success and failure/cancellation.
 * - failed: settled with failures and no successes.
 * - cancelled: settled, all cancelled, no successes. */
export function questionBankBatchPhase(batch: BatchCounts): QuestionBankBatchPhase {
  if (batch.active > 0) {
    return batch.completed === 0 && batch.failed === 0 && batch.cancelled === 0
      ? 'pending'
      : 'running';
  }
  if (batch.failed > 0 && batch.completed === 0) return 'failed';
  if (batch.cancelled > 0 && batch.completed === 0 && batch.failed === 0) return 'cancelled';
  if (batch.completed > 0 && (batch.failed > 0 || batch.cancelled > 0)) return 'partial';
  return 'completed';
}

/** A batch no longer needs polling only once it has no active children. */
export function isTerminalBatchPhase(phase: QuestionBankBatchPhase): boolean {
  return phase !== 'pending' && phase !== 'running';
}

/** Failed AND cancelled children can be re-enqueued (retry-failed batches both),
 * but only once the batch has stopped. */
export function canRetryBatch(batch: BatchCounts): boolean {
  return batch.active === 0 && (batch.failed > 0 || batch.cancelled > 0);
}

/** A batch can be cancelled while it still has active children. */
export function canCancelBatch(batch: BatchCounts): boolean {
  return batch.active > 0;
}
