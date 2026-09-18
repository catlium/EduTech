// Deterministic question extraction (Phase 47) — pure rules, zero AI.
//
// Turns a flat list of processed blocks (an enhanced material, or its raw
// text as one synthetic block) into reviewable Question Bank candidates.
// Anything ambiguous or unparseable is left empty and surfaced as an issue —
// never guessed. Accepting a candidate (import) runs full payload validation,
// so incomplete answers must be completed by the teacher in review first.
//
// The file is deliberately import-light (node:crypto + contracts) so it stays
// runnable under node --test with type stripping (see question-extractor.test.ts).

import { randomUUID } from 'node:crypto';

import type {
  AnswerFormat,
  QuestionExtractionIssue,
} from '@catlium/contracts';

export interface ExtractionSourceBlock {
  id: string;
  kind: string;
  content: string;
  page: number;
}

export type QuestionFormat = AnswerFormat;

export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface DetectedQuestion {
  stem: string;
  format: QuestionFormat;
  /* Suggested question-type code (open data). For non-TEXT formats this is the
   * canonical code for the format; for TEXT it is a keyword guess. The service
   * resolves the authoritative type by code and falls back to a canonical code
   * when the code's answer format disagrees with the detected one. */
  suggestedType: string;
  difficulty: QuestionDifficulty | null;
  originalMarks: number | null;
  page: number | null;
  blockIds: string[];
  section: string | null;
  originalNumber: string | null;
  answerText: string | null;
  /* Text the service uses for syllabus-target matching (stem/choices/section). */
  matchText: string;
  payload: Record<string, unknown>;
  issues: QuestionExtractionIssue[];
}

export interface QuestionExtractionResult {
  questions: DetectedQuestion[];
  issues: QuestionExtractionIssue[];
}

interface Line {
  text: string;
  page: number;
  blockId: string;
}

interface LetteredLine {
  label: string;
  text: string;
  page: number;
  blockId: string;
}

interface RawGroup {
  number: string | null;
  section: string | null;
  page: number | null;
  lines: Line[];
  lettered: LetteredLine[];
  blockIds: Set<string>;
  /* true when a letter-marked item opened the group with no parent number —
   * a lettered list where every letter is its own top-level question. */
  topLevelLetter: boolean;
}

interface QuestionMeta {
  section: string | null;
  page: number | null;
  blockIds: string[];
  originalNumber: string | null;
}

const MAX_STEM = 20000;

const ITEM_NUMBER =
  /^\s*(?:(\d{1,3})\s*[.)]|(?:q(?:uestion)\s*)?(\d{1,3})\s*[.)])\s+(.+)$/i;
const ITEM_LETTER = /^\s*\(\s*([a-h])\s*\)\s*(?:[.)]\s*)?(.+)$/i;
const SECTION_MARKER = /^(?:section|part)\s*[-–—:. ]*[a-z0-9]+\b/i;

const OPTION_HINT =
  /option|choose|select|which of the following|pick\s+(?:the\s+)?correct|tick/i;
const NO_CHOICE_TOO_LONG = 60; // chars — longer letter items read as sub-questions

const TYPE_KEYS: Array<[RegExp, QuestionFormat, string]> = [
  [
    /\btrue\b[^a-z]*\bfalse\b|true\s*\/\s*false|(?:state|say|write|mention).*\btrue\b/i,
    'TRUE_FALSE',
    'TRUE_FALSE',
  ],
  [/fill[\s-]*(?:in[\s-]*)?(?:the\s+)?blanks?/i, 'FILL_IN_BLANK', 'FILL_IN_BLANK'],
  [/\bmatch\s*(?:the\s+)?following/i, 'MATCHING', 'MATCH_THE_FOLLOWING'],
  [/multiple[\s-]*choice|\bmcq\b/i, 'MCQ', 'MCQ'],
  [/\bnumerical\b/i, 'NUMERICAL', 'NUMERICAL'],
];

const TEXT_TYPE_KEYS: Array<[RegExp, string]> = [
  [/case[\s-]*study/i, 'CASE_STUDY'],
  [/very[\s-]*short|one\s*word|answer\s+(?:in\s+a\s+)?few\s*words/i, 'VERY_SHORT_ANSWER'],
  [/\bdefine\b|definition/i, 'DEFINITION'],
  [/\blong[\s-]*answer\b|essay|explain|describe|in\s+detail/i, 'LONG_ANSWER'],
  [/\bbrief\b|in\s+brief/i, 'BRIEF_ANSWER'],
  [/\bshort[\s-]*answer\b|briefly/i, 'SHORT_ANSWER'],
];

