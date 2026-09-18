// Material Intelligence (Phase A) — pure cleaning & enhancement engine.
//
// Deterministic text processing only — no LLM, no business-domain knowledge
// (generic, reusable by paper-pattern/question extraction later).
//
// Guarantees honored:
//   - The RAW extraction is never modified: this module only ever builds a
//     derived payload from per-page input.
//   - Structure is preserved: headings, numbering (verbatim), lists, tables,
//     equations, and page boundaries survive; each block carries page + engine
//     provenance.
//   - Nothing is silently discarded: every EXCLUDE finding carries the original
//     discarded text and a reason; uncertain content is kept and flagged REVIEW.

import { createHash } from 'node:crypto';

import type {
  MaterialEnhancedBlock,
  MaterialEnhancementFinding,
  MaterialEnhancementPayload,
} from '@catlium/contracts';

export interface EnhancePage {
  page: number;
  source: 'pymupdf' | 'paddleocr' | null;
  text: string;
}

// Syllabus context target the enhancer matches segments against. One uploaded
// Material stays the canonical source — segments never become materials.
export interface SyllabusTarget {
  type: 'subject' | 'chapter' | 'topic' | 'unit';
  syllabusId: string | null;
  title: string;
  subjectId: string | null;
  chapterId: string | null;
  chapterName: string | null;
  topicId: string | null;
  topicName: string | null;
  unitTitle: string | null;
}

// A logical region of the material: an unheaded prefix ('other') or the block
// opened by a detected heading, spanning a page range and the payload blocks
// it owns (provenance by reference — content lives in the payload).
export interface EnhancedSegment {
  title: string | null;
  kind: 'chapter' | 'section' | 'other';
  level: 'relevant' | 'uncertain' | 'irrelevant' | 'unmapped';
  startPage: number;
  endPage: number;
  blockIds: string[];
  text: string;
  preview: string;
}

// A segment → syllabus entity association (normalized mapping row). Multiple
// mappings per segment are allowed; the entity is whatever matched — never
// invented, never implied where overlap is absent.
export interface SegmentMapping {
  segmentIndex: number;
  type: 'subject' | 'chapter' | 'topic' | 'unit';
  level: 'relevant' | 'uncertain';
  confidence: number;
  reason: string;
  syllabusId: string | null;
  subjectId: string | null;
  chapterId: string | null;
  chapterName: string | null;
  topicId: string | null;
  topicName: string | null;
  unitTitle: string | null;
}

export interface EnhanceResult {
  payload: MaterialEnhancementPayload;
  segments: EnhancedSegment[];
  mappings: SegmentMapping[];
}

// ── Tunables ────────────────────────────────────────────────────────────────
const HEADING_MAX_CHARS = 80;
const HEADING_MAX_TOKENS = 12;
const MARGIN_MIN_CHARS = 6;
const SHORT_FRAGMENT_MAX_CHARS = 20;
const PAGE_NUMBER_RE =
  /^(?:\d{1,4}|[ivxlcdm]{1,8}|page\s*\d+|p\.?\s*\d+|\d{1,4}\s*[/\\]\s*\d{1,4})$/i;
const NUMBERING_RE =
  /^(?:\d+(?:[.\-]\d+)*[.)]?\s+|q\d*[.)]?\s+|\([ivxlcdm]+\)\s*|[ivxlcdm]+[.)]\s+|[a-z][.)]\s)/i;
const LIST_MARKER_RE = /^[-–—•*▪]\s+/;
const TABLE_CELL_RE = /[\t|]/;
const EQUATION_RE = /[=≠≤≥≈∑∏∫√∞∆∂]/;
const GENERIC_HEADING_WORD_RE =
  /^(?:unit|units|section|part|chapter|question|answer|module|introduction|contents|conclusion|summary|references|appendix|index|abstract|keywords)\b/i;
const ZW_AND_NBSP_RE = /[\u00a0\u200b-\u200f\ufeff]/g;
const WS_RUN_RE = /[ \t]+/g;

const ALIGNMENT_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'this',
  'that',
  'to',
  'unit',
  'units',
  'chapter',
  'section',
  'part',
  'module',
  'introduction',
  'overview',
  'contents',
  'objectives',
]);

export function normalizeLine(raw: string): string {
  return raw.replace(ZW_AND_NBSP_RE, ' ').replace(WS_RUN_RE, ' ').trim();
}

/** Content fingerprint of the exact raw input (idempotency/audit). */
export function sourceFingerprint(pages: EnhancePage[]): string {
  return createHash('sha256')
    .update(JSON.stringify(pages.map((p) => [p.page, p.text])))
    .digest('hex');
}

