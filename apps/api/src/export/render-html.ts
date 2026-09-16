import type { DocumentModel, DocBlock } from './export.content-blocks.js';

/* Pure function — DocumentModel → complete HTML page.
 *
 * This single renderer is the canonical visual representation shared between:
 *   • the web preview (<DocBlocks> uses the same class names + structure)
 *   • the Puppeteer PDF export (Chromium renders this exact HTML/CSS)
 *
 * Preview and exported PDF must use the same visual document representation.
 * Do NOT introduce a second independent layout implementation. */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBlock(b: DocBlock, qNo: number): string {
  switch (b.kind) {
    case 'heading':
      return `<h2 class="doc-heading">${esc(b.text)}</h2>`;
    case 'paragraph':
      return `<p class="doc-paragraph">${esc(b.text)}</p>`;
    case 'bullets':
      return `<ul class="doc-bullets">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'steps':
      return `<div class="doc-steps">${b.title ? `<p class="doc-steps-title">${esc(b.title)}</p>` : ''}<ol>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol></div>`;
    case 'flashcard':
      return `<div class="doc-flashcard"><div class="doc-flashcard-front"><strong>Q:</strong> ${esc(b.front)}</div><div class="doc-flashcard-back"><strong>A:</strong> ${esc(b.back)}</div></div>`;
    case 'question': {
      const choices =
        b.choices && b.choices.length > 0
          ? `<ol class="doc-choices">${b.choices.map((c) => `<li${b.showAnswer && c.correct ? ' class="correct"' : ''}>${esc(c.text)}${b.showAnswer && c.correct ? ' ✓' : ''}</li>`).join('')}</ol>`
          : '';

      /* Student paper: clean numbered row, no type/difficulty card chrome.
       * Teacher answer-key: annotated card with meta + answer + explanation. */
      if (!b.showAnswer) {
        const marks =
          typeof b.marks === 'number' ? `${b.marks} mark${b.marks === 1 ? '' : 's'}` : '';
        return `<div class="doc-q-row"><span class="doc-q-num">${qNo}.</span><div class="doc-q-body"><p class="doc-question-stem">${esc(b.stem)}</p>${choices}</div>${marks ? `<span class="doc-q-marks">${esc(marks)}</span>` : ''}</div>`;
      }

      const meta = [
        b.type,
        b.difficulty,
        typeof b.marks === 'number' ? `${b.marks} mark${b.marks === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const answer =
        b.answerNote
          ? `<p class="doc-answer"><strong>Answer:</strong> ${esc(b.answerNote)}</p>`
          : '';
      const expl =
        b.explanation
          ? `<p class="doc-explanation"><strong>Explanation:</strong> ${esc(b.explanation)}</p>`
          : '';
      return `<div class="doc-question"><p class="doc-question-stem">${esc(b.stem)}</p>${meta ? `<p class="doc-question-meta">${esc(meta)}</p>` : ''}${choices}${answer}${expl}</div>`;
    }
    case 'table': {
      const headerRow = b.headers
        ? `<thead><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
        : '';
      const bodyRows = b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('');
      return `<div class="doc-table-wrap"><table class="doc-table">${headerRow}<tbody>${bodyRows}</tbody></table></div>`;
    }
    case 'formula': {
      const vars =
        b.variables && b.variables.length > 0
          ? `<div class="doc-formula-vars">${b.variables.map((v) => `<span class="doc-formula-var"><code>${esc(v.symbol)}</code> = ${esc(v.meaning)}</span>`).join('')}</div>`
          : '';
      return `<div class="doc-formula">${b.title ? `<p class="doc-formula-title"><strong>${esc(b.title)}</strong></p>` : ''}<p class="doc-formula-expr"><code>${esc(b.content)}</code></p>${vars}${b.explanation ? `<p class="doc-formula-explanation">${esc(b.explanation)}</p>` : ''}${b.example ? `<p class="doc-formula-example">Example: ${esc(b.example)}</p>` : ''}${b.note ? `<p class="doc-formula-note"><em>Note: ${esc(b.note)}</em></p>` : ''}</div>`;
    }
    case 'example':
      return `<div class="doc-example"><p>${b.title ? `<strong>${esc(b.title)}:</strong> ` : ''}${esc(b.content)}</p></div>`;
    case 'callout':
      return `<div class="doc-callout doc-callout-${esc(b.variant)}"><p>${esc(b.content)}</p></div>`;
    case 'timeline':
      return `<div class="doc-timeline">${b.caption ? `<p class="doc-timeline-caption"><strong>${esc(b.caption)}</strong></p>` : ''}<ul>${b.events.map((e) => `<li><span class="doc-timeline-period">${esc(e.period)}:</span> ${esc(e.title)}${e.description ? ` — ${esc(e.description)}` : ''}</li>`).join('')}</ul></div>`;
    case 'diagram': {
      const labels = b.nodes.map((n) => n.label).join(' → ');
      const edges = b.edges.map((e) => {
        const from = b.nodes.find((n) => n.id === e.from)?.label ?? e.from;
        const to = b.nodes.find((n) => n.id === e.to)?.label ?? e.to;
        return `${from} → ${to}${e.label ? ` (${e.label})` : ''}`;
      });
      return `<div class="doc-diagram">${b.caption ? `<p class="doc-diagram-caption"><strong>${esc(b.caption)}</strong></p>` : ''}<p class="doc-diagram-nodes">${esc(labels)}</p>${edges.length > 0 ? `<ul class="doc-diagram-edges">${edges.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div>`;
    }
    case 'chart':
      return `<div class="doc-chart">${b.caption ? `<p class="doc-chart-caption"><strong>${esc(b.caption)}</strong></p>` : ''}${b.data.map((d) => `<div class="doc-chart-row"><span class="doc-chart-label">${esc(d.label)}</span><div class="doc-chart-bar-wrap"><div class="doc-chart-bar" style="width:${Math.min(100, d.value)}%"></div></div><span class="doc-chart-value">${d.value}</span></div>`).join('')}</div>`;
    case 'further-learning':
      return `<div class="doc-further-learning"><p><strong>Further Learning</strong></p><ul>${b.resources.map((r) => `<li><a href="${esc(r.url)}">${esc(r.title)}</a> (${esc(r.kind)})${r.note ? ` — ${esc(r.note)}` : ''}</li>`).join('')}</ul></div>`;
    default:
      return '';
  }
}

/** Render a DocumentModel to a complete self-contained HTML page for
 *  Puppeteer/Chromium → exported PDF. */
export function renderDocumentHtml(model: DocumentModel): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(model.title)}</title>
  <style>${EXPORT_STYLES}</style>