/* An answer line is a standalone LINE whose value sits after the marker. It is
 * line-anchored (^…$ /m) so "Choose the correct answer." in a stem never reads
 * as an answer line and chops the stem tail. `*` value keeps a bare "Ans:" a
 * match so it is stripped and surfaced as ANSWER_MISSING instead of polluting
 * the stem. */
const ANSWER_LINE =
  /^\s*(?:(?:ans(?:\.|wer)?|answer)\s*[:=.\-–—]|(?:correct\s+(?:option|answer)|right\s+answer)\s*[:=.\-–—])\s*([^\r\n]*)$/gim;
const MARK_RE = /[\(\[](\d{1,3})[\)\]]\s*$|\b(\d{1,3})\s*marks?\b/i;
const DIFFICULTY_RE = /\(\s*(easy|medium|hard)\s*\)|difficulty\s*[:=.\-–—]?\s*(easy|medium|hard)/gi;

/* ── Extraction ───────────────────────────────────────────────────── */
export function extractQuestions(blocks: ExtractionSourceBlock[]): QuestionExtractionResult {
  const lines: Line[] = [];
  for (const block of blocks) {
    for (const raw of block.content.split('\n')) {
      const text = raw.trim();
      if (isNoise(text)) continue;
      lines.push({ text, page: block.page, blockId: block.id });
    }
  }

  const groups = scanGroups(lines);
  const questions: DetectedQuestion[] = [];
  const issues: QuestionExtractionIssue[] = [];

  for (const group of groups) {
    const built = buildGroup(group);
    questions.push(...built.questions);
    issues.push(...built.issues);
  }

  return { questions, issues };
}

function isNoise(text: string): boolean {
  if (text.length === 0) return true;
  // Standalone page numbers / footer-only digits.
  if (/^\d{1,3}$/.test(text)) return true;
  if (/^page\s+(\d{1,3})$/i.test(text)) return true;
  return false;
}

function scanGroups(lines: Line[]): RawGroup[] {
  const groups: RawGroup[] = [];
  let current: RawGroup | null = null;
  let section: string | null = null;

  const flush = (): void => {
    if (current) {
      groups.push(current);
      current = null;
    }
  };

  const start = (): RawGroup => {
    flush();
    current = {
      number: null,
      section,
      page: null,
      lines: [],
      lettered: [],
      blockIds: new Set(),
      topLevelLetter: false,
    };
    return current;
  };

  for (const line of lines) {
    if (SECTION_MARKER.test(line.text)) {
      section = line.text;
      continue;
    }

    const num = ITEM_NUMBER.exec(line.text);
    if (num) {
      const marker = num[1] ?? num[2];
      const rest = num[3];
      const group = start();
      group.number = marker;
      group.page = line.page;
      group.blockIds.add(line.blockId);
      pushText(group, rest, line);
      continue;
    }

    const letter = ITEM_LETTER.exec(line.text);
    if (letter) {
      if (current) {
        current.blockIds.add(line.blockId);
        current.page = current.page ?? line.page;
        current.lettered.push({
          label: letter[1].toLowerCase(),
          text: letter[2],
          page: line.page,
          blockId: line.blockId,
        });
        continue;
      }
      // A letter-marked item with no parent number — the whole material is a
      // lettered list; each letter becomes its own top-level question.
      current = start();
      current.topLevelLetter = true;
      current.number = letter[1];
      current.page = line.page;
      current.blockIds.add(line.blockId);
      pushText(current, letter[2], line);
      continue;
    }

    if (!current) continue; // preamble/instructions before the first marker
    pushText(current, line.text, line);
  }

  flush();
  return groups;
}

function pushText(group: RawGroup, text: string, line: Line): void {
  group.lines.push({ text, page: line.page, blockId: line.blockId });
  group.blockIds.add(line.blockId);
  group.page = group.page ?? line.page;
}

interface BuildGroupResult {
  questions: DetectedQuestion[];
  issues: QuestionExtractionIssue[];
}

const INSTRUCTION_RE = /attempt|answer\s+(?:any|all)|note[:：]|from\s+the\s+following/i;

