export type BucketDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

/* Question type codes are open data (predefined or institute-defined). */
export type QuestionType = string;

export interface BankBucket {
  questionType: QuestionType;
  difficulty: BucketDifficulty;
  count: number;
}

export interface BankConfig {
  questionTypes: readonly QuestionType[];
  count: number;
  difficultyDistribution?: Partial<Record<BucketDifficulty, number>>;
}

export const QUESTION_TYPES: readonly QuestionType[] = ['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'];
export const DIFFICULTIES: BucketDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const DEFAULT_DIST: Record<BucketDifficulty, number> = { EASY: 0, MEDIUM: 100, HARD: 0 };

/** Allocate `count` across every (type, difficulty) cell via largest-remainder,
 * so bucket counts always sum to exactly `count` and the requested types and
 * difficulty distribution survive small counts. */
export function buildBankBuckets(config: BankConfig): BankBucket[] {
  const { questionTypes, count } = config;
  const dist = { ...DEFAULT_DIST, ...config.difficultyDistribution };

  const cells = questionTypes.flatMap((questionType) =>
    DIFFICULTIES.map((difficulty) => ({
      questionType,
      difficulty,
      // A type's share is `count / questionTypes.length`, sliced by difficulty %.
      weight: (count * (dist[difficulty] ?? 0)) / (100 * questionTypes.length),
    })),
  );

  const buckets = cells.map((c) => ({ ...c, count: Math.floor(c.weight) }));
  let remaining = count - buckets.reduce((sum, b) => sum + b.count, 0);

  const byLargestFraction = [...buckets].sort(
    (a, b) => b.weight - b.count - (a.weight - a.count),
  );
  for (const bucket of byLargestFraction) {
    if (remaining <= 0) break;
    bucket.count += 1;
    remaining -= 1;
  }

  return buckets
    .filter((b) => b.count > 0)
    .map(({ questionType, difficulty, count }) => ({ questionType, difficulty, count }));
}

interface BlueprintSectionLike {
  name?: string;
  questionType?: QuestionType | string | null;
  count?: number | null;
  difficultyDistribution?: Partial<Record<BucketDifficulty, number>> | null;
}

/** Derive target buckets from an approved paper pattern's sections.
 * Sections without a concrete questionType+count are skipped (topic-only or
 * unknown sections cannot target the worker's (type, difficulty, count) quotas).
 * Sections with a difficulty distribution split their count across difficulties. */
export function buildBucketsFromBlueprint(sections: BlueprintSectionLike[]): BankBucket[] {
  const buckets: BankBucket[] = [];
  for (const section of sections) {
    if (!section.questionType || !section.count || section.count <= 0) continue;
    const dist = section.difficultyDistribution ?? { EASY: 0, MEDIUM: 100, HARD: 0 };
    const safeDist: Partial<Record<BucketDifficulty, number>> = {};
    for (const d of DIFFICULTIES) {
      const pct = dist[d];
      if (typeof pct === 'number' && pct > 0) safeDist[d] = pct;
    }
    buckets.push(
      ...buildBankBuckets({
        questionTypes: [section.questionType as QuestionType],
        count: section.count,
        difficultyDistribution: Object.keys(safeDist).length > 0 ? safeDist : undefined,
      }),
    );
  }
  return buckets;
}