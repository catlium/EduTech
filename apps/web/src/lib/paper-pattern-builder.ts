
/* ── Paper Pattern Builder model ─────────────────────────────────────────────
   The backend stores a flat sections[] each with ONE question type. The
   builder presents sections that group multiple question-type rules, then
   flattens on save and re-groups on load by the derived section name
   "${sectionName} — ${TYPE}" (a " · N" suffix dedupes repeated rules). */

export interface Difficulty {
  EASY: number | "";
  MEDIUM: number | "";
  HARD: number | "";
}

export interface TopicRow {
  name: string;
  percentage: number | "";
}

export interface Rule {
  id: string;
  questionType: string;
  count: number | null;
  marksPerQuestion: number | null;
  difficulty: Difficulty;
  topics: TopicRow[];
}

export interface Section {
  id: string;
  name: string;
  compulsory: boolean;
  attemptCount: number | null;
  rules: Rule[];
}

export interface BackendSection {
  id: string;
  name: string;
  questionType?: string;
  count?: number | null;
  marksPerQuestion?: number | null;
  totalMarks?: number | null;
  compulsory: boolean;
  attemptCount?: number | null;
  difficultyDistribution?: { EASY: number; MEDIUM: number; HARD: number } | null;
  topicDistribution?: { name: string; percentage?: number | null }[] | null;
}

export const TYPE_OPTIONS: string[] = ["", "MCQ", "TRUE_FALSE", "FILL_IN_BLANK"];
export const TYPE_LABELS: Record<string, string> = {
  MCQ: "MCQ",
  TRUE_FALSE: "True/False",
  FILL_IN_BLANK: "Fill in the Blank",
};

export const STEM_RE = /^(.*) — (.+?)(?: · \d+)?$/;

export function emptyRule(): Rule {
  return {
    id: crypto.randomUUID(),
    questionType: "",
    count: null,
    marksPerQuestion: null,
    difficulty: { EASY: "", MEDIUM: "", HARD: "" },
    topics: [],
  };
}

export function emptySection(): Section {
  return {
    id: crypto.randomUUID(),
    name: "",
    compulsory: true,
    attemptCount: null,
    rules: [emptyRule()],
  };
}

export function buildInstructions(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function ruleSubtotal(r: Rule): number | null {
  if (r.count == null || r.marksPerQuestion == null) return null;
  return r.count * r.marksPerQuestion;
}

export function computeTotals(sections: Section[]) {
  let questions = 0;
  let marks = 0;
  let uncertain = false;
  let configuredSections = 0;
  for (const s of sections) {
    let hasRule = false;
    for (const r of s.rules) {
      const configured = r.questionType !== "" || r.count != null || r.marksPerQuestion != null;
      if (!configured) continue;
      hasRule = true;
      if (r.count == null || r.marksPerQuestion == null) uncertain = true;
      questions += r.count ?? 0;
      marks += (r.count ?? 0) * (r.marksPerQuestion ?? 0);
    }
    if (hasRule) configuredSections += 1;
  }
  return { sections: configuredSections, questions, marks, uncertain };
}

export function difficultySum(d: Difficulty): number {
  let sum = 0;
  for (const v of [d.EASY, d.MEDIUM, d.HARD]) sum += v === "" ? 0 : v;
  return sum;
}

export function topicPercentSum(topics: TopicRow[]): number {
  let sum = 0;
  for (const t of topics) sum += t.percentage === "" ? 0 : t.percentage;
  return sum;
}

/** Flatten builder sections+rules onto the backend structure model: each rule
    becomes one backend section (the backend stores one question type per
    section). Difficulty/topics belong to the rule. */
export function flattenSections(sections: Section[]): BackendSection[] {
  const used = new Set<string>();
  const unique = (base: string) => {
    const raw = base.trim();
    let name = raw;
    let i = 1;
    while (used.has(name)) {
      i += 1;
      name = `${raw} · ${i}`;
    }
    used.add(name);
    return name;
  };

  const out: BackendSection[] = [];
  for (const s of sections) {
    const sectionName = s.name.trim();
    if (!sectionName) continue;
    for (const r of s.rules) {
      const configured = r.questionType !== "" || r.count != null || r.marksPerQuestion != null;
      if (!configured) continue;
      const difficultyDone =
        r.difficulty.EASY !== "" && r.difficulty.MEDIUM !== "" && r.difficulty.HARD !== "";
      const topics = r.topics
        .filter((t) => t.name.trim())
        .map((t) => ({
          name: t.name.trim(),
          percentage: t.percentage === "" ? null : t.percentage,
        }));
      out.push({
        id: crypto.randomUUID(),
        name: r.questionType ? unique(`${sectionName} — ${r.questionType}`) : unique(sectionName),
        questionType: r.questionType || undefined,
        count: r.count,
        marksPerQuestion: r.marksPerQuestion,
        compulsory: s.compulsory,
        attemptCount: s.attemptCount,
        difficultyDistribution: difficultyDone
          ? {
              EASY: r.difficulty.EASY as number,
              MEDIUM: r.difficulty.MEDIUM as number,
              HARD: r.difficulty.HARD as number,
            }
          : null,
        topicDistribution: topics.length ? topics : null,
      });
    }
  }
  return out;
}

/** Reverse of flatten: rebuild sections+rules from the persisted backend
    sections by grouping on the "${name} — ${TYPE}" suffix. */
export function parseBackendSections(secs: BackendSection[]): Section[] {
  const groups: { stem: string; items: BackendSection[] }[] = [];
  const byStem = new Map<string, { stem: string; items: BackendSection[] }>();
  for (const sec of secs) {
    const m = STEM_RE.exec(sec.name);
    const stem = m ? m[1].trim() : sec.name.trim();
    let g = byStem.get(stem);
    if (!g) {
      g = { stem, items: [] };
      byStem.set(stem, g);
      groups.push(g);
    }
    g.items.push(sec);
  }
  return groups.map((g) => {
    const first = g.items[0]!;
    return {
      id: crypto.randomUUID(),
      name: g.stem,
      compulsory: first.compulsory,
      attemptCount: first.attemptCount ?? null,
      rules: g.items.map((sec) => {
        const m = STEM_RE.exec(sec.name);
        return {
          id: crypto.randomUUID(),
          questionType: (m ? m[2] : "") as Rule["questionType"],
          count: sec.count ?? null,
          marksPerQuestion: sec.marksPerQuestion ?? null,
          difficulty: {
            EASY: sec.difficultyDistribution?.EASY ?? "",
            MEDIUM: sec.difficultyDistribution?.MEDIUM ?? "",
            HARD: sec.difficultyDistribution?.HARD ?? "",
          },
          topics: (sec.topicDistribution ?? []).map((t) => ({
            name: t.name,
            percentage: t.percentage ?? "",
          })),
        };
      }),
    };
  });
}

export function collectIssues(sections: Section[]): string[] {
  const issues: string[] = [];
  for (const s of sections) {
    const name = s.name.trim() || "(untitled section)";
    s.rules.forEach((r) => {
      const ruleLabel = `${name} · ${r.questionType ? TYPE_LABELS[r.questionType] : "Mixed"}`;
      if (r.count == null && r.marksPerQuestion == null && r.questionType === "") return;
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
      const hasPercent = r.topics.some((t) => t.percentage !== "");
      if (topicCount > 0 && hasPercent && topicPercentSum(r.topics) !== 100) {
        issues.push(
          `${ruleLabel}: topic distribution must total 100% (got ${topicPercentSum(r.topics)}%)`,
        );
      }
    });
    if (!s.compulsory && s.attemptCount == null) {
      issues.push(`${name}: optional section must declare how many questions to attempt`);
    }
  }
  return issues;
}