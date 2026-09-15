import { test } from 'node:test';
import assert from 'node:assert/strict';

import puppeteer from 'puppeteer-core';
import { renderDocumentHtml, renderDocumentBodyHtml } from './render-html.ts';
import type { DocumentModel } from './export.content-blocks.ts';

/* Smoke test for the shared export renderer + Chromium PDF path.
 * Uses puppeteer-core directly (same launch args as PuppeteerService) because
 * native node --test type-stripping can't run Nest decorators or rewrite
 * .js → .ts imports; the service itself is a thin wrapper over these calls. */

const model: DocumentModel = {
  title: 'Smoke Test',
  blocks: [
    { kind: 'heading', text: 'Heading One' },
    { kind: 'paragraph', text: 'Paragraph with <tag> & "quotes"' },
    { kind: 'bullets', items: ['one', 'two'] },
  ],
};

test('body fragment carries shared styles', () => {
  const body = renderDocumentBodyHtml(model);
  assert.ok(body.includes('<style>'), 'fragment inlines styles');
  assert.ok(body.includes('doc-heading'), 'shared class names present');
  assert.ok(body.includes('doc-bullets'), 'block renderers emit shared classes');
});

test('full page html wraps the body fragment', () => {
  const html = renderDocumentHtml(model);
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'complete page starts with doctype');
  assert.ok(html.includes('</body>') && html.includes('</html>'), 'page closes properly');
});

if (process.env.SKIP_PDF !== '1') {
  test('chromium renders the shared html to a pdf', async () => {
    const browser = await puppeteer.launch({
      executablePath:
        process.env['PUPPETEER_EXECUTABLE_PATH'] ||
        process.env['CHROME_PATH'] ||
        '/usr/bin/google-chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(renderDocumentHtml(model), { waitUntil: 'load' });
      const pdf = Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        }),
      );
      assert.ok(pdf.length > 1000, `pdf has content (${pdf.length} bytes)`);
      assert.ok(pdf.subarray(0, 5).toString('latin1').startsWith('%PDF'), 'output is a PDF file');
    } finally {
      await browser.close();
    }
  });
}
