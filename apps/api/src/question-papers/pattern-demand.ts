import { flattenPatternRules, type PaperPatternStructure } from '@catlium/contracts';

/* Demand buckets for a paper's pattern: each section contributes its
 * PRESENTED count (M — for attempt-N-of-M sections the full M must sit in
 * the bank before N can be presented), split across its difficulty
 * distribution. Pure module, no NestJS, no DB: unit-testable with node:test.
 *
 * The caller subtracts the in-scope bank + pending exactly once, so these
 * are DEMAND amounts, never pre-computed shortages. Sections sharing a type
 * demand distinct questions (selection takes without replacement) — two
 * 3-question MCQ sections need 6 in the bank — so buckets merge per
 * (questionType, difficulty). */

export type DemandDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface DemandBucket {
  questionType: string;
  difficulty: DemandDifficulty;
  count: number;
}

const DIFFS: DemandDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const DEFAULT_DIST: Record<DemandDifficulty, number> = { EASY: 0, MEDIUM: 100, HARD: 0 };

export function buildPatternDemandBuckets(structure: PaperPatternStructure): DemandBucket[] {
  const demand = new Map<string, DemandBucket>();
  const add = (b: DemandBucket) => {
    if (b.count <= 0) return;
    const key = `${b.questionType}|${b.difficulty}`;
    const existing = demand.get(key);
    if (existing) existing.count += b.count;
    else demand.set(key, { ...b });
  };

  for (const rule of flattenPatternRules(structure)) {
    const required = rule.count ?? 0;
    const type = rule.questionType;
    if (!type || required <= 0) continue;
    /* Same default as paper-selection's pickForSection: a rule with no
     * distribution demands its count from MEDIUM. */
    const dist = rule.difficultyDistribution ?? DEFAULT_DIST;
    const share = DIFFS.filter((d) => (dist[d] ?? 0) > 0);
    if (share.length === 0) {
      add({ questionType: type, difficulty: 'MEDIUM', count: required });
      continue;
    }

    /* Largest-remainder allocation so the split always sums to `required`. */
    const totalW = share.reduce((sum, d) => sum + (dist[d] ?? 0), 0);
    const allocated: Record<DemandDifficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
    for (const d of share) allocated[d] = Math.floor((required * (dist[d] ?? 0)) / totalW);
    let remaining = required - share.reduce((sum, d) => sum + allocated[d], 0);
    for (const d of [...share].sort(
      (a, b) =>
        (required * (dist[b] ?? 0)) / totalW -
        allocated[b] -
        ((required * (dist[a] ?? 0)) / totalW - allocated[a]),
    )) {
      if (remaining <= 0) break;
      allocated[d] = (allocated[d] ?? 0) + 1;
      remaining -= 1;
    }
    for (const d of share) add({ questionType: type, difficulty: d, count: allocated[d] ?? 0 });
  }

  return [...demand.values()];
}
