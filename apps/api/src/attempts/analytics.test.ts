// Phase 12 analytics unit tests — deterministic fixtures, no AI, no NestJS.
// Run: node --test apps/api/src/attempts/analytics.test.ts  (Node >= 22.6 with
// type stripping; the sibling import uses the .js->.ts rewrite).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalytics } from './analytics.ts';
import type { AnalyticsAttempt, AnalyticsQuestion } from './analytics.ts';

function q(
  id: string,
  overrides: Partial<AnalyticsQuestion> = {},
): AnalyticsQuestion {
  return {
    questionId: id,
    stem: `stem ${id}`,
    sortOrder: 1,
    marks: 1,
    questionType: 'MCQ',
    difficulty: 'EASY',
    topicId: '90000000-0000-4000-8000-000000000001',
    topicName: 'Rational Numbers',
    responses: 0,
    correct: 0,
    incorrect: 0,
    marksAwarded: 0,
    ...overrides,
  };
}

function attempt(score: number, totalMarks: number | null = 4): AnalyticsAttempt {
  return { score, totalMarks };
}

test('empty analytics: no evaluated attempts, no questions', () => {
  const a = buildAnalytics([], []);
  assert.equal(a.summary.evaluatedAttempts, 0);
  assert.equal(a.summary.averageScore, null);
  assert.equal(a.summary.highestScore, null);
  assert.equal(a.summary.lowestScore, null);
  assert.equal(a.summary.totalMarks, null);
  assert.deepEqual(a.scoreDistribution, []);
  assert.deepEqual(a.questionAccuracy, []);
  assert.deepEqual(a.topicPerformance, []);
  assert.deepEqual(a.difficultyPerformance, []);
});

test('no evaluated attempts: questions may still arrive with all-zero stats', () => {
  const a = buildAnalytics([], [
    q('q1', { difficulty: 'EASY' }),
  ]);
  assert.equal(a.summary.evaluatedAttempts, 0);
  const entry = a.questionAccuracy.find((x) => x.questionId === 'q1');
  assert.ok(entry);
  assert.equal(entry.responses, 0);
  assert.equal(entry.unansweredCount, 0);
  assert.equal(entry.accuracy, null);
  assert.deepEqual(a.difficultyPerformance, [
    {
      difficulty: 'EASY',
      questionCount: 1,
      responses: 0,
      correctResponses: 0,
      accuracy: null,
      marksEarned: 0,
      marksAvailable: 0,
    },
  ]);
});

test('one evaluated attempt: score, per-question accuracy, unanswered not correct', () => {
  const a = buildAnalytics([attempt(2, 3)], [
    q('q1', { responses: 1, correct: 1, marksAwarded: 1 }),
    q('q2', { responses: 0, correct: 0 }),
    q('q3', { responses: 1, correct: 1, questionType: 'TRUE_FALSE', marksAwarded: 1 }),
  ]);
  assert.equal(a.summary.evaluatedAttempts, 1);
  assert.equal(a.summary.averageScore, 2);
  assert.equal(a.summary.highestScore, 2);
  assert.equal(a.summary.lowestScore, 2);
  assert.equal(a.summary.totalMarks, 3);
  assert.deepEqual(a.scoreDistribution, [{ score: 2, count: 1 }]);
  const q2 = a.questionAccuracy.find((x) => x.questionId === 'q2');
  assert.ok(q2);
  assert.equal(q2.responses, 0);
  assert.equal(q2.correctCount, 0);
  assert.equal(q2.unansweredCount, 1);
  assert.equal(q2.accuracy, null);
  assert.equal(a.questionAccuracy.reduce((s, x) => s + x.marksAwarded, 0), 2);
});