</head>
<body>
  ${renderDocumentBodyHtml(model)}
</body>
</html>`;
}

/** Self-contained document body fragment — carries the shared styles inline so
 *  the web preview (dangerouslySetInnerHTML) renders the exact same visual
 *  representation as the Puppeteer PDF, from one CSS source. */
export function renderDocumentBodyHtml(model: DocumentModel): string {
  let qNo = 0;
  const blocks = model.blocks.map((b) => {
    if (b.kind === 'heading') qNo = 0;
    if (b.kind === 'question' && !b.showAnswer) qNo += 1;
    return renderBlock(b, qNo);
  });
  return `<style>${EXPORT_STYLES}</style>
<div class="doc-page">
  <h1 class="doc-title">${esc(model.title)}</h1>
  ${blocks.join('\n')}
</div>`;
}

/* The full print-quality stylesheet is inlined for Puppeteer (which renders
 * a raw HTML page without access to the app's build pipeline). Preview mode
 * in the web app uses the same CSS class names via an external stylesheet
 * import in doc-blocks.tsx so the visual representation is identical. */
const EXPORT_STYLES = `
/* ── Print-quality academic typography ─────────────────────────────── */

@page {
  size: A4;
  margin: 2.5cm;
}

@page :first {
  margin-top: 3cm;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  font-size: 11pt;
  line-height: 1.55;
  color: #1a1a1a;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.doc-page {
  max-width: 100%;
}

