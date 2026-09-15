import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer-core';
import { renderDocumentHtml } from './render-html.js';
import type { DocumentModel } from './export.content-blocks.js';

/* Manages a shared Chromium browser instance for PDF generation.
 *
 * The browser is launched lazily on first request and kept alive for reuse.
 * `PUPPETEER_EXECUTABLE_PATH` configures the binary (defaults to
 * google-chrome on this machine). */
@Injectable()
export class PuppeteerService implements OnModuleDestroy {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly logger = new Logger(PuppeteerService.name);

  async pdf(model: DocumentModel): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      const html = renderDocumentHtml(model);
      await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '2.5cm', bottom: '2.5cm', left: '2.5cm', right: '2.5cm' },
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      const execPath =
        process.env['PUPPETEER_EXECUTABLE_PATH'] ||
        process.env['CHROME_PATH'] ||
        '/usr/bin/google-chrome';
      this.logger.log(`Launching Chromium from ${execPath}`);
      const b = await puppeteer.launch({
        executablePath: execPath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      });
      this.browser = b;
      this.launching = null;
      return b;
    })();

    return this.launching;
  }
}