function buildGroup(group: RawGroup): BuildGroupResult {
  const issues: QuestionExtractionIssue[] = [];
  const meta: QuestionMeta = {
    section: group.section,
    page: group.page,
    blockIds: [...group.blockIds],
    originalNumber: group.number,
  };

  const prose = joinLines(group.lines.map((l) => l.text));

  if (group.lettered.length === 0) {
    const q = buildCandidate(prose, meta);
    issues.push(...q.issues);
    return { questions: q.question ? [q.question] : [], issues };
  }

  const hint = OPTION_HINT.test(`${prose}\n${group.lettered.map((l) => l.text).join('\n')}`);
  const choiceLike =
    group.lettered.length >= 2 &&
    group.lettered.every((l) => l.text.length <= NO_CHOICE_TOO_LONG && !hasMarks(l.text));

  if (hint || choiceLike) {
    const q = buildCandidate(prose, meta, group.lettered);
    issues.push(...q.issues);
    return { questions: q.question ? [q.question] : [], issues };
  }

  // Lettered items = sub-questions (or a top-level lettered list). When the
  // prose is a substantive question (not an exam instruction), it is emitted
  // as its own candidate before the lettered children.
  const questions: DetectedQuestion[] = [];
  const proseIsInstruction = INSTRUCTION_RE.test(prose) || !prose.trim();
  const prefix = group.number && !group.topLevelLetter ? group.number : null;

  const subs: Array<{ text: string; number: string | null }> = [];
  if (!proseIsInstruction) subs.push({ text: prose, number: group.number });
  for (const item of group.lettered) {
    subs.push({ text: item.text, number: prefix ? `${prefix}(${item.label})` : item.label });
  }

  for (const sub of subs) {
    const subMeta: QuestionMeta = {
      ...meta,
      originalNumber: sub.number,
      blockIds: [...meta.blockIds],
    };
    const q = buildCandidate(sub.text, subMeta);
    issues.push(...q.issues);
    if (q.question) questions.push(q.question);
  }
  return { questions, issues };
}

function buildCandidate(
  rawText: string,
  meta: QuestionMeta,
  choicesIn?: LetteredLine[],
): { question: DetectedQuestion | null; issues: QuestionExtractionIssue[] } {
  const issues: QuestionExtractionIssue[] = [];
  let text = rawText.trim();
  if (text.length === 0) return { question: null, issues };

  const blockIds = [...meta.blockIds];
  const page = meta.page;
  const pushIssue = (code: string, message: string): void => {
    issues.push({
      code,
      message,
      ...(blockIds.length ? { blockIds } : {}),
      ...(page != null ? { pages: [page] } : {}),
    });
  };

  // Pull the answer out of its own line/segment so it never pollutes the stem.
  const { body, answerText } = extractAnswer(text);
  text = body.trim();

  const difficulty = extractDifficulty(text);
  const originalMarks = detectMarks(text);
  text = text.replace(DIFFICULTY_RE, ' ').trim();

  const format = decideFormat(text, choicesIn ?? answerText);
  const payload = buildPayload(format, text, choicesIn, answerText, pushIssue);
  const suggestedType = suggestType(format, text);
  const stem = text.slice(0, MAX_STEM);

  const choices = choicesIn?.map((c) => c.text).join(' ');
  const matchText = [meta.section, stem, choices, answerText].filter(Boolean).join(' ');

  return {
    question: {
      stem,
      format,
      suggestedType,
      difficulty,
      originalMarks,
      page,
      blockIds,
      section: meta.section,
      originalNumber: meta.originalNumber,
      answerText: answerText ? cleanAnswer(answerText) : null,
      matchText,
      payload,
      issues,
    },
    issues,
  };
}

/* Answer extraction — removes the "Ans:"/"Correct answer:" line(s) and returns
 * the cleaned remainder plus the detected answer value. */
function extractAnswer(text: string): { body: string; answerText: string | null } {
  const matches = [...text.matchAll(ANSWER_LINE)];
  if (matches.length === 0) return { body: text, answerText: null };
  const value = matches[matches.length - 1]![1]!.trim();
  const body = text.replace(ANSWER_LINE, ' ');
  // Skip boilerplate like "Ans:" alone or generic headers with no value.
  if (!value || value.length > 500 || /^(?:given|below|in\s+brief)$/i.test(value)) {
    return { body: text.replace(ANSWER_LINE, ' '), answerText: null };
  }
  return { body, answerText: value };
}

function cleanAnswer(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[.。」]$/, '').trim().slice(0, 20000);
}

function extractDifficulty(text: string): QuestionDifficulty | null {
  for (const m of text.matchAll(DIFFICULTY_RE)) {
    const v = (m[1] ?? m[2] ?? '').toLowerCase();
    if (v === 'easy' || v === 'medium' || v === 'hard') return v.toUpperCase() as QuestionDifficulty;
  }
  return null;
}

function detectMarks(text: string): number | null {
  let last: number | null = null;
  for (const line of text.split('\n')) {
    const m = line.trim().match(MARK_RE);
    if (m) last = Number(m[1] ?? m[2]);
  }
  return last;
}

function hasMarks(text: string): boolean {
  return MARK_RE.test(text);
}