/* ── Title ──────────────────────────────────────────────────────────── */

.doc-title {
  font-size: 20pt;
  font-weight: 700;
  text-align: center;
  margin: 0 0 0.8cm;
  padding-bottom: 0.4cm;
  border-bottom: 2pt solid #1a1a1a;
  line-height: 1.3;
}

/* ── Headings ───────────────────────────────────────────────────────── */

.doc-heading {
  font-size: 14pt;
  font-weight: 700;
  margin: 1.2em 0 0.4em;
  padding-top: 0.6em;
  border-top: 0.5pt solid #d0d0d0;
  line-height: 1.3;
  page-break-after: avoid;
}

/* ── Body text ──────────────────────────────────────────────────────── */

.doc-paragraph {
  margin: 0.5em 0;
  text-align: justify;
  orphans: 3;
  widows: 3;
}

.doc-bullets {
  margin: 0.4em 0;
  padding-left: 1.5em;
}

.doc-bullets li {
  margin: 0.25em 0;
}

.doc-steps {
  margin: 0.5em 0;
}

.doc-steps-title {
  font-weight: 600;
  margin: 0 0 0.2em;
}

.doc-steps ol {
  margin: 0;
  padding-left: 1.5em;
}

.doc-steps ol li {
  margin: 0.2em 0;
}

/* ── Flashcards ─────────────────────────────────────────────────────── */

.doc-flashcard {
  border: 0.5pt solid #ccc;
  border-radius: 4pt;
  padding: 0.6em 0.8em;
  margin: 0.6em 0;
  page-break-inside: avoid;
}

.doc-flashcard-front {
  font-weight: 500;
}

.doc-flashcard-back {
  margin-top: 0.3em;
  color: #2d5016;
}

/* ── Questions ──────────────────────────────────────────────────────── */

.doc-question {
  border: 0.5pt solid #e0e0e0;
  border-radius: 4pt;
  padding: 0.6em 0.8em;
  margin: 0.6em 0;
  page-break-inside: avoid;
}

.doc-question-stem {
  font-weight: 500;
  margin: 0 0 0.2em;
}

.doc-question-meta {
  font-size: 9pt;
  color: #666;
  margin: 0 0 0.3em;
}

/* ── Student paper question row (number | stem | marks) ─────────────── */

.doc-q-row {
  display: flex;
  gap: 0.6em;
  align-items: flex-start;
  margin: 0.6em 0;
  page-break-inside: avoid;
}

.doc-q-num {
  font-weight: 600;
  min-width: 2em;
  flex-shrink: 0;
}

.doc-q-body {
  flex: 1;
  min-width: 0;
}

.doc-q-body .doc-question-stem {
  margin: 0;
  font-weight: normal;
}

.doc-q-marks {
  flex-shrink: 0;
  color: #555;
  font-size: 9.5pt;
  white-space: nowrap;
}

.doc-choices {
  margin: 0.3em 0;
  padding-left: 1.5em;
}

.doc-choices li {
  margin: 0.15em 0;
}

.doc-choices li.correct {
  color: #166534;
  font-weight: 600;
}

.doc-answer {
  margin-top: 0.4em;
  color: #166534;
  font-size: 10pt;
}

.doc-explanation {
  margin-top: 0.2em;
  color: #666;
  font-size: 9.5pt;
}

/* ── Tables ─────────────────────────────────────────────────────────── */

.doc-table-wrap {
  margin: 0.6em 0;
  overflow-x: auto;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
}

.doc-table th,
.doc-table td {
  border: 0.5pt solid #ccc;
  padding: 0.35em 0.6em;
  text-align: left;
  vertical-align: top;
}

.doc-table th {
  font-weight: 600;
  background: #f5f5f5;
}

.doc-table tbody tr:nth-child(even) {
  background: #fafafa;
}

/* ── Formula ────────────────────────────────────────────────────────── */