test('multiple evaluated attempts: averages, distribution, mixed question types, unanswered', () => {
  // Matches attempts_e2e.sh fixture: SUBMITTED 3/4 (1 MCQ wrong-picked saved as
  // correct answer MC1B, TF + FIB correct, one MCQ unanswered) + EXPIRED 0/4.
  const questions = [
    q('q1', { stem: 'Which set includes fractions and repeating decimals?', questionType: 'MCQ', difficulty: 'EASY', responses: 1, correct: 1, marksAwarded: 1 }),
    q('q2', { stem: 'q2 mcq', questionType: 'MCQ', difficulty: 'EASY', responses: 0, correct: 0 }),
    q('q3', { stem: 'tf q', questionType: 'TRUE_FALSE', difficulty: 'MEDIUM', responses: 1, correct: 1, marksAwarded: 1 }),
    q('q4', { stem: 'fib q', questionType: 'FILL_IN_BLANK', difficulty: 'EASY', responses: 1, correct: 1, marksAwarded: 1 }),
  ];
  const a = buildAnalytics([attempt(3), attempt(0)], questions);

  assert.equal(a.summary.evaluatedAttempts, 2);
  assert.equal(a.summary.averageScore, 1.5);
  assert.equal(a.summary.highestScore, 3);
  assert.equal(a.summary.lowestScore, 0);
  assert.equal(a.summary.totalMarks, 4);
  assert.deepEqual(a.scoreDistribution, [
    { score: 0, count: 1 },
    { score: 3, count: 1 },
  ]);

  const q1 = a.questionAccuracy.find((x) => x.questionId === 'q1');
  assert.ok(q1);
  assert.equal(q1.responses, 1);
  assert.equal(q1.correctCount, 1);
  assert.equal(q1.incorrectCount, 0);
  assert.equal(q1.unansweredCount, 1);
  assert.equal(q1.accuracy, 1);
  const q2 = a.questionAccuracy.find((x) => x.questionId === 'q2');
  assert.ok(q2);
  assert.equal(q2.unansweredCount, 2);
  assert.equal(q2.accuracy, null);
});

test('per-question accuracy with correct AND incorrect responses', () => {
  const a = buildAnalytics([attempt(1), attempt(0), attempt(1)], [
    q('q1', { responses: 3, correct: 2, incorrect: 1, marksAwarded: 2 }),
  ]);
  const q1 = a.questionAccuracy.find((x) => x.questionId === 'q1');
  assert.ok(q1);
  assert.equal(q1.correctCount, 2);
  assert.equal(q1.incorrectCount, 1);
  assert.equal(q1.unansweredCount, 0);
  assert.equal(q1.accuracy, 2 / 3);
  assert.equal(q1.marksAwarded, 2);
  assert.equal(q1.marksAvailable, 3);
});

test('topic aggregation: multiple topics, null-topic questions excluded', () => {
  const a = buildAnalytics([attempt(2, 3)], [
    q('t1q1', { topicId: 't1', topicName: 'Alpha', responses: 1, correct: 1, marksAwarded: 1 }),
    q('t1q2', { topicId: 't1', topicName: 'Alpha', responses: 1, correct: 0, incorrect: 1 }),
    q('t2q1', { topicId: 't2', topicName: 'Beta', responses: 1, correct: 1, marksAwarded: 1 }),
    q('nul', { topicId: null, topicName: null }),
  ]);
  assert.equal(a.topicPerformance.length, 2);
  const alpha = a.topicPerformance.find((t) => t.topicId === 't1');
  const beta = a.topicPerformance.find((t) => t.topicId === 't2');
  assert.ok(alpha && beta);
  assert.equal(alpha.questionCount, 2);
  assert.equal(alpha.responses, 2);
  assert.equal(alpha.correctResponses, 1);
  assert.equal(alpha.accuracy, 0.5);
  assert.equal(alpha.marksEarned, 1);
  assert.equal(alpha.marksAvailable, 2);
  assert.equal(beta.questionCount, 1);
  assert.equal(beta.marksAvailable, 1);
});

