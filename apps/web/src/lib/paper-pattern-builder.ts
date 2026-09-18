/* ── Paper Pattern Builder model ─────────────────────────────────────────────
   The backend stores sections[] each with questionTypes[] (one rule per
   question type, carrying its own "attempt N of M" semantics). The builder
   presents sections that group multiple rules directly against that shape. */

export interface Difficulty {
  EASY: number | '';
  MEDIUM: number | '';
  HARD: number | '';
}

export interface TopicRow {
  name: string;
  percentage: number | '';
}

export interface Rule {
  id: string;
  questionType: string;
  count: number | null;
  marksPerQuestion: number | null;
  compulsory: boolean;
  attemptCount: number | null;
  difficulty: Difficulty;
  topics: TopicRow[];
}

export interface Section {
  id: string;
  name: string;
  rules: Rule[];
}

export interface BackendQuestionType {
  id: string;
  questionType?: string;
  count?: number | null;
  marksPerQuestion?: number | null;
  totalMarks?: number | null;
  compulsory: boolean;
  attemptCount?: number | null;
  difficultyDistribution?: { EASY: number; MEDIUM: number; HARD: number } | null;
  topicDistribution?: { name: string; percentage?: number | null }[] | null;
}

export interface BackendSection {
  id: string;
  name: string;
  questionTypes: BackendQuestionType[];
}

/** Resolve the display label for a question-type code. `labels` comes from the
 * /question-types API source (the single source of truth); codes that were
 * removed or deprecated fall back to the raw code so saved blueprints stay
 * readable and editable. Empty code = mixed/untyped rule. */
export function questionTypeLabel(code: string, labels?: Record<string, string>): string {
  return code === '' ? 'Mixed' : (labels?.[code] ?? code);
}

export function emptyRule(): Rule {
  return {
    id: crypto.randomUUID(),
    questionType: '',
    count: null,
    marksPerQuestion: null,
    compulsory: true,
    attemptCount: null,
    difficulty: { EASY: '', MEDIUM: '', HARD: '' },
    topics: [],
  };
}

export function emptySection(): Section {
  return {
    id: crypto.randomUUID(),
    name: '',
    rules: [emptyRule()],
  };
}

