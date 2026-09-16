import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { buildXlsxBuffer } from './export.xlsx.ts';

test('xlsx: valid workbook with one sheet per table block', async () => {
  const buffer = await buildXlsxBuffer({
    title: 'Results',
    blocks: [
      { kind: 'heading', text: 'Attempts' },
      {
        kind: 'table',
        headers: ['Student', 'Score'],
        rows: [
          ['A', '4'],
          ['B', '6'],
        ],
      },
      { kind: 'heading', text: 'Topic performance' },
      {
        kind: 'table',
        headers: ['Topic', 'Accuracy'],
        rows: [['T1', '80%']],
      },
    ],
  });
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await zip.file('xl/workbook.xml')?.async('string');
  assert.ok(workbook?.includes('Attempts'));
  assert.ok(workbook?.includes('Topic performance'));
  const sheet2 = await zip.file('xl/worksheets/sheet2.xml')?.async('string');
  assert.ok(sheet2?.includes('Accuracy'));
});

test('xlsx: plain text stays unescaped, xml specials are escaped', async () => {
  const buffer = await buildXlsxBuffer({
    title: 'R',
    blocks: [
      { kind: 'heading', text: 'Notes' },
      {
        kind: 'table',
        headers: ['Header'],
        rows: [['a < b & c "q"']],
      },
    ],
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
  assert.ok(xml?.includes('&lt;'));
  assert.ok(xml?.includes('&amp;'));
});

test('xlsx: no tables produces an empty Content sheet', async () => {
  const buffer = await buildXlsxBuffer({ title: 'Empty', blocks: [{ kind: 'heading', text: 'X' }] });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
  assert.ok(xml?.includes('Content'));
});