function decideFormat(
  text: string,
  choices: LetteredLine[] | string | null,
): QuestionFormat {
  for (const [re, format] of TYPE_KEYS) {
    if (re.test(text)) return format;
  }
  if (choices && Array.isArray(choices) && choices.length >= 2) {
    const allBoolean =
      choices.length <= 2 &&
      choices.every((c) => /^(true|false|t|f)$/i.test(c.text.trim()));
    return allBoolean ? 'TRUE_FALSE' : 'MCQ';
  }
  if (/_ +_|_{2,}/.test(text)) return 'FILL_IN_BLANK';
  return 'TEXT';
}

function buildPayload(
  format: QuestionFormat,
  text: string,
  choicesIn: LetteredLine[] | undefined,
  answerText: string | null,
  pushIssue: (code: string, message: string) => void,
): Record<string, unknown> {
  const answer = answerText?.trim() ?? '';
  switch (format) {
    case 'MCQ': {
      const choices = (choicesIn ?? []).map((c) => ({
        id: randomUUID(),
        label: c.label,
        text: c.text.trim().slice(0, 1000),
      }));
      const letter = answerLetter(answer);
      if (letter) {
        const choice = choices.find((c) => c.label === letter);
        if (choice) return { choices, correctChoiceId: choice.id };
        pushIssue('ANSWER_OPTION_MISMATCH', `Correct option "${letter}" is not among the choices`);
        return { choices };
      }
      pushIssue('ANSWER_MISSING', 'Correct option not given; choose it in review.');
      return { choices };
    }
    case 'TRUE_FALSE': {
      const b = parseBoolean(answer);
      if (b !== null) return { correctAnswer: b };
      if (choicesIn) {
        const tf = choicesIn.map((c) => c.text.trim().toLowerCase());
        const idx = tf.findIndex((t) => t === 'true' || t === 't');
        const fi = tf.findIndex((t) => t === 'false' || t === 'f');
        if (idx !== -1 || fi !== -1) {
          if (idx !== -1) return { correctAnswer: true };
          if (fi !== -1) return { correctAnswer: false };
        }
      }
      pushIssue('ANSWER_MISSING', 'Correct answer (True/False) not given; choose it in review.');
      return {};
    }
    case 'FILL_IN_BLANK': {
      const blanks = answer
        .split(/\s*(?:,|;|\/)\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      if (blanks.length > 0) return { acceptableAnswers: blanks };
      pushIssue('ANSWER_MISSING', 'Expected blank answer not given; add it in review.');
      return {};
    }
    case 'NUMERICAL': {
      const num = parseNumber(answer);
      if (num !== null) return { modelAnswer: num };
      pushIssue('ANSWER_MISSING', 'Numerical answer not given; add it in review.');
      return {};
    }
    case 'MATCHING': {
      const parsed = parseMatching(text);
      if (parsed) return parsed;
      pushIssue('MATCH_UNPARSEABLE', 'Two-column match set could not be parsed; complete it in review.');
      return {};
    }
    default: {
      if (answer.length > 0) return { modelAnswer: answer.slice(0, 20000) };
      pushIssue('ANSWER_MISSING', 'Model answer not given; add it in review.');
      return {};
    }
  }
}

function answerLetter(answer: string): string | null {
  const m = answer.match(/^\(\s*([a-h])\s*\)?\s*$|^([a-h])\s*[.).-]/i);
  const letter = (m?.[1] ?? m?.[2] ?? '').toLowerCase();
  return letter || null;
}

function parseBoolean(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 't' || v === 'yes') return true;
  if (v === 'false' || v === 'f' || v === 'no') return false;
  return null;
}

function parseNumber(value: string): number | null {
  const m = value.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseMatching(text: string): { left: unknown; right: unknown; matches: Record<string, string> } | null {
  const pairs: Array<{ letter: string; left: string; n: string }> = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^\(\s*([a-z])\s*\)\s*(.+?)\s+(\d{1,2})\s*$/i);
    if (!m) continue;
    pairs.push({ letter: m[1].toLowerCase(), left: m[2].trim(), n: m[3] });
  }
  if (pairs.length < 2) return null;
  const left = pairs.map((p) => ({ id: p.letter, text: p.left.slice(0, 1000) }));
  const right = [...new Set(pairs.map((p) => p.n))].map((n) => ({
    id: n,
    text: `Column ${n}`,
  }));
  const matches: Record<string, string> = {};
  for (const p of pairs) matches[p.letter] = p.n;
  return { left, right, matches };
}

function suggestType(format: QuestionFormat, text: string): string {
  if (format !== 'TEXT') return format;
  for (const [re, code] of TEXT_TYPE_KEYS) {
    if (re.test(text)) return code;
  }
  return 'SHORT_ANSWER';
}

function joinLines(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}