export function buildInstructions(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function ruleSubtotal(r: Rule): number | null {
  if (r.count == null || r.marksPerQuestion == null) return null;
  // Attempt-N-of-M rule: worth what a student can score (attemptCount × marks).
  const qty = !r.compulsory && r.attemptCount && r.attemptCount > 0 ? r.attemptCount : r.count;
  return qty * r.marksPerQuestion;
}

export function computeTotals(sections: Section[]) {
  let questions = 0;
  let marks = 0;
  let uncertain = false;
  let configuredSections = 0;
  for (const s of sections) {
    let hasRule = false;
    for (const r of s.rules) {
      const configured = r.questionType !== '' || r.count != null || r.marksPerQuestion != null;
      if (!configured) continue;
      hasRule = true;
      if (r.count == null || r.marksPerQuestion == null) uncertain = true;
      questions += r.count ?? 0;
      marks += ruleSubtotal(r) ?? 0;
    }
    if (hasRule) configuredSections += 1;
  }
  return { sections: configuredSections, questions, marks, uncertain };
}

export function difficultySum(d: Difficulty): number {
  let sum = 0;
  for (const v of [d.EASY, d.MEDIUM, d.HARD]) sum += v === '' ? 0 : v;
  return sum;
}

export function topicPercentSum(topics: TopicRow[]): number {
  let sum = 0;
  for (const t of topics) sum += t.percentage === '' ? 0 : t.percentage;
  return sum;
}

function ruleConfigured(r: Rule): boolean {
  return r.questionType !== '' || r.count != null || r.marksPerQuestion != null;
}

function ruleToBackend(r: Rule): BackendQuestionType {
  const difficultyDone =
    r.difficulty.EASY !== '' && r.difficulty.MEDIUM !== '' && r.difficulty.HARD !== '';
  const topics = r.topics
    .filter((t) => t.name.trim())
    .map((t) => ({
      name: t.name.trim(),
      percentage: t.percentage === '' ? null : t.percentage,
    }));
  return {
    id: crypto.randomUUID(),
    questionType: r.questionType || undefined,
    count: r.count,
    marksPerQuestion: r.marksPerQuestion,
    totalMarks: ruleSubtotal(r),
    compulsory: r.compulsory,
    attemptCount: r.attemptCount,
    difficultyDistribution: difficultyDone
      ? {
          EASY: r.difficulty.EASY as number,
          MEDIUM: r.difficulty.MEDIUM as number,
          HARD: r.difficulty.HARD as number,
        }
      : null,
    topicDistribution: topics.length ? topics : null,
  };
}

/** Map builder sections+rules onto the backend nested structure. Rules
    without any configuration are dropped; a questionTypes array must stay
    non-empty (the section is omitted otherwise). */
export function buildBackendSections(sections: Section[]): BackendSection[] {
  const out: BackendSection[] = [];
  for (const s of sections) {
    const sectionName = s.name.trim();
    if (!sectionName) continue;
    const rules = s.rules.filter(ruleConfigured).map(ruleToBackend);
    if (rules.length === 0) continue;
    out.push({ id: crypto.randomUUID(), name: sectionName, questionTypes: rules });
  }
  return out;
}

/** Rebuild builder sections from a persisted (nested) structure. Legacy flat
    sections (one rule declared directly on the section) still parse — the API
    normalizes old rows to nested, but keep the fallback for robustness. */
export function parseBackendSections(secs: BackendSection[]): Section[] {
  return secs.map((sec) => {
    const qts = Array.isArray(sec.questionTypes)
      ? sec.questionTypes
      : // Legacy flat section with rule fields hoisted onto the section.
        (() => {
          const legacy = sec as unknown as Partial<BackendQuestionType>;
          return [
            {
              id: crypto.randomUUID(),
              questionType: legacy.questionType,
              count: legacy.count ?? null,
              marksPerQuestion: legacy.marksPerQuestion ?? null,
              totalMarks: legacy.totalMarks ?? null,
              compulsory: legacy.compulsory ?? true,
              attemptCount: legacy.attemptCount ?? null,
              difficultyDistribution: legacy.difficultyDistribution ?? null,
              topicDistribution: legacy.topicDistribution ?? null,
            } as BackendQuestionType,
          ];
        })();
    return {
      id: crypto.randomUUID(),
      name: sec.name,
      rules: qts.map((q) => ({
        id: crypto.randomUUID(),
        questionType: q.questionType ?? '',
        count: q.count ?? null,
        marksPerQuestion: q.marksPerQuestion ?? null,
        compulsory: q.compulsory,
        attemptCount: q.attemptCount ?? null,
        difficulty: {
          EASY: q.difficultyDistribution?.EASY ?? '',
          MEDIUM: q.difficultyDistribution?.MEDIUM ?? '',
          HARD: q.difficultyDistribution?.HARD ?? '',
        },
        topics: (q.topicDistribution ?? []).map((t) => ({
          name: t.name,
          percentage: t.percentage ?? '',
        })),
      })),
    };
  });
}

export function collectIssues(sections: Section[], labels?: Record<string, string>): string[] {
  const issues: string[] = [];
  for (const s of sections) {
    const name = s.name.trim() || '(untitled section)';
    s.rules.forEach((r) => {
      const ruleLabel = `${name} · ${questionTypeLabel(r.questionType, labels)}`;
      if (r.count == null && r.marksPerQuestion == null && r.questionType === '') return;
      if (r.count != null && r.marksPerQuestion == null) {
        issues.push(`${ruleLabel}: marks per question not set`);
      }
      if (r.marksPerQuestion != null && r.count == null) {
        issues.push(`${ruleLabel}: question count not set`);
      }
      const diffSum = difficultySum(r.difficulty);
      if (diffSum > 0 && diffSum !== 100) {
        issues.push(`${ruleLabel}: difficulty must total 100% (got ${diffSum}%)`);
      }
      const topicCount = r.topics.filter((t) => t.name.trim()).length;
      const hasPercent = r.topics.some((t) => t.percentage !== '');
      if (topicCount > 0 && hasPercent && topicPercentSum(r.topics) !== 100) {
        issues.push(
          `${ruleLabel}: topic distribution must total 100% (got ${topicPercentSum(r.topics)}%)`,
        );
      }
      if (r.compulsory) {
        if (r.attemptCount != null && r.count != null && r.attemptCount !== r.count) {
          issues.push(
            `${ruleLabel}: compulsory rule must be fully attempted (attempt ${r.attemptCount} of ${r.count})`,
          );
        }
      } else {
        const presented = r.count ?? 0;
        if (r.attemptCount == null) {
          issues.push(`${ruleLabel}: optional rule must declare how many questions to attempt`);
        } else if (presented > 0 && r.attemptCount >= presented) {
          issues.push(
            `${ruleLabel}: attempt ${r.attemptCount} must be fewer than the ${presented} questions available`,
          );
        }
      }
    });
  }
  return issues;
}