export function isConfidentRepeat(count: number, pageCount: number): boolean {
  return pageCount >= 3 ? count >= Math.max(2, Math.ceil(pageCount * 0.6)) : count >= 2;
}

function isHeading(line: string): boolean {
  if (line.length < 2 || line.length > HEADING_MAX_CHARS) return false;
  if (/[.!?]$/.test(line)) return false;
  if (line.split(/\s+/).filter(Boolean).length > HEADING_MAX_TOKENS) return false;
  const numbered = NUMBERING_RE.test(line);
  const allCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
  return numbered || allCaps || (line.length <= 48 && GENERIC_HEADING_WORD_RE.test(line));
}

function isEquation(line: string): boolean {
  if (EQUATION_RE.test(line)) return true;
  return /^[0-9()+\-*/.×÷%\s]+$/.test(line) && /\d/.test(line) && /[+\-*/.×÷%]/.test(line);
}

function isTableRow(line: string): boolean {
  return TABLE_CELL_RE.test(line) && line.split(TABLE_CELL_RE).filter((s) => s.trim()).length >= 2;
}

function isPageNumberLine(line: string): boolean {
  return PAGE_NUMBER_RE.test(normalizeLine(line));
}

/** Review-worthy OCR: dense unreadable ASCII (letters/digits < 50%). */
function garbledRatio(text: string): number {
  if (text.length < 4) return 0;
  const ascii = text.replace(/[\u0080-\uffff]/g, '');
  if (ascii.length < text.length) return 0; // non-ASCII — likely legitimate text
  return (ascii.match(/[a-zA-Z0-9]/g) ?? []).length / text.length;
}

interface PageLine {
  page: number;
  source: 'pymupdf' | 'paddleocr' | null;
  index: number; // global provenance index
  lineNo: number; // 0-based within its page
  text: string;
}

/** Split + normalize a page's text into clean non-empty lines. */
function prepareLines(pages: EnhancePage[]): { page: number; source: 'pymupdf' | 'paddleocr' | null; lines: PageLine[] }[] {
  let globalIndex = 0;
  return pages.map((p) => {
    const lines: PageLine[] = [];
    for (const raw of p.text.split(/\r?\n/)) {
      const text = normalizeLine(raw);
      if (!text) continue;
      lines.push({ page: p.page, source: p.source, index: globalIndex++, lineNo: lines.length, text });
    }
    return { page: p.page, source: p.source, lines };
  });
}

/** Join broken hyphenation at line ends ("contin-\nuation" → "continuation"). */
function joinHyphenated(
  lines: PageLine[],
  findings: MaterialEnhancementFinding[],
): PageLine[] {
  const joined: PageLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (line.text.endsWith('-') && next && /^[a-z]/.test(next.text)) {
      findings.push({
        id: `f${findings.length + 1}`,
        level: 'KEEP',
        kind: 'hyphenation-joined',
        reason: 'joined broken line wrap',
        page: line.page,
        line: line.lineNo,
        content: `${line.text}\n${next.text}`,
      });
      joined.push({ ...line, text: line.text.slice(0, -1) + next.text });
      i++;
      continue;
    }
    joined.push(line);
  }
  return joined;
}

/** Consecutive exact-duplicate lines on a page = OCR line repeat → EXCLUDE. */
function dedupeConsecutive(
  lines: PageLine[],
  findings: MaterialEnhancementFinding[],
): PageLine[] {
  const out: PageLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && prev.text === line.text) {
      findings.push({
        id: `f${findings.length + 1}`,
        level: 'EXCLUDE',
        kind: 'duplicate-line',
        reason: 'line repeated verbatim (duplicated output)',
        page: line.page,
        line: line.lineNo,
        content: line.text,
      });
      continue;
    }
    out.push(line);
  }
  return out;
}

function exclude(
  kind: string,
  reason: string,
  line: PageLine,
  findings: MaterialEnhancementFinding[],
): void {
  findings.push({
    id: `f${findings.length + 1}`,
    level: 'EXCLUDE',
    kind,
    reason,
    page: line.page,
    line: line.lineNo,
    content: line.text,
  });
}

