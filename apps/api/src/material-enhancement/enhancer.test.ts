// Material Intelligence (Phase A) — cleaning/enhancement engine checks.
// Run: pnpm --filter @catlium/api run test  (node --test "src/**/*.test.ts")
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enhanceMaterial, sourceFingerprint } from './enhancer.ts';
import type { EnhancePage } from './enhancer.ts';

const PR = Object.freeze({ source: 'pymupdf' as const });

test('structure + provenance preserved (headings, list, paragraph, page number)', () => {
  const pages: EnhancePage[] = [
    {
      page: 1,
      ...PR,
      text: '1. Introduction\nThis is a paragraph about the topic. It has a period at the end.\n• First point\n• Second point\n3\n',
    },
    {
      page: 2,
      ...PR,
      text: 'Conclusion\nWe summarize the key findings here. The conclusion spans only one line.\n',
    },
  ];

  const { payload, segments, mappings } = enhanceMaterial(pages);

  assert.equal(payload.pages, 2);
  assert.deepEqual(
    payload.sections.map((s) => [s.kind, s.content]),
    [
      ['heading', '1. Introduction'],
      ['paragraph', 'This is a paragraph about the topic. It has a period at the end.'],
      ['list', '• First point\n• Second point'],
      ['heading', 'Conclusion'],
      ['paragraph', 'We summarize the key findings here. The conclusion spans only one line.'],
    ],
  );
  for (const s of payload.sections) assert.equal(s.source, 'pymupdf');
  // page provenance intact, line numbers in range
  assert.deepEqual(
    payload.sections.map((s) => s.page),
    [1, 1, 1, 2, 2],
  );
  // page number "3" at the bottom boundary was excluded — never silently
  const excludes = payload.summary.findings.exclude;
  assert.equal(excludes, 1);
  assert.equal(payload.summary.findings.keep, 2); // one page-boundary per page
  assert.equal(payload.summary.blocks, 5);
  assert.equal(mappings.length, 0);
  assert.deepEqual(
    segments.map((s) => [s.kind, s.title]),
    [
      ['section', '1. Introduction'],
      ['section', 'Conclusion'],
    ],
  );
  assert.equal(payload.cleanedText, payload.sections.map((s) => s.content).join('\n\n'));
});

test('running header and footer are excluded with content preserved', () => {
  const pages: EnhancePage[] = [
    { page: 1, ...PR, text: 'GLOBAL ACADEMY\nBody text of page one.\nCONFIDENTIAL\n' },
    { page: 2, ...PR, text: 'GLOBAL ACADEMY\nBody text of page two.\nCONFIDENTIAL\n' },
    { page: 3, ...PR, text: 'GLOBAL ACADEMY\nBody text of page three.\nCONFIDENTIAL\n' },
  ];
  const { payload, segments } = enhanceMaterial(pages);
  assert.deepEqual(payload.sections.map((s) => s.content), [
    'Body text of page one.',
    'Body text of page two.',
    'Body text of page three.',
  ]);
  const excluded = payload.summary.findings.exclude;
  assert.equal(excluded, 6); // header + footer on each page
  void segments;
});

test('duplicated lines on a page are excluded (consecutive exact repeats)', () => {
  const { payload } = enhanceMaterial([
    { page: 1, ...PR, text: 'Repeated line\nRepeated line\nRest of the document here.\n' },
  ]);
  assert.deepEqual(payload.sections.map((s) => s.content), ['Repeated line Rest of the document here.']);
  assert.equal(payload.summary.findings.exclude, 1);
});

test('verbatim duplicate page is excluded as one finding, not twice as content', () => {
  const body = 'Alpha\nBeta\n';
  const { payload } = enhanceMaterial([
    { page: 1, ...PR, text: body },
    { page: 2, ...PR, text: body },
  ]);
  assert.equal(payload.pages, 2);
  assert.deepEqual(payload.sections.map((s) => s.content), ['Alpha Beta']);
  assert.equal(payload.summary.findings.exclude, 1);
});

test('single-page document keeps its lone page number (no confident exclusion)', () => {
  const { payload } = enhanceMaterial([{ page: 1, ...PR, text: 'What is the answer?\n10\n' }]);
  assert.equal(payload.summary.findings.exclude, 0);
  assert.deepEqual(payload.sections.map((s) => s.content), ['What is the answer? 10']);
});

