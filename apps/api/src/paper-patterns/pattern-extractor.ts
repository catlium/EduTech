import { randomUUID } from 'node:crypto';

import {
  type PaperPatternQuestionType,
  type PaperPatternSection,
  type PaperPatternStructure,
  type PatternExtractionIssue,
  type PatternExtractionRuleProvenance,
  type PredefinedQuestionType,
} from '@catlium/contracts';

/* ── Deterministic paper-pattern extraction (Phase B) ────────────────
 * Pure rules, zero AI. Turns a flat list of processed blocks (an existing
 * paper) into a reviewable PaperPatternStructure. Anything ambiguous or
 * unparseable is left null and surfaced as an extraction issue — never
 * guessed. Structure is null only when no reliable pattern could be built
 * at all (no sections/questions detected). Difficulty/topic distributions
 * are NEVER derived (null = explicit unknown). */

export interface ExtractionBlock {
  id: string;
  kind: string;
  content: string;
  page: number;
}

export interface PatternExtractionResult {
  structure: PaperPatternStructure | null;
  issues: PatternExtractionIssue[];
  provenance: PatternExtractionRuleProvenance[];
  durationMinutesSource: 'HEADER' | 'UNKNOWN';
  totalMarksSource: 'HEADER' | 'SECTION_SUM' | 'UNKNOWN';
}

interface Line {
  text: string;
  blockId: string;
  page: number;
}

interface QuestionItem {
  label: string;
  marks: number | null;
  line: Line;
}

interface RuleBuilder {
  id: string;
  type: PredefinedQuestionType | undefined;
  items: QuestionItem[];
  lines: Line[];
  /* resolved per-rule after the section pass (see buildSectionRules) */
  compulsoryDefault?: boolean;
  attemptDefault: { n: number; m: number | null } | null;
  marksDefault: number | null;
}

const TYPE_KEYWORDS: Array<[RegExp, PredefinedQuestionType]> = [
  [
    /very[\s-]*short[\s-]*answer|one\s*word|answer\s+in\s*(?:a\s+)?few\s*words/i,
    'VERY_SHORT_ANSWER',
  ],
  [/short\s*answer/i, 'SHORT_ANSWER'],
  [/brief\s*answer|answer\s+in\s+brief|write\s+brief/i, 'BRIEF_ANSWER'],
  [/long\s*answer|essay\s|answer\s+in\s+detail/i, 'LONG_ANSWER'],
  [/match\s*(?:the\s+)?following/i, 'MATCH_THE_FOLLOWING'],
  [/true[\s/\\]*(?:or[\s/\\]*)?false|write\s*true/i, 'TRUE_FALSE'],
  [/fill[\s-]*in[\s-]*(?:the\s*)?blanks?/i, 'FILL_IN_BLANK'],
  [/case[\s-]*study|case[\s-]*based|unseen\s*passage/i, 'CASE_STUDY'],
  [/multiple\s*choice|\bmcq\b/i, 'MCQ'],
  [/numerical|number\s+problems?/i, 'NUMERICAL'],
  [/defin(?:e|ition)/i, 'DEFINITION'],
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
};

const SECTION_HEADING = /^(?:section|part)\s*[-–—:.]*\s*([a-z0-9]{1,3})[.)]?\b/i;
const DURATION_RE =
  /\b(\d{1,2})\s*(?:hours?|hrs?)\b(?:\s*(?:and\s+)?(\d{1,2})\s*(?:minutes?|mins?))?/i;
const DURATION_KEYWORD = /(?:time(?:\s+allowed)?|duration)\s*[:=]?\s*/i;
const MINUTES_ONLY = /\b(\d{2,4})\s*(?:minutes?|mins?)\b/i;
const M_MARKS = /^m\s*\.?\s*m\s*[:=.\-–—]?\s*(\d{1,4})\b/i;
const MAX_MARKS = /(?:max(?:\.|\s*imum)\s*marks?|total\s*marks?)\s*[:=\-–—.]?\s*(\d{1,4})\b/i;
const INLINE_MARKS = /\((\d{1,3})\s*marks?\)/i;
const TRAILING_MARKS = /\b(\d{1,3})\s*marks?\s*$/i;
const EQUAL_MARKS_EACH =
  /each(?:\s+question)?\s*(?:carries|is\s+of|is\s+worth|bears)\s*(\d{1,3})\s*marks?/i;
const ATTEMPT_OF = /attempt\s+(?:any\s+)?(\d{1,2})\s+of\s+the\s+following\s*[:.]?\s*(\d{1,3})/i;
const ATTEMPT_WORD =
  /(?:attempt|answer)\s+any\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/i;