/** Detect and record running headers / footers, page numbers (margins). */
function markExclusions(
  pages: { page: number; source: 'pymupdf' | 'paddleocr' | null; lines: PageLine[] }[],
  findings: MaterialEnhancementFinding[],
): Set<PageLine> {
  const excluded = new Set<PageLine>();
  const pageCount = pages.length;
  if (pageCount < 2) return excluded;

  const firstTextCount = new Map<string, number>();
  const lastTextCount = new Map<string, number>();
  for (const p of pages) {
    if (!p.lines.length) continue;
    const first = p.lines[0]!.text;
    const last = p.lines[p.lines.length - 1]!.text;
    firstTextCount.set(first, (firstTextCount.get(first) ?? 0) + 1);
    if (last !== first) lastTextCount.set(last, (lastTextCount.get(last) ?? 0) + 1);
  }

  const headerTexts = [...firstTextCount.entries()]
    .filter(([text, count]) => isConfidentRepeat(count, pageCount) && text.length >= MARGIN_MIN_CHARS)
    .map(([text]) => text);
  const footerTexts = [...lastTextCount.entries()]
    .filter(([text, count]) => isConfidentRepeat(count, pageCount) && text.length >= MARGIN_MIN_CHARS)
    .map(([text]) => text);

  for (const p of pages) {
    if (!p.lines.length) continue;
    const lineRefs = p.lines;
    const first = lineRefs[0]!;
    const last = lineRefs[lineRefs.length - 1]!;
    if (headerTexts.includes(first.text)) {
      exclude('running-header', 'repeated across pages — confidently a running header', first, findings);
      excluded.add(first);
    }
    if (footerTexts.includes(last.text)) {
      exclude('footer', 'repeated across pages — confidently a running footer', last, findings);
      excluded.add(last);
    }
    // page numbers at the very top/bottom of a page
    for (const line of new Set([first, last])) {
      if (excluded.has(line)) continue;
      if (isPageNumberLine(line.text)) {
        exclude('page-number', 'page number at page boundary', line, findings);
        excluded.add(line);
      }
    }
  }
  return excluded;
}

interface BuiltBlock {
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'equation';
  parts: string[];
  startLine: PageLine;
  endLine: PageLine;
}

/** REVIEW findings for uncertain-but-kept prose (garbled OCR, lone fragments). */
function witnessProse(block: BuiltBlock, prose: PageLine[], findings: MaterialEnhancementFinding[]): void {
  if (prose.some((l) => garbledRatio(l.text) < 0.5)) {
    findings.push({
      id: `f${findings.length + 1}`,
      level: 'REVIEW',
      kind: 'garbled-text',
      reason: 'possible garbled OCR text — kept for review',
      page: block.startLine.page,
      line: block.startLine.lineNo,
    });
  }
  if (prose.length === 1 && block.parts[0]!.length < SHORT_FRAGMENT_MAX_CHARS) {
    findings.push({
      id: `f${findings.length + 1}`,
      level: 'REVIEW',
      kind: 'orphan-line',
      reason: 'short standalone fragment — kept for review',
      page: block.startLine.page,
      line: block.startLine.lineNo,
      content: block.parts[0],
    });
  }
}

/** List-shaped numerical marker ("1." / "1)" / "a)" / "(i)" etc.) — NOT "Q1". */
function isNumberedLine(text: string): boolean {
  return /^(?:\d{1,3}[.)]|\(\d{1,3}\)|\([a-z]\)|[a-z][.)]|[ivxlcdm]+[.)])\s+/i.test(text);
}

function pagesIdentical(
  a: { lines: PageLine[] },
  b: { lines: PageLine[] },
): boolean {
  return a.lines.length > 0 && a.lines.length === b.lines.length &&
    a.lines.every((l, i) => l.text === b.lines[i]!.text);
}