test('broken hyphenation across lines is joined (KEEP finding, raw kept)', () => {
  const { payload } = enhanceMaterial([
    { page: 1, ...PR, text: 'The committee contin-\nues its review process here.\n' },
  ]);
  assert.deepEqual(payload.sections.map((s) => s.content), [
    'The committee continues its review process here.',
  ]);
  assert.equal(payload.summary.findings.keep, 2); // hyphenation-joined + page-boundary
  assert.equal(payload.summary.findings.review, 0);
});

test('garbled ASCII text is flagged REVIEW but kept', () => {
  const { payload } = enhanceMaterial([
    { page: 1, ...PR, text: '~~~~!!##$$%%\nReal content follows on the next line.\n' },
  ]);
  assert.equal(payload.summary.findings.review, 1);
  assert.ok(payload.sections.some((s) => s.content === '~~~~!!##$$%% Real content follows on the next line.'));
});

test('empty input is rejected', () => {
  assert.throws(() => enhanceMaterial([]), /at least one page/);
});

test('sourceFingerprint is deterministic and sensitive to input', () => {
  const a: EnhancePage[] = [{ page: 1, ...PR, text: 'one' }];
  const b: EnhancePage[] = [{ page: 1, ...PR, text: 'two' }];
  assert.equal(sourceFingerprint(a), sourceFingerprint(a));
  assert.notEqual(sourceFingerprint(a), sourceFingerprint(b));
});

test('logical segmentation: headings open segments, unheaded prefix is "other", page ranges tracked', () => {
  const pages: EnhancePage[] = [
    {
      page: 1,
      ...PR,
      text: 'This document explains financial statements and their preparation.\n',
    },
    {
      page: 2,
      ...PR,
      text: 'Chapter 1: The Accounting Cycle\nAn accounting cycle records every financial transaction of the firm.\n',
    },
    {
      page: 3,
      ...PR,
      text: '1. Cash Flow Statements\nCash flow statements report the movement of funds within the company.\n',
    },
  ];
  const { segments, mappings } = enhanceMaterial(pages);
  assert.equal(mappings.length, 0);
  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((s) => [s.kind, s.title, s.startPage, s.endPage, s.blockIds]),
    [
      ['other', null, 1, 1, ['b1']],
      ['chapter', 'Chapter 1: The Accounting Cycle', 2, 2, ['b2', 'b3']],
      ['section', '1. Cash Flow Statements', 3, 3, ['b4', 'b5']],
    ],
  );
  assert.equal(segments[1]!.title, 'Chapter 1: The Accounting Cycle');
  assert.ok(segments[1]!.preview.startsWith('Chapter 1: The Accounting Cycle'));
  assert.equal(segments[2]!.preview, '1. Cash Flow Statements\n\nCash flow statements report the movement of funds within the company.');
});

test('segments map to chapter/topic targets as relevant, unmatched to irrelevant', () => {
  const pages: EnhancePage[] = [
    { page: 1, ...PR, text: 'Chapter 1: The Accounting Cycle\nAn accounting cycle records every financial transaction of the firm.\n' },
    { page: 2, ...PR, text: '1. Cash Flow Statements\nThe cash flow statement shows the flow of funds across the period.\n' },
    { page: 3, ...PR, text: '2. Human Resource Strategy\nHiring and workforce planning are important strategic duties.\n' },
  ];
  const { segments, mappings } = enhanceMaterial(pages, [
    { type: 'chapter', title: 'The Accounting Cycle', syllabusId: null, subjectId: 'sub1', chapterId: 'c1', chapterName: 'The Accounting Cycle', topicId: null, topicName: null, unitTitle: null },
    { type: 'topic', title: 'Cash Flow Statements', syllabusId: null, subjectId: 'sub1', chapterId: 'c2', chapterName: 'Financial Statements', topicId: 't1', topicName: 'Cash Flow Statements', unitTitle: null },
    { type: 'topic', title: 'Partnership Valuation', syllabusId: null, subjectId: 'sub1', chapterId: null, chapterName: null, topicId: 't2', topicName: 'Partnership Valuation', unitTitle: null },
  ]);
  assert.deepEqual(segments.map((s) => s.level), ['relevant', 'relevant', 'irrelevant']);
  assert.equal(mappings.length, 2);
  assert.deepEqual(
    mappings.map((m) => [m.segmentIndex, m.type, m.level, m.chapterId, m.topicId]),
    [
      [0, 'chapter', 'relevant', 'c1', null],
      [1, 'topic', 'relevant', 'c2', 't1'],
    ],
  );
  assert.equal(mappings[0]!.confidence, 1);
  assert.ok(mappings[0]!.reason.includes('The Accounting Cycle'));
  assert.equal(mappings[1]!.reason, 'topic "Cash Flow Statements"');
});