.doc-formula {
  border-left: 3pt solid #3b82f6;
  background: #f0f7ff;
  padding: 0.6em 0.8em;
  margin: 0.6em 0;
  border-radius: 0 4pt 4pt 0;
  page-break-inside: avoid;
}

.doc-formula-title {
  margin: 0 0 0.2em;
}

.doc-formula-expr {
  font-family: "Courier New", Courier, monospace;
  font-size: 11pt;
  margin: 0;
}

.doc-formula-expr code {
  font-family: inherit;
  font-size: inherit;
}

.doc-formula-vars {
  margin-top: 0.3em;
  font-size: 9.5pt;
}

.doc-formula-var {
  display: block;
  color: #555;
}

.doc-formula-var code {
  font-family: "Courier New", Courier, monospace;
  font-weight: 600;
}

.doc-formula-explanation,
.doc-formula-example,
.doc-formula-note {
  margin: 0.3em 0 0;
  font-size: 9.5pt;
  color: #555;
}

/* ── Example ────────────────────────────────────────────────────────── */

.doc-example {
  border-left: 3pt solid #f59e0b;
  background: #fffbeb;
  padding: 0.5em 0.8em;
  margin: 0.5em 0;
  border-radius: 0 4pt 4pt 0;
}

/* ── Callout ────────────────────────────────────────────────────────── */

.doc-callout {
  padding: 0.5em 0.8em;
  margin: 0.5em 0;
  border-radius: 4pt;
  font-size: 10pt;
}

.doc-callout-note {
  background: #eff6ff;
  border-left: 3pt solid #3b82f6;
}

.doc-callout-warning {
  background: #fefce8;
  border-left: 3pt solid #f59e0b;
}

.doc-callout-tip {
  background: #f0fdf4;
  border-left: 3pt solid #22c55e;
}

/* ── Timeline ───────────────────────────────────────────────────────── */

.doc-timeline {
  margin: 0.5em 0;
}

.doc-timeline-caption {
  margin: 0 0 0.2em;
}

.doc-timeline ul {
  margin: 0;
  padding-left: 1.5em;
}

.doc-timeline li {
  margin: 0.2em 0;
}

.doc-timeline-period {
  font-weight: 600;
}

/* ── Diagram ────────────────────────────────────────────────────────── */

.doc-diagram {
  margin: 0.5em 0;
}

.doc-diagram-caption {
  margin: 0 0 0.2em;
}

.doc-diagram-nodes {
  font-size: 10pt;
}

.doc-diagram-edges {
  margin: 0.2em 0;
  padding-left: 1.5em;
  font-size: 9.5pt;
  color: #555;
}

/* ── Chart ──────────────────────────────────────────────────────────── */

.doc-chart {
  margin: 0.5em 0;
}

.doc-chart-caption {
  margin: 0 0 0.3em;
}

.doc-chart-row {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin: 0.2em 0;
  font-size: 9.5pt;
}

.doc-chart-label {
  width: 10em;
  text-align: right;
  flex-shrink: 0;
}

.doc-chart-bar-wrap {
  flex: 1;
  height: 0.6em;
  background: #e5e7eb;
  border-radius: 2pt;
}

.doc-chart-bar {
  height: 100%;
  background: #3b82f6;
  border-radius: 2pt;
}

.doc-chart-value {
  width: 3em;
  text-align: right;
  font-size: 9pt;
  color: #666;
}

/* ── Further Learning ───────────────────────────────────────────────── */

.doc-further-learning {
  margin: 0.6em 0;
}

.doc-further-learning ul {
  margin: 0.2em 0;
  padding-left: 1.5em;
}

.doc-further-learning li {
  margin: 0.2em 0;
  font-size: 9.5pt;
}

.doc-further-learning a {
  color: #2563eb;
  text-decoration: none;
}

/* ── Print adjustments ──────────────────────────────────────────────── */

@media print {
  body {
    background: #fff;
  }
  .doc-heading {
    page-break-after: avoid;
  }
  .doc-question,
  .doc-flashcard,
  .doc-formula,
  .doc-example {
    page-break-inside: avoid;
  }
}
`;