test('difficulty aggregation: EASY/MEDIUM/HARD ordering and metrics', () => {
  const a = buildAnalytics([attempt(2, 3)], [
    q('e1', { difficulty: 'EASY', responses: 1, correct: 1, marksAwarded: 1 }),
    q('e2', { difficulty: 'EASY', responses: 1, correct: 0, incorrect: 1 }),
    q('h1', { difficulty: 'HARD', responses: 1, correct: 1, marksAwarded: 1 }),
  ]);
  assert.deepEqual(
    a.difficultyPerformance.map((d) => d.difficulty),
    ['EASY', 'HARD'],
  );
  const easy = a.difficultyPerformance.find((d) => d.difficulty === 'EASY');
  assert.ok(easy);
  assert.equal(easy.questionCount, 2);
  assert.equal(easy.responses, 2);
  assert.equal(easy.correctResponses, 1);
  assert.equal(easy.accuracy, 0.5);
  assert.equal(easy.marksEarned, 1);
  assert.equal(easy.marksAvailable, 2);
});

test('zero available marks: no division-by-zero, valid response', () => {
  const a = buildAnalytics([attempt(0, 0), attempt(0, 0)], [
    q('q1', { marks: 0, responses: 0, correct: 0 }),
  ]);
  assert.equal(a.summary.totalMarks, 0);
  assert.equal(a.summary.averageScore, 0);
  assert.equal(a.questionAccuracy[0].accuracy, null);
  assert.equal(a.questionAccuracy[0].marksAvailable, 0);
  assert.deepEqual(a.difficultyPerformance[0].marksAvailable, 0);
});

test('consistency invariant: per-question correct+incorrect === responses and responses+unanswered === evaluated attempts', () => {
  const evaluated = 4;
  const a = buildAnalytics(
    [attempt(0), attempt(1), attempt(2), attempt(4)],
    [
      q('a', { responses: 3, correct: 2, incorrect: 1, marksAwarded: 2 }),
      q('b', { responses: 1, correct: 1, marksAwarded: 1 }),
      q('c', { responses: 0, correct: 0 }),
      q('d', { responses: 4, correct: 3, incorrect: 1, marksAwarded: 3 }),
    ],
  );
  for (const x of a.questionAccuracy) {
    assert.equal(x.correctCount + x.incorrectCount, x.responses);
    assert.equal(x.responses + x.unansweredCount, evaluated);
  }
  assert.equal(a.summary.evaluatedAttempts, evaluated);
});

test('score distribution: repeated scores grouped with count>1, ordered ascending', () => {
  const a = buildAnalytics([attempt(3), attempt(3), attempt(0), attempt(1)], [
    q('x', { marks: 3, responses: 2, correct: 2, marksAwarded: 2 }),
  ]);
  assert.deepEqual(a.scoreDistribution, [
    { score: 0, count: 1 },
    { score: 1, count: 1 },
    { score: 3, count: 2 },
  ]);
  assert.equal(a.summary.averageScore, 1.75);
  assert.equal(a.summary.highestScore, 3);
  assert.equal(a.summary.lowestScore, 0);
});

test('average rounding to 2 decimals for repeating results', () => {
  const a = buildAnalytics([attempt(1), attempt(1), attempt(2)], []);
  assert.equal(a.summary.averageScore, 1.33);
  assert.equal(a.summary.evaluatedAttempts, 3);
});

test('privacy: analytics expose no answer keys or per-student identifiers', () => {
  const a = buildAnalytics([attempt(3)], [
    q('q1', { questionType: 'MCQ', responses: 1, correct: 1, marksAwarded: 1 }),
    q('q2', { questionType: 'TRUE_FALSE', responses: 0, correct: 0 }),
    q('q3', { questionType: 'FILL_IN_BLANK', responses: 1, correct: 1, marksAwarded: 1 }),
  ]);
  const blob = JSON.stringify(a);
  assert.ok(!blob.includes('correctChoiceId'));
  assert.ok(!blob.includes('correctAnswer'));
  assert.ok(!blob.includes('acceptableAnswers'));
  assert.ok(!blob.includes('studentEmail'));
  assert.ok(!blob.includes('studentName'));
  assert.ok(!blob.includes('explanation'));
});