test('a weak single-word overlap maps uncertain, a full overlap relevant', () => {
  const pages: EnhancePage[] = [
    { page: 1, ...PR, text: '1. Physics Lab\nWe study the motion of objects in the physics laboratory.\n' },
    { page: 2, ...PR, text: '2. Fundamentals of Optics\nPhysics fundamentals determine how light bends.\n' },
  ];
  const { segments, mappings } = enhanceMaterial(pages, [
    { type: 'topic', title: 'Fundamentals of Physics', syllabusId: null, subjectId: 'sub1', chapterId: null, chapterName: null, topicId: 't3', topicName: 'Fundamentals of Physics', unitTitle: null },
  ]);
  assert.deepEqual(segments.map((s) => s.level), ['uncertain', 'relevant']);
  assert.deepEqual(mappings.map((m) => m.level), ['uncertain', 'relevant']);
  assert.equal(mappings[0]!.confidence, 0.5);
  assert.equal(mappings[1]!.confidence, 1);
});

test('no syllabus context → every segment is unmapped', () => {
  const { segments, mappings } = enhanceMaterial([
    { page: 1, ...PR, text: 'Introduction\nMaterial with no syllabus to align against.\n' },
  ]);
  assert.deepEqual(segments.map((s) => s.level), ['unmapped']);
  assert.equal(mappings.length, 0);
});

test('subject mappings are a fallback only and never mask a chapter/topic hit', () => {
  const pages: EnhancePage[] = [
    { page: 1, ...PR, text: '1. Physics Basics\nPhysics fundamentals guide every physics experiment.\n' },
    { page: 2, ...PR, text: '2. Modern History\nModern history records governance across the centuries.\n' },
  ];
  const { segments, mappings } = enhanceMaterial(pages, [
    { type: 'subject', title: 'Physics', syllabusId: null, subjectId: 'sub1', chapterId: null, chapterName: null, topicId: null, topicName: null, unitTitle: null },
    { type: 'subject', title: 'Modern History', syllabusId: null, subjectId: 'sub1', chapterId: null, chapterName: null, topicId: null, topicName: null, unitTitle: null },
    { type: 'topic', title: 'Physics Fundamentals', syllabusId: null, subjectId: 'sub1', chapterId: 'c1', chapterName: null, topicId: 't1', topicName: 'Physics Fundamentals', unitTitle: null },
  ]);
  // Segment 1 hits the topic (and also spells "Physics") yet only the topic maps.
  // Segment 2 has no chapter/topic hit → subject "Modern History" maps instead.
  assert.deepEqual(segments.map((s) => s.level), ['relevant', 'relevant']);
  assert.equal(mappings.length, 2);
  assert.deepEqual(
    mappings.map((m) => [m.segmentIndex, m.type, m.level]),
    [
      [0, 'topic', 'relevant'],
      [1, 'subject', 'relevant'],
    ],
  );
});

test('syllabus context-units map segments with provenance', () => {
  const { segments, mappings } = enhanceMaterial(
    [{ page: 1, ...PR, text: '1. Electric Circuits\nThe flow of electric charge and its measurement are described here.\n' }],
    [{ type: 'unit', title: 'Electric Circuits', syllabusId: 'syl1', subjectId: 'sub1', chapterId: null, chapterName: null, topicId: null, topicName: null, unitTitle: 'Electric Circuits' }],
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.level, 'relevant');
  assert.equal(mappings.length, 1);
  assert.deepEqual(
    [mappings[0]!.type, mappings[0]!.level, mappings[0]!.syllabusId, mappings[0]!.unitTitle],
    ['unit', 'relevant', 'syl1', 'Electric Circuits'],
  );
  void segments;
});

test('numbering-prefixed heading followed by prose stays a heading', () => {
  const { payload } = enhanceMaterial([
    { page: 1, ...PR, text: '1. Introduction\nThis is the introductory paragraph that follows the heading.\n' },
  ]);
  assert.deepEqual(payload.sections.map((s) => s.kind), ['heading', 'paragraph']);
});

test('numbered list items are not misclassified as headings', () => {
  const { payload } = enhanceMaterial([
    { page: 1, ...PR, text: '1. First option\n2. Second option\n3. Third option\n' },
  ]);
  assert.deepEqual(payload.sections.map((s) => s.kind), ['list']);
  assert.equal(payload.sections[0]!.content, '1. First option\n2. Second option\n3. Third option');
});