/** Group cleaned lines of one page into structure-preserving blocks. */
function buildBlocks(
  lines: PageLine[],
  findings: MaterialEnhancementFinding[],
): BuiltBlock[] {
  const blocks: BuiltBlock[] = [];
  let prose: PageLine[] = [];
  let list: PageLine[] = [];
  let table: PageLine[] = [];
  // Numbered items are headings when isolated, list items when in a run.
  let prevWasListItem = false;

  const flushAcc = (acc: PageLine[], kind: 'list' | 'table'): void => {
    if (!acc.length) return;
    blocks.push({ kind, parts: acc.map((l) => l.text), startLine: acc[0]!, endLine: acc[acc.length - 1]! });
  };

  const flushProse = (): void => {
    if (!prose.length) return;
    const text = prose.map((l) => l.text).join(' ');
    const block: BuiltBlock = { kind: 'paragraph', parts: [text], startLine: prose[0]!, endLine: prose[prose.length - 1]! };
    witnessProse(block, prose, findings);
    blocks.push(block);
    prose = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    const numberedItem = isNumberedLine(line.text);
    const nextIsListish = !!(next && (isNumberedLine(next.text) || LIST_MARKER_RE.test(next.text)));
    const isListItemNow = LIST_MARKER_RE.test(line.text) || (numberedItem && (prevWasListItem || nextIsListish));

    if (isEquation(line.text)) {
      flushProse();
      flushAcc(list, 'list');
      list = [];
      flushAcc(table, 'table');
      table = [];
      blocks.push({ kind: 'equation', parts: [line.text], startLine: line, endLine: line });
      prevWasListItem = false;
      continue;
    }
    if (isHeading(line.text) && isListItemNow) {
      flushProse();
      flushAcc(table, 'table');
      table = [];
      list.push(line);
      prevWasListItem = true;
      continue;
    }
    if (isHeading(line.text)) {
      flushProse();
      flushAcc(list, 'list');
      list = [];
      flushAcc(table, 'table');
      table = [];
      blocks.push({ kind: 'heading', parts: [line.text], startLine: line, endLine: line });
      prevWasListItem = false;
      continue;
    }
    if (isTableRow(line.text)) {
      flushProse();
      flushAcc(list, 'list');
      list = [];
      table.push(line);
      prevWasListItem = false;
      continue;
    }
    if (isListItemNow) {
      flushProse();
      flushAcc(table, 'table');
      table = [];
      list.push(line);
      prevWasListItem = true;
      continue;
    }
    flushAcc(list, 'list');
    list = [];
    flushAcc(table, 'table');
    table = [];
    prose.push(line);
    prevWasListItem = false;
  }
  flushProse();
  flushAcc(list, 'list');
  flushAcc(table, 'table');
  return blocks;
}

function significantWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !ALIGNMENT_STOPWORDS.has(w));
}

/** Heading → segment kind. Heuristic, determined purely from the line: the
 *  word "chapter" (or a unit/module/part marker) = chapter, otherwise section.
 *  Unheaded runs are 'other'. The SYLLABUS decides what a segment really is. */
function segmentKindOf(heading: string): 'chapter' | 'section' {
  return /\bchapter\b/i.test(heading) || /\b(?:unit|module|part)\b/i.test(heading)
    ? 'chapter'
    : 'section';
}

/** Group the (already ordered, page-provenanced) blocks into logical segments:
 *  each heading opens a segment owning that heading + its following blocks; the
 *  blocks before the first heading form an unheaded 'other' segment. */
function buildSegments(sections: MaterialEnhancedBlock[]): EnhancedSegment[] {
  const segments: EnhancedSegment[] = [];
  let current: EnhancedSegment | null = null;
  for (const block of sections) {
    if (block.kind === 'heading') {
      current = {
        title: block.content,
        kind: segmentKindOf(block.content),
        level: 'unmapped',
        startPage: block.page,
        endPage: block.page,
        blockIds: [block.id],
        text: block.content,
        preview: block.content.slice(0, 200),
      };
      segments.push(current);
      continue;
    }
    if (!current) {
      current = {
        title: null,
        kind: 'other',
        level: 'unmapped',
        startPage: block.page,
        endPage: block.page,
        blockIds: [],
        text: '',
        preview: '',
      };
      segments.push(current);
    }
    current.blockIds.push(block.id);
    current.text = current.text ? `${current.text}\n\n${block.content}` : block.content;
    current.startPage = Math.min(current.startPage, block.page);
    current.endPage = Math.max(current.endPage, block.page);
  }
  for (const s of segments) s.preview = s.text.slice(0, 200);
  return segments;
}

function segmentMatches(target: SyllabusTarget, text: string): { hits: number; ratio: number; sigLen: number } {
  const sig = significantWords(target.title);
  if (sig.length === 0) return { hits: 0, ratio: 0, sigLen: 0 };
  const norm = normalizeLine(text).toLowerCase();
  const hits = sig.filter((w) => norm.includes(w)).length;
  return {
    hits,
    ratio: Math.round(Math.min(1, hits / sig.length) * 1000) / 1000,
    sigLen: sig.length,
  };
}

function targetLabel(target: SyllabusTarget): string {
  return target.type === 'unit'
    ? `syllabus unit "${target.title}"`
    : `${target.type} "${target.title}"`;
}

const RELEVANT_SCORE = 1000;

/** Relevance classification (never invents, never edits content). A mapping is
 *  created for every target with ≥1 significant-word overlap; level is
 *  `relevant` for a strong overlap (fully-matched single word, or ≥2 words at
 *  ≥0.5 ratio) and `uncertain` for a weak one. Segments with no overlap at all
 *  are `irrelevant` when syllabus context exists, else `unmapped`. Subject
 *  mappings are a fallback only — they never mask a chapter/topic/unit hit. */
