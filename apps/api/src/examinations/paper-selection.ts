import type {
  PatternCoverageSection,
  PatternCoverageStatus,
} from '@catlium/contracts';

/* Paper-pattern → assessment selection logic. Pure module, no NestJS, no DB:
 * unit-testable with node:test. Drives both selection modes:
 *   - Mode A (auto): planAutoSelection — pick bank questions per pattern section.
 *   - Mode B (manual): computePatternCoverage — live per-section status as a
 *     teacher browses the bank and adds/removes questions.
 *
 * Pattern sections carry `count` (questions the paper PRESENTS, M) and — for
 * non-compulsory sections — `attemptCount` (questions a STUDENT attempts, N,
 * i.e. "attempt 2 of 3"). Selection always fills the presented set (M); the
 * preview/export renderer turns M + N into the "Attempt any N of M" line.
 */

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface PatternSectionInput {
  id: string;
  name: string;
  questionType?: string | null;
  count?: number | null;
  marksPerQuestion?: number | null;
  totalMarks?: number | null;
  compulsory?: boolean;
  attemptCount?: number | null;
  difficultyDistribution?: Partial<Record<Difficulty, number>> | null;
}

export interface CandidateQuestion {
  id: string;
  questionType: string;
  difficulty: Difficulty;
}

export interface SectionSelection {
  sectionId: string;
  name: string;
  questionType: string | null;
  marks: number;
  selected: string[];
  requested: number;
  found: number;
  shortages: string[];
}

export interface SelectionPlan {
  sections: SectionSelection[];
  totalSelected: number;
  totalMarks: number;
}

const DIFFICULTIES: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

/* Marks assigned per presented question. Prefer the explicit marksPerQuestion;
 * fall back to totalMarks split across the number a student must attempt
 * (attemptCount for optional sections, count otherwise) so attempting the
 * quota yields ≈totalMarks; default 1 (mirrors addQuestions' A5 default). */
function sectionMarks(s: PatternSectionInput): number {
  if (s.marksPerQuestion && s.marksPerQuestion > 0) return s.marksPerQuestion;
  if (s.totalMarks && s.totalMarks > 0) {
    const base =
      s.compulsory === false && s.attemptCount && s.attemptCount > 0 ? s.attemptCount : s.count;
    if (base && base > 0) return Math.max(1, Math.ceil(s.totalMarks / base));
  }
  return 1;
}

/* Grab `needed` question ids from the pool, preferring the section's difficulty
 * distribution. Any difficulty is a permitted fallback so a paper is never
 * blocked by a slightly-off-difficulty bank; a fallback records a shortage. */
function pickForSection(
  s: PatternSectionInput,
  pool: CandidateQuestion[],
  needed: number,
): { selected: string[]; shortages: string[] } {
  const dist = s.difficultyDistribution ?? { EASY: 0, MEDIUM: 100, HARD: 0 };
  const weights = DIFFICULTIES.map((d) => ({ d, w: dist[d] ?? 0 }));

  // Allocate `needed` across difficulties (largest remainder), then fill each
  // bucket; leftover slots roll into lower-priority difficulties.
  const allocated: Record<Difficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
  const totalW = weights.reduce((sum, x) => sum + x.w, 0);
  if (totalW > 0) {
    weights.forEach(({ d, w }) => {
      const share = (needed * w) / totalW;
      const n = Math.floor(share);
      allocated[d] = n;
    });
    let remaining = needed - DIFFICULTIES.reduce((sum, d) => sum + allocated[d], 0);
    const byFraction = [...weights]
      .map(({ d, w }) => ({ d, frac: (needed * w) / totalW - allocated[d] }))
      .sort((a, b) => b.frac - a.frac);
    for (const { d } of byFraction) {
      if (remaining <= 0) break;
      allocated[d] += 1;
      remaining -= 1;
    }
  }

  const selected: string[] = [];
  const shortages: string[] = [];
  const remainingPool = [...pool];

  weights.forEach(({ d }) => {
    const limit = allocated[d];
    let picked = 0;
    /* Only this difficulty may satisfy this bucket; the per-difficulty pass
     * must not consume questions meant for a later bucket. */
    for (let idx = 0; idx < remainingPool.length && picked < limit; ) {
      const q = remainingPool[idx]!;
      if (q.difficulty !== d) {
        idx += 1;
        continue;
      }
      selected.push(q.id);
      remainingPool.splice(idx, 1);
      picked += 1;
      if (picked >= limit) break;
    }
    if (picked < limit) {
      shortages.push(`${s.questionType} ${d}: only ${picked} of ${limit} available`);
      for (let idx = 0; idx < remainingPool.length && picked < limit; ) {
        selected.push(remainingPool[idx]!.id);
        remainingPool.splice(idx, 1);
        picked += 1;
        shortages.push('filled with different difficulty than requested');
      }
    }
  });
    {
      const limit = needed - selected.length;
      if (limit > 0) {
        let picked = 0;
        for (let idx = 0; idx < remainingPool.length && picked < limit; ) {
          selected.push(remainingPool[idx]!.id);
          remainingPool.splice(idx, 1);
          picked += 1;
          shortages.push('no matching difficulty available');
        }
      }
    }

  return { selected, shortages };
}

