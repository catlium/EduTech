'use client';

/* Renders the server-produced preview HTML exactly as the exported PDF will
 * look: the markup + inline styles come from the API's single shared renderer
 * (render-html.ts), so preview and Puppeteer PDF are one representation. */

export function RenderDocHtml({ html }: { html: string }) {
  return (
    <div
      className="export-preview"
      dangerouslySetInnerHTML={{ __html: html }}
      aria-label="Document preview"
    />
  );
}