function classifySegments(segments: EnhancedSegment[], targets: SyllabusTarget[]): SegmentMapping[] {
  const helpful = targets.filter((t) => significantWords(t.title).length > 0);
  const internal = helpful.filter((t) => t.type !== 'subject');
  const subject = helpful.filter((t) => t.type === 'subject');
  const hasSyllabus = helpful.length > 0;
  const mappings: SegmentMapping[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    let internalHits = 0;
    const matches: Array<{ mapping: SegmentMapping; score: number }> = [];

    const track = (target: SyllabusTarget): void => {
      const m = segmentMatches(target, seg.text);
      if (m.hits === 0) return;
      if (target.type !== 'subject') internalHits += m.hits;
      const strong = m.sigLen === 1 ? m.hits === 1 : m.hits >= 2 && m.ratio >= 0.5;
      const level: SegmentMapping['level'] = strong ? 'relevant' : 'uncertain';
      const mapping: SegmentMapping = {
        segmentIndex: i,
        type: target.type,
        level,
        confidence: m.ratio,
        reason: targetLabel(target),
        syllabusId: target.syllabusId,
        subjectId: target.subjectId,
        chapterId: target.chapterId,
        chapterName: target.chapterName,
        topicId: target.topicId,
        topicName: target.topicName,
        unitTitle: target.unitTitle,
      };
      mappings.push(mapping);
      matches.push({ mapping, score: level === 'relevant' ? RELEVANT_SCORE + m.hits : m.hits });
    };

    for (const t of internal) track(t);
    // Subject mapping only when nothing chapter/topic/unit-based matched —
    // subject names are too coarse to dominate segment classification.
    if (internalHits === 0) for (const t of subject) track(t);

    let best: SegmentMapping | null = null;
    let bestScore = -1;
    for (const c of matches) {
      if (c.score > bestScore) {
        best = c.mapping;
        bestScore = c.score;
      }
    }
    seg.level = best ? best.level : hasSyllabus ? 'irrelevant' : 'unmapped';
  }
  return mappings;
}

/** Main entrypoint. Callers guarantee ≥1 page (duplicate pages collapse). */
export function enhanceMaterial(
  pages: EnhancePage[],
  syllabusTargets: SyllabusTarget[] = [],
): EnhanceResult {
  if (pages.length === 0) {
    throw new Error('enhanceMaterial requires at least one page');
  }
  const findings: MaterialEnhancementFinding[] = [];
  const prepared = prepareLines([...pages].sort((a, b) => a.page - b.page));

  // duplicated pages (identical adjacent page content) → loudly excluded
  for (let i = 1; i < prepared.length; i++) {
    const prev = prepared[i - 1]!;
    const curr = prepared[i]!;
    if (pagesIdentical(prev, curr)) {
      findings.push({
        id: `f${findings.length + 1}`,
        level: 'EXCLUDE',
        kind: 'duplicate-page',
        reason: 'page reproduced verbatim from the previous page',
        page: curr.page,
        content: curr.lines.map((l) => l.text).join('\n'),
      });
      curr.lines = [];
    }
  }

  const excluded = markExclusions(prepared, findings);

  let blockCounter = 0;
  const sections: MaterialEnhancedBlock[] = [];
  for (const page of prepared) {
    if (!page.lines.length) continue;
    const before = sections.length;
    const kept = joinHyphenated(page.lines.filter((l) => !excluded.has(l)), findings);
    const cleaned = dedupeConsecutive(kept, findings);
    for (const b of buildBlocks(cleaned, findings)) {
      sections.push({
        id: `b${++blockCounter}`,
        kind: b.kind,
        content: b.parts.join('\n'),
        page: page.page,
        source: page.source,
        lineStart: b.startLine.lineNo,
        lineEnd: b.endLine.lineNo,
      });
    }
    if (sections.length > before) {
      findings.push({
        id: `f${findings.length + 1}`,
        level: 'KEEP',
        kind: 'page-boundary',
        reason: `page ${page.page} preserved — blocks carry page provenance`,
        page: page.page,
      });
    }
  }

  const counts = findings.reduce(
    (acc, f) => {
      acc[f.level] = (acc[f.level] ?? 0) + 1;
      return acc;
    },
    { KEEP: 0, EXCLUDE: 0, REVIEW: 0 },
  );

  const segments = buildSegments(sections);
  const mappings = classifySegments(segments, syllabusTargets);

  return {
    payload: {
      pages: prepared.length,
      sections,
      cleanedText: sections.map((s) => s.content).join('\n\n'),
      summary: {
        blocks: sections.length,
        findings: { keep: counts.KEEP, exclude: counts.EXCLUDE, review: counts.REVIEW },
      },
    },
    segments,
    mappings,
  };
}