export function planAutoSelection(
  sections: PatternSectionInput[],
  candidates: CandidateQuestion[],
  takenIds: ReadonlySet<string> = new Set(),
): SelectionPlan {
  let pool = candidates.filter((c) => !takenIds.has(c.id));
  const sectionsOut: SectionSelection[] = [];
  let totalSelected = 0;
  let totalMarks = 0;

  for (const s of sections) {
    const result: SectionSelection = {
      sectionId: s.id,
      name: s.name,
      questionType: s.questionType ?? null,
      marks: sectionMarks(s),
      selected: [],
      requested: 0,
      found: 0,
      shortages: [],
    };

    if (!s.questionType || !s.count || s.count <= 0) {
      result.shortages.push(
        s.questionType
          ? 'No presented-count (count) specified'
          : 'No question type specified',
      );
      sectionsOut.push(result);
      continue;
    }

    result.requested = s.count;
    const matches = pool.filter((c) => c.questionType === s.questionType);
    const { selected, shortages } = pickForSection(s, matches, s.count);
    result.selected = selected;
    result.found = selected.length;
    result.shortages = shortages;
    const consumed = new Set(selected);
    pool = pool.filter((c) => !consumed.has(c.id));
    totalSelected += selected.length;
    totalMarks += selected.length * result.marks;
    sectionsOut.push(result);
  }

  return { sections: sectionsOut, totalSelected, totalMarks };
}

// ── Mode B / coverage ───────────────────────────────────────────────

export interface LinkedQuestionInput {
  section: string;
  questionType: string;
  marks: number;
}

export function computePatternCoverage(
  sections: PatternSectionInput[],
  links: LinkedQuestionInput[],
): PatternCoverageSection[] {
  const rows: PatternCoverageSection[] = [];
  const linksBySection = new Map<string, LinkedQuestionInput[]>();
  for (const link of links) {
    const bucket = linksBySection.get(link.section) ?? [];
    bucket.push(link);
    linksBySection.set(link.section, bucket);
  }

  for (const s of sections) {
    const present = linksBySection.get(s.name) ?? [];
    const requiredCount = s.count && s.count > 0 ? s.count : (s.attemptCount ?? 0);
    const attemptCount =
      s.compulsory === false && s.attemptCount && s.attemptCount > 0
        ? s.attemptCount
        : requiredCount;
    const marks = sectionMarks(s);
    const presentMarks = present.reduce((sum, l) => sum + l.marks, 0);
    const mismatches =
      s.questionType && s.questionType.length > 0
        ? present.filter((l) => l.questionType !== s.questionType).length
        : 0;

    let status: PatternCoverageStatus = 'OK';
    let message: string | null = null;
    if (present.length < requiredCount) {
      status = 'SHORT';
      message = `${present.length} of ${requiredCount} questions added`;
    } else if (s.count && present.length > s.count) {
      status = 'EXCESS';
      message = `${present.length} is more than the ${s.count} questions the paper presents`;
    } else if (mismatches > 0) {
      status = 'TYPE_MISMATCH';
      message = `${mismatches} question(s) are not ${s.questionType}`;
    }

    rows.push({
      name: s.name,
      questionType: s.questionType ?? null,
      requiredCount,
      attemptCount,
      requiredMarks: attemptCount * marks,
      presentCount: present.length,
      presentMarks,
      status,
      message,
    });
  }

  const unassigned = links.filter(
    (l) => !sections.some((s) => s.name === l.section),
  );
  if (unassigned.length > 0) {
    rows.push({
      name: 'Unassigned',
      questionType: null,
      requiredCount: 0,
      attemptCount: 0,
      requiredMarks: 0,
      presentCount: unassigned.length,
      presentMarks: unassigned.reduce((sum, l) => sum + l.marks, 0),
      status: 'TYPE_MISMATCH',
      message: 'Not part of any pattern section',
    });
  }

  return rows;
}