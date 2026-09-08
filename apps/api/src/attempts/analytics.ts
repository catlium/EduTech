// Pure, deterministic examination analytics. No NestJS/Zod imports — the
// service fetches rows and this module computes the response. Deliberately
// dependency-free so it is testable with node:test + type stripping (no enum
// or decorator syntax; erasable TS only).
//
// Inclusion rule: only EVALUATED (terminal) attempts count — SUBMITTED or
// EXPIRED with a non-null score. IN_PROGRESS / unevaluated attempts are
// excluded by the service's query, not here.

export interface AnalyticsAttempt {
  score: number;
  totalMarks: number | null;
}

export interface AnalyticsQuestion {
  questionId: string;
  stem: string;
  sortOrder: number;
  marks: number;
  questionType: string;
  difficulty: string;
  topicId: string | null;
  topicName: string | null;
  /** Number of evaluated responses that were saved (unanswered have none). */
  responses: number;
  correct: number;
  incorrect: number;
  marksAwarded: number;
}

export interface AssessmentAnalytics {
  summary: {
    evaluatedAttempts: number;
    averageScore: number | null;
    highestScore: number | null;
    lowestScore: number | null;
    totalMarks: number | null;
  };
  scoreDistribution: { score: number; count: number }[];
  questionAccuracy: {
    questionId: string;
    stem: string;
    sortOrder: number;
    marks: number;
    questionType: string;
    difficulty: string;
    responses: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    accuracy: number | null;
    marksAwarded: number;
    marksAvailable: number;
  }[];
  topicPerformance: {
    topicId: string;
    topicName: string;
    questionCount: number;
    responses: number;
    correctResponses: number;
    accuracy: number | null;
    marksEarned: number;
    marksAvailable: number;
  }[];
  difficultyPerformance: {
    difficulty: string;
    questionCount: number;
    responses: number;
    correctResponses: number;
    accuracy: number | null;
    marksEarned: number;
    marksAvailable: number;
  }[];
}

const DIFFICULTY_ORDER = ['EASY', 'MEDIUM', 'HARD'] as const;

function accuracy(correct: number, responses: number): number | null {
  return responses > 0 ? correct / responses : null;
}

export function buildAnalytics(
  attempts: AnalyticsAttempt[],
  questions: AnalyticsQuestion[],
): AssessmentAnalytics {
  const evaluated = attempts.length;
  const scores = attempts.map((a) => a.score).sort((a, b) => a - b);
  const total = scores.reduce((sum, s) => sum + s, 0);

  const distributionMap = new Map<number, number>();
  for (const s of scores) distributionMap.set(s, (distributionMap.get(s) ?? 0) + 1);
  const scoreDistribution = [...distributionMap.entries()]
    .map(([score, count]) => ({ score, count }))
    .sort((a, b) => a.score - b.score);

  const questionAccuracy = [...questions]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.questionId.localeCompare(b.questionId))
    .map((q) => {
      const unanswered = Math.max(0, evaluated - q.responses);
      return {
        questionId: q.questionId,
        stem: q.stem,
        sortOrder: q.sortOrder,
        marks: q.marks,
        questionType: q.questionType,
        difficulty: q.difficulty,
        responses: q.responses,
        correctCount: q.correct,
        incorrectCount: q.incorrect,
        unansweredCount: unanswered,
        accuracy: accuracy(q.correct, q.responses),
        marksAwarded: q.marksAwarded,
        marksAvailable: q.marks * evaluated,
      };
    });

  const topicAgg = new Map<
    string,
    {
      name: string;
      questionCount: number;
      responses: number;
      correctResponses: number;
      marksEarned: number;
      marksAvailable: number;
    }
  >();
  const difficultyAgg = new Map<
    string,
    {
      questionCount: number;
      responses: number;
      correctResponses: number;
      marksEarned: number;
      marksAvailable: number;
    }
  >();
  for (const q of questions) {
    const key = { responses: q.responses, correct: q.correct, available: q.marks * evaluated };
    if (q.topicId) {
      const t = topicAgg.get(q.topicId) ?? {
        name: q.topicName ?? q.topicId,
        questionCount: 0,
        responses: 0,
        correctResponses: 0,
        marksEarned: 0,
        marksAvailable: 0,
      };
      t.questionCount += 1;
      t.responses += key.responses;
      t.correctResponses += key.correct;
      t.marksEarned += q.marksAwarded;
      t.marksAvailable += key.available;
      topicAgg.set(q.topicId, t);
    }
    const d = difficultyAgg.get(q.difficulty) ?? {
      questionCount: 0,
      responses: 0,
      correctResponses: 0,
      marksEarned: 0,
      marksAvailable: 0,
    };
    d.questionCount += 1;
    d.responses += key.responses;
    d.correctResponses += key.correct;
    d.marksEarned += q.marksAwarded;
    d.marksAvailable += key.available;
    difficultyAgg.set(q.difficulty, d);
  }

  const topicPerformance = [...topicAgg.entries()]
    .map(([topicId, t]) => ({
      topicId,
      topicName: t.name,
      questionCount: t.questionCount,
      responses: t.responses,
      correctResponses: t.correctResponses,
      accuracy: accuracy(t.correctResponses, t.responses),
      marksEarned: t.marksEarned,
      marksAvailable: t.marksAvailable,
    }))
    .sort((a, b) => a.topicName.localeCompare(b.topicName));

  const difficultyPerformance = [...difficultyAgg.entries()]
    .sort(
      (a, b) =>
        (DIFFICULTY_ORDER.indexOf(a[0] as (typeof DIFFICULTY_ORDER)[number]) ?? 3) -
          (DIFFICULTY_ORDER.indexOf(b[0] as (typeof DIFFICULTY_ORDER)[number]) ?? 3) || a[0].localeCompare(b[0]),
    )
    .map(([difficulty, d]) => ({
      difficulty,
      questionCount: d.questionCount,
      responses: d.responses,
      correctResponses: d.correctResponses,
      accuracy: accuracy(d.correctResponses, d.responses),
      marksEarned: d.marksEarned,
      marksAvailable: d.marksAvailable,
    }));

  return {
    summary: {
      evaluatedAttempts: evaluated,
      averageScore: evaluated > 0 ? Math.round((total / evaluated) * 100) / 100 : null,
      highestScore: evaluated > 0 ? scores[scores.length - 1] : null,
      lowestScore: evaluated > 0 ? scores[0] : null,
      totalMarks: attempts[0]?.totalMarks ?? null,
    },
    scoreDistribution,
    questionAccuracy,
    topicPerformance,
    difficultyPerformance,
  };
}