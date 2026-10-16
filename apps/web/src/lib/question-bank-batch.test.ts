import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canCancelBatch,
  canRetryBatch,
  isTerminalBatchPhase,
  questionBankBatchPhase,
  type QuestionBankBatchPhase,
} from './question-bank-batch.ts';

function counts(active: number, completed: number, failed: number, cancelled: number) {
  return { active, completed, failed, cancelled };
}

// B3 regression: the phase must follow the real QuestionBankBatchResponse
// child-job counts, so every generation surface shows the same state.
const PHASES: Array<[string, ReturnType<typeof counts>, QuestionBankBatchPhase]> = [
  ['nothing settled yet is pending', counts(3, 0, 0, 0), 'pending'],
  ['active + settled is running', counts(1, 2, 0, 0), 'running'],
  ['active + a failure is still running', counts(1, 0, 1, 0), 'running'],
  ['all settled successfully is completed', counts(0, 3, 0, 0), 'completed'],
  ['success + failure is partial', counts(0, 2, 1, 0), 'partial'],
  ['success + cancellation is partial', counts(0, 1, 0, 1), 'partial'],
  ['only failures is failed', counts(0, 0, 2, 0), 'failed'],
  ['only cancellations is cancelled', counts(0, 0, 0, 2), 'cancelled'],
  ['failure + cancellation with no success is failed', counts(0, 0, 1, 1), 'failed'],
];

for (const [name, batch, expected] of PHASES) {
  test(`questionBankBatchPhase: ${name}`, () => {
    assert.equal(questionBankBatchPhase(batch), expected);
  });
}

test('isTerminalBatchPhase is false only for pending/running', () => {
  const nonTerminal = new Set<QuestionBankBatchPhase>(['pending', 'running']);
  for (const [, batch, phase] of PHASES) {
    assert.equal(
      isTerminalBatchPhase(phase),
      !nonTerminal.has(questionBankBatchPhase(batch)),
      `phase ${phase}`,
    );
  }
  assert.equal(isTerminalBatchPhase('pending'), false);
  assert.equal(isTerminalBatchPhase('running'), false);
  assert.equal(isTerminalBatchPhase('completed'), true);
});

test('canRetryBatch: only settled batches with failed/cancelled children', () => {
  assert.equal(canRetryBatch(counts(0, 0, 2, 0)), true, 'all failed');
  assert.equal(canRetryBatch(counts(0, 2, 1, 0)), true, 'partial');
  assert.equal(canRetryBatch(counts(0, 0, 0, 1)), true, 'cancelled');
  assert.equal(canRetryBatch(counts(0, 3, 0, 0)), false, 'all completed');
  assert.equal(canRetryBatch(counts(1, 0, 1, 0)), false, 'still active');
  assert.equal(canRetryBatch(counts(2, 0, 0, 0)), false, 'still pending');
});

test('canCancelBatch: only batches with active children', () => {
  assert.equal(canCancelBatch(counts(1, 0, 0, 0)), true);
  assert.equal(canCancelBatch(counts(1, 2, 0, 0)), true);
  assert.equal(canCancelBatch(counts(0, 3, 0, 0)), false);
  assert.equal(canCancelBatch(counts(0, 0, 2, 0)), false);
});
