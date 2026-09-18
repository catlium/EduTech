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

  const { payload, alignment } = enhanceMaterial(pages);

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
  assert.equal(alignment.length, 0);
  assert.equal(payload.cleanedText, payload.sections.map((s) => s.content).join('\n\n'));
});

test('running header and footer are excluded with content preserved', () => {
  const pages: EnhancePage[] = [
    { page: 1, ...PR, text: 'GLOBAL ACADEMY\nBody text of page one.\nCONFIDENTIAL\n' },
    { page: 2, ...PR, text: 'GLOBAL ACADEMY\nBody text of page two.\nCONFIDENTIAL\n' },
    { page: 3, ...PR, text: 'GLOBAL ACADEMY\nBody text of page three.\nCONFIDENTIAL\n' },
  ];
  const { payload, alignment } = enhanceMaterial(pages);
  assert.deepEqual(payload.sections.map((s) => s.content), [
    'Body text of page one.',
    'Body text of page two.',
    'Body text of page three.',
  ]);
  const excluded = payload.summary.findings.exclude;
  assert.equal(excluded, 6); // header + footer on each page
  void alignment;
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

test('syllabus alignment maps blocks to confirmed units as metadata', () => {
  const pages: EnhancePage[] = [
    {
      page: 1,
      ...PR,
      text: 'Electric Circuits\nThe flow of electric charge and its measurement tell us about circuits.\nBusiness Management\nManaging time inside the classroom is a core management skill.\n',
    },
  ];
  const { alignment } = enhanceMaterial(pages, [
    { syllabusId: 's1', unitTitle: 'Electric Circuits' },
    { syllabusId: 's2', unitTitle: 'Management of Time' },
  ]);
  assert.equal(alignment.length, 2);
  assert.deepEqual(alignment[0]!.blockIds, ['b1']);
  assert.ok(alignment[0]!.confidence >= 0.5);
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