const ATTEMPT_NUM = /(?:attempt|answer)\s+any\s+(\d{1,2})\b/i;
const COMPULSORY_PHRASE =
  /all\s+(?:the\s+)?questions?(?:\s+are)?\s+compulsory|compulsory\s+questions?/i;
const ITEM =
  /^\s*(?:(\d{1,3})\s*[.)]|\(\s*(\d{1,3})\s*\)|\bq(?:uestion)?\s*(\d{1,3})\s*[.)]?)\s+[\w(]/i;

// Keep per-rule extraction honest for papers that state how many to attempt.
function detectAttempt(text: string): { n: number; m: number | null } | null {
  const of = ATTEMPT_OF.exec(text);
  if (of) return { n: Number(of[1]), m: Number(of[2]) };
  const word = ATTEMPT_WORD.exec(text);
  if (word) return { n: WORD_NUMBERS[word[1].toLowerCase()], m: null };
  const num = ATTEMPT_NUM.exec(text);
  if (num) return { n: Number(num[1]), m: null };
  return null;
}

function detectType(text: string): PredefinedQuestionType | undefined {
  for (const [re, type] of TYPE_KEYWORDS) {
    if (re.test(text)) return type;
  }
  return undefined;
}

function detectInlineMarks(text: string): number | null {
  const inline = INLINE_MARKS.exec(text);
  if (inline) return Number(inline[1]);
  const trailing = TRAILING_MARKS.exec(text);
  if (trailing) return Number(trailing[1]);
  return null;
}

export function extractPaperPattern(blocks: ExtractionBlock[]): PatternExtractionResult {
  const issues: PatternExtractionIssue[] = [];
  const provenance: PatternExtractionRuleProvenance[] = [];

  const lines: Line[] = [];
  for (const block of blocks) {
    for (const raw of block.content.split(/\r?\n/)) {
      const text = raw.trim();
      if (text) lines.push({ text, blockId: block.id, page: block.page });
    }
  }

  // ── Global fields: duration + total marks from the paper header ──
  let durationMinutes: number | null = null;
  let headerTotal: number | null = null;
  for (const line of lines) {
    if (durationMinutes === null) {
      if (DURATION_KEYWORD.test(line.text)) {
        const m = DURATION_RE.exec(line.text);
        if (m) {
          const hours = Number(m[1]);
          const mins = m[2] ? Number(m[2]) : 0;
          if (hours >= 1 && hours <= 6 && mins >= 0 && mins < 60)
            durationMinutes = hours * 60 + mins;
        }
      } else {
        const m = MINUTES_ONLY.exec(line.text);
        if (m) {
          const mins = Number(m[1]);
          if (mins >= 30 && mins <= 360) durationMinutes = mins;
        }
      }
    }
    if (headerTotal === null) {
      const m = M_MARKS.exec(line.text) ?? MAX_MARKS.exec(line.text);
      if (m) headerTotal = Number(m[1]);
    }
  }

  // ── Split into sections on their headings ──────────────────────
  const sections: { heading: string; body: Line[] }[] = [];
  const preamble: Line[] = [];
  let current: { heading: string; body: Line[] } | null = null;
  for (const line of lines) {
    if (SECTION_HEADING.test(line.text)) {
      current = { heading: line.text, body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }

  // A global "all questions are compulsory" in the preamble applies to every
  // section (the common Indian-context exam paper phrasing).
  const paperCompulsory = preamble.some((l) => COMPULSORY_PHRASE.test(l.text));

  // Preamble yields the paper instructions (drops header/time/marks lines).
  const instructions: string[] = [];
  for (const line of preamble) {
    if (
      DURATION_KEYWORD.test(line.text) ||
      MINUTES_ONLY.test(line.text) ||
      M_MARKS.test(line.text) ||
      MAX_MARKS.test(line.text)
    ) {
      continue;
    }
    if (instructions.length >= 50) break;
    instructions.push(line.text.slice(0, 2000));
  }

  const patternSections: PaperPatternSection[] = [];
  const allPages = [...new Set(lines.map((l) => l.page))];

  for (const section of sections) {
    const rules = buildSectionRules(section, paperCompulsory, issues);
    if (rules.length === 0) {
      issues.push({
        code: 'SECTION_NO_RULES',
        message: `No question items detected in "${section.heading}"`,
        pages: [...new Set(section.body.map((l) => l.page))],
      });
      continue;
    }
    const sectionId = randomUUID();
    patternSections.push({
      id: sectionId,
      name: section.heading.trim().slice(0, 100),
      questionTypes: rules.map((r) => ruleToContract(r, issues)),
    });
    for (const rule of rules) {
      provenance.push({
        sectionId,
        ruleId: rule.id,
        blockIds: [...new Set(rule.lines.map((l) => l.blockId))],
        pages: [...new Set(rule.lines.map((l) => l.page))],
      });
    }
  }

  if (patternSections.length === 0) {
    issues.push({
      code: 'NO_QUESTIONS_FOUND',
      message:
        'No exam sections or question items were detected — the source does not look like a structured paper',
      pages: allPages,
    });
    return {
      structure: null,
      issues,
      provenance,
      durationMinutesSource: durationMinutes !== null ? 'HEADER' : 'UNKNOWN',
      totalMarksSource: headerTotal !== null ? 'HEADER' : 'UNKNOWN',
    };
  }

  // ── Total marks: prefer the scorable section sum (validate-safe), since
  // validatePaperPatternStructure requires section totals to reconcile. A
  // printed header total that differs from the scorable sum is reported as
  // an INCONSISTENT_MARKS issue for the teacher, never silently dropped. ──
  const ruleTotals = patternSections.flatMap((s) => s.questionTypes.map((q) => q.totalMarks));
  const sectionSum =
    ruleTotals.length > 0 && ruleTotals.every((t) => t !== null && t !== undefined)
      ? ruleTotals.reduce((sum, t) => sum + (t as number), 0)
      : null;

  let totalMarks: number | null;
  let totalMarksSource: 'HEADER' | 'SECTION_SUM' | 'UNKNOWN';
  if (sectionSum !== null) {
    totalMarks = sectionSum;
    totalMarksSource =
      headerTotal !== null && headerTotal === sectionSum ? 'HEADER' : 'SECTION_SUM';
    if (headerTotal !== null && headerTotal !== sectionSum) {
      issues.push({
        code: 'INCONSISTENT_MARKS',
        message: `Paper header says ${headerTotal} marks but the sections total ${sectionSum} (scorable) — the scorable total was kept so the pattern validates; verify in the builder`,
        pages: allPages,
      });
    }
  } else {
    totalMarks = headerTotal;
    totalMarksSource = headerTotal !== null ? 'HEADER' : 'UNKNOWN';
  }
  if (totalMarks === null) {
    issues.push({
      code: 'TOTAL_MARKS_UNKNOWN',
      message: 'Total marks could not be determined — set it in the builder',
      pages: allPages,
    });
  }
  if (durationMinutes === null) {
    issues.push({
      code: 'DURATION_UNKNOWN',
      message: 'Duration could not be determined — set it in the builder',
      pages: allPages,
    });
  }

  return {
    structure: { totalMarks, durationMinutes, instructions, sections: patternSections },
    issues,
    provenance,
    durationMinutesSource: durationMinutes !== null ? 'HEADER' : 'UNKNOWN',
    totalMarksSource,
  };
}

function detectSectionAttempt(section: { heading: string; body: Line[] }): {
  attempt: { n: number; m: number | null } | null;
  compulsory: boolean;
  marksEach: number | null;
} {
  let attempt: { n: number; m: number | null } | null = null;
  let compulsory = false;
  let marksEach: number | null = null;
  for (const line of [section.heading, ...section.body.map((l) => l.text)]) {
    const a = detectAttempt(line);
    if (a) attempt = a;
    if (COMPULSORY_PHRASE.test(line)) compulsory = true;
    const each = EQUAL_MARKS_EACH.exec(line);
    if (each) marksEach = Number(each[1]);
  }
  return { attempt, compulsory, marksEach };
}

function buildSectionRules(
  section: { heading: string; body: Line[] },
  paperCompulsory: boolean,
  issues: PatternExtractionIssue[],
): RuleBuilder[] {
  const { attempt, compulsory, marksEach } = detectSectionAttempt(section);
  // A global "all questions compulsory" (preamble) wins over any section-level
  // "attempt any" phrasing — contradictory papers resolve to compulsory.
  const hardCompulsory = paperCompulsory || compulsory;
  const headingType = detectType(section.heading);

  const rules: RuleBuilder[] = [];
  let current: RuleBuilder = newRule(headingType);
  rules.push(current);

  for (const line of section.body) {
    const item = ITEM.exec(line.text);
    if (item) {
      const label = item[1] ?? item[2] ?? item[3] ?? '';
      current.items.push({ label, marks: detectInlineMarks(line.text), line });
      current.lines.push(line);
      continue;
    }

    // Only a declaration line (not a per-question line) changes the rule type —
    // question text routinely contains words like "define" or "mcq".
    const declarationType = detectType(line.text);
    if (declarationType) {
      if (
        current.items.length > 0 &&
        current.type !== undefined &&
        current.type !== declarationType
      ) {
        current = newRule(declarationType);
        rules.push(current);
      } else {
        current.type = declarationType;
      }
      current.lines.push(line);
    }
  }

  const result = rules.filter((r) => r.items.length > 0);
  if (result.length === 0) return result;

  // The policy for a rule is only genuinely ambiguous when attempt signals
  // CONFLICT within a section (e.g. "any 2 of 5" in the heading, "any 3 of 5"
  // on an item). A single signal — or none at all — resolves deterministically:
  // one attempt phrasing applies section-wide; silence means the conventional
  // answer-every-listed-question (the rules fall back to compulsory above).
  // Signals are read from the raw lines: detectSectionAttempt collapses to the
  // last match, which would hide the very conflict we are looking for.
  const distinctAttempts = new Set<string>();
  for (const lineText of [section.heading, ...section.body.map((l) => l.text)]) {
    const a = detectAttempt(lineText);
    if (a) distinctAttempts.add(`${a.n}/${a.m ?? 'all'}`);
  }
  if (!hardCompulsory && distinctAttempts.size > 1) {
    issues.push({
      code: 'ATTEMPT_POLICY_UNKNOWN',
      message:
        'Conflicting attempt instructions were found — confirm per-rule compulsory/attempt settings in the builder',
      blockIds: [...new Set(section.body.map((l) => l.blockId))],
      pages: [...new Set(section.body.map((l) => l.page))],
    });
  }

  for (const rule of result) {
    const perItem = rule.items.map((i) => detectAttempt(i.line.text)).find((a) => a !== null);
    const ruleAttempt = perItem ?? attempt;
    if (hardCompulsory) {
      rule.compulsoryDefault = true;
      rule.attemptDefault = null;
    } else if (ruleAttempt) {
      rule.compulsoryDefault = false;
      rule.attemptDefault = ruleAttempt;
    } else {
      rule.compulsoryDefault = true;
      rule.attemptDefault = null;
    }
    rule.marksDefault = marksEach;
  }

  return result;
}

function newRule(type: PredefinedQuestionType | undefined): RuleBuilder {
  return {
    id: randomUUID(),
    type,
    items: [],
    lines: [],
    compulsoryDefault: true,
    attemptDefault: null,
    marksDefault: null,
  };
}

function ruleToContract(
  rule: RuleBuilder,
  issues: PatternExtractionIssue[],
): PaperPatternQuestionType {
  const count = rule.items.length > 0 ? rule.items.length : null;

  // Marks are only adopted when honestly stated — either every item carries
  // the same "(N marks)", or a "each question carries N marks" statement.
  // Inconsistent/partial marks stay null so the teacher fixes them.
  const known = [...new Set(rule.items.map((i) => i.marks).filter((m): m is number => m !== null))];
  const allItemsMentioned = rule.items.length > 0 && rule.items.every((i) => i.marks !== null);
  let marksPerQuestion: number | null = null;
  if (rule.marksDefault !== null) {
    marksPerQuestion = rule.marksDefault;
  } else if (allItemsMentioned && known.length > 0 && known.every((m) => m === known[0])) {
    marksPerQuestion = known[0];
  } else if (allItemsMentioned && known.length > 1) {
    issues.push({
      code: 'INCONSISTENT_MARKS',
      message: `Marks differ across questions in "${rule.type ?? 'this rule'}" — set per-question marks in the builder`,
      blockIds: [...new Set(rule.lines.map((l) => l.blockId))],
      pages: [...new Set(rule.lines.map((l) => l.page))],
    });
  }
  if (marksPerQuestion === null && count !== null && count > 0 && rule.marksDefault === null) {
    issues.push({
      code: 'MARKS_UNKNOWN',
      message: `Per-question marks could not be determined for "${rule.type ?? 'this rule'}" — set them in the builder`,
      blockIds: [...new Set(rule.lines.map((l) => l.blockId))],
      pages: [...new Set(rule.lines.map((l) => l.page))],
    });
  }

  let compulsory = rule.compulsoryDefault ?? true;
  let attemptCount: number | null = null;
  if (rule.attemptDefault !== null) {
    compulsory = false;
    attemptCount = rule.attemptDefault.n;
  }
  // Attempting every available question ≡ compulsory — avoids an invalid rule.
  if (attemptCount !== null && count !== null && attemptCount >= count) {
    compulsory = true;
    attemptCount = null;
  }

  let totalMarks: number | null = null;
  if (marksPerQuestion !== null && count !== null) {
    const attempted = compulsory ? count : (attemptCount ?? count);
    totalMarks = attempted * marksPerQuestion;
  }

  return {
    id: rule.id,
    questionType: rule.type,
    count,
    marksPerQuestion,
    totalMarks,
    compulsory,
    attemptCount,
    difficultyDistribution: null,
    topicDistribution: null,
  };
}
