import { Response } from 'express';
import { existsSync } from 'node:fs';

import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  TableRow,
  TableCell,
  Table,
  Header,
  Footer,
  AlignmentType,
  SimpleField,
  PageBreak,
} from 'docx';
import PDFDocument from 'pdfkit';

import type { DocumentModel, DocBlock } from './export.content-blocks.js';

export function sendDoc(
  res: Response,
  model: DocumentModel,
  format: 'pdf' | 'docx',
  filename: string,
): void {
  if (format === 'docx') {
    void sendDocx(res, model, filename);
  } else {
    void sendPdf(res, model, filename);
  }
}

const FONT_DEVANAGARI = 'NotoSansDevanagari';
const DEVANAGARI_RANGE = /[\u0900-\u097F]/;

// Helvetica is WinAnsi-only; map non-encodable math glyphs to ASCII so they
// don't come out as .notdef boxes in the PDF.
function sanitizePdfText(s: string): string {
  return s
    .replace(/√/g, 'sqrt')
    .replace(/[−–]/g, '-')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/✓/g, '[Y]')
    .replace(/✗/g, '[N]')
    .replace(/…/g, '...');
}

function fontFor(text: string): string {
  return DEVANAGARI_RANGE.test(text) ? FONT_DEVANAGARI : 'Helvetica';
}

function pdfText(
  doc: PDFKit.PDFDocument,
  s: string,
  size = 11,
  opts?: Record<string, unknown>,
): void {
  const t = sanitizePdfText(s);
  doc.font(fontFor(t)).fontSize(size).text(t, opts);
}

// ── PDF ──────────────────────────────────────────────────────────────

async function sendPdf(res: Response, model: DocumentModel, filename: string): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  const fontUrl = new URL('../../assets/NotoSansDevanagari-Regular.ttf', import.meta.url);
  const fontPath = decodeURIComponent(fontUrl.pathname);
  if (existsSync(fontPath)) {
    doc.registerFont(FONT_DEVANAGARI, fontPath);
  }
  const headerText = sanitizePdfText(model.title.replace(/\n/g, ' '));
  doc.on('pageAdded', () => {
    pdfText(doc, headerText, 8, { align: 'right' });
    doc.moveDown();
  });
  doc.on('end', () => {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      pdfText(doc, `Page ${i + 1} of ${range.count}`, 8, { align: 'center' });
    }
  });
  pdfText(doc, model.title.replace(/\n/g, ' '), 20, { align: 'center' });
  doc.moveDown();
  for (const block of model.blocks) {
    renderPdfBlock(doc, block);
  }
  doc.end();
}

function renderPdfBlock(doc: PDFKit.PDFDocument, block: DocBlock): void {
  switch (block.kind) {
    case 'heading':
      pdfText(doc, block.text, 14);
      doc.moveDown(0.5);
      break;
    case 'paragraph':
      pdfText(doc, block.text, 11);
      doc.moveDown(0.5);
      break;
    case 'bullets':
      block.items.forEach((item) => pdfText(doc, `• ${item}`, 11));
      doc.moveDown(0.5);
      break;
    case 'steps':
      if (block.title) pdfText(doc, block.title, 11);
      block.items.forEach((item, i) => pdfText(doc, `${i + 1}. ${item}`, 11));
      doc.moveDown(0.5);
      break;
    case 'flashcard':
      pdfText(doc, `Front: ${block.front}`, 11);
      pdfText(doc, `Back:  ${block.back}`, 10);
      doc.moveDown(0.5);
      break;
    case 'question': {
      const tag = `Q: ${block.stem} (${block.type}${block.difficulty ? `, ${block.difficulty}` : ''}${block.marks != null ? ` — ${block.marks} mark${block.marks === 1 ? '' : 's'}` : ''})`;
      pdfText(doc, tag, 11);
      block.choices?.forEach((c, i) => {
        pdfText(
          doc,
          `  ${String.fromCharCode(65 + i)}. ${c.text}${block.showAnswer && c.correct ? ' ✓' : ''}`,
          10,
        );
      });
      if (block.answerNote) pdfText(doc, `Answer: ${block.answerNote}`, 10);
      if (block.explanation) pdfText(doc, `Explanation: ${block.explanation}`, 9);
      doc.moveDown(0.5);
      break;
    }
    case 'table': {
      pdfText(doc, (block.headers ?? []).join(' | '), 11);
      for (const row of block.rows) {
        pdfText(doc, row.join(' | '), 10);
      }
      doc.moveDown(0.5);
      break;
    }
    case 'formula': {
      if (block.title) pdfText(doc, block.title, 10.5);
      pdfText(doc, `  ${block.content}`, 11);
      block.variables?.forEach((v) => pdfText(doc, `  ${v.symbol} = ${v.meaning}`, 9));
      if (block.explanation) pdfText(doc, `  ${block.explanation}`, 10);
      if (block.example) pdfText(doc, `  Example: ${block.example}`, 10);
      if (block.note) pdfText(doc, `  Note: ${block.note}`, 9);
      doc.moveDown(0.5);
      break;
    }
    case 'example':
      pdfText(doc, `Example${block.title ? ` — ${block.title}` : ''}: ${block.content}`, 11);
      doc.moveDown(0.5);
      break;
    case 'callout':
      pdfText(doc, `[${block.variant.toUpperCase()}] ${block.content}`, 10);
      doc.moveDown(0.5);
      break;
    case 'timeline':
      if (block.caption) pdfText(doc, block.caption, 11);
      block.events.forEach((e) =>
        pdfText(doc, `${e.period}: ${e.title}${e.description ? ` — ${e.description}` : ''}`, 10),
      );
      doc.moveDown(0.5);
      break;
    case 'diagram': {
      if (block.caption) pdfText(doc, block.caption, 11);
      const labels = block.nodes.map((n) => n.label);
      pdfText(doc, `Nodes: ${labels.join(', ')}`, 10);
      if (block.edges.length > 0) {
        const edges = block.edges.map(
          (e) =>
            `${block.nodes.find((n) => n.id === e.from)?.label ?? e.from} → ${block.nodes.find((n) => n.id === e.to)?.label ?? e.to}${e.label ? ` (${e.label})` : ''}`,
        );
        edges.forEach((e) => pdfText(doc, `  ${e}`, 10));
      }
      doc.moveDown(0.5);
      break;
    }
    case 'chart':
      if (block.caption) pdfText(doc, block.caption, 11);
      block.data.forEach((d) => pdfText(doc, `${d.label}: ${d.value}`, 10));
      doc.moveDown(0.5);
      break;
    case 'further-learning':
      pdfText(doc, 'Further Learning:', 10);
      block.resources.forEach((r) =>
        pdfText(doc, `• ${r.title} (${r.kind}) — ${r.url}${r.note ? ` — ${r.note}` : ''}`, 9),
      );
      doc.moveDown(0.5);
      break;
  }
}

// ── DOCX ─────────────────────────────────────────────────────────────

async function sendDocx(res: Response, model: DocumentModel, filename: string): Promise<void> {
  const children = model.blocks.flatMap(docxBlock);
  const doc = new Document({
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: model.title, size: 18, color: '666666' })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Page ' }),
                  new SimpleField('PAGE'),
                  new TextRun({ text: ' of ' }),
                  new SimpleField('NUMPAGES'),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ text: model.title, heading: HeadingLevel.TITLE }),
          new Paragraph({ children: [new PageBreak()] }),
          ...children,
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
  res.send(buffer);
}

function docxBlock(block: DocBlock): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  switch (block.kind) {
    case 'heading':
      out.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1 }));
      break;
    case 'paragraph':
      out.push(new Paragraph({ text: block.text }));
      break;
    case 'bullets':
      out.push(...block.items.map((item) => new Paragraph({ text: item, bullet: { level: 0 } })));
      break;
    case 'steps':
      if (block.title)
        out.push(new Paragraph({ children: [new TextRun({ text: block.title, bold: true })] }));
      out.push(...block.items.map((item, n) => new Paragraph({ text: `${n + 1}. ${item}` })));
      break;
    case 'flashcard':
      out.push(
        new Paragraph({
          text: `Front: ${block.front}\nBack: ${block.back}`,
          spacing: { after: 120 },
        }),
      );
      break;
    case 'question': {
      out.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Q: ${block.stem}`, bold: true }),
            new TextRun({
              text: ` (${block.type}${block.difficulty ? `, ${block.difficulty}` : ''}${block.marks != null ? ` — ${block.marks} mark${block.marks === 1 ? '' : 's'}` : ''})`,
            }),
          ],
        }),
      );
      block.choices?.forEach((c, i) => {
        out.push(
          new Paragraph({
            text: `  ${String.fromCharCode(65 + i)}. ${c.text}${block.showAnswer && c.correct ? ' ✓' : ''}`,
          }),
        );
      });
      if (block.answerNote)
        out.push(
          new Paragraph({
            children: [new TextRun({ text: `Answer: ${block.answerNote}`, italics: true })],
          }),
        );
      if (block.explanation) out.push(new Paragraph({ text: `Explanation: ${block.explanation}` }));
      break;
    }
    case 'table': {
      const rows: TableRow[] = [];
      if (block.headers) {
        rows.push(
          new TableRow({
            children: block.headers.map(
              (h) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                }),
            ),
          }),
        );
      }
      for (const row of block.rows) {
        rows.push(
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ text: cell })],
                }),
            ),
          }),
        );
      }
      out.push(new Table({ rows }));
      break;
    }
    case 'formula': {
      if (block.title)
        out.push(new Paragraph({ children: [new TextRun({ text: block.title, bold: true })] }));
      out.push(
        new Paragraph({
          children: [new TextRun({ text: block.content, font: 'Courier New', size: 20 })],
        }),
      );
      block.variables?.forEach((v) =>
        out.push(new Paragraph({ text: `${v.symbol} = ${v.meaning}` })),
      );
      if (block.explanation) out.push(new Paragraph({ text: block.explanation }));
      if (block.example) out.push(new Paragraph({ text: `Example: ${block.example}` }));
      if (block.note)
        out.push(
          new Paragraph({
            children: [new TextRun({ text: `Note: ${block.note}`, italics: true })],
          }),
        );
      break;
    }
    case 'example':
      out.push(
        new Paragraph({
          text: `Example${block.title ? ` — ${block.title}` : ''}: ${block.content}`,
        }),
      );
      break;
    case 'callout':
      out.push(new Paragraph({ text: `[${block.variant.toUpperCase()}] ${block.content}` }));
      break;
    case 'timeline':
      if (block.caption) out.push(new Paragraph({ text: block.caption }));
      block.events.forEach((e) =>
        out.push(
          new Paragraph({
            text: `${e.period}: ${e.title}${e.description ? ` — ${e.description}` : ''}`,
          }),
        ),
      );
      break;
    case 'diagram': {
      if (block.caption) out.push(new Paragraph({ text: block.caption }));
      const nodes = block.nodes.map((n) => n.label).join(', ');
      out.push(new Paragraph({ text: `Nodes: ${nodes}` }));
      block.edges.forEach((e) => {
        const from = block.nodes.find((n) => n.id === e.from)?.label ?? e.from;
        const to = block.nodes.find((n) => n.id === e.to)?.label ?? e.to;
        out.push(new Paragraph({ text: `${from} → ${to}${e.label ? ` (${e.label})` : ''}` }));
      });
      break;
    }
    case 'chart':
      if (block.caption) out.push(new Paragraph({ text: block.caption }));
      block.data.forEach((d) => out.push(new Paragraph({ text: `${d.label}: ${d.value}` })));
      break;
    case 'further-learning':
      out.push(
        new Paragraph({ children: [new TextRun({ text: 'Further Learning:', bold: true })] }),
      );
      block.resources.forEach((r) =>
        out.push(
          new Paragraph({
            text: `• ${r.title} (${r.kind}) — ${r.url}${r.note ? ` — ${r.note}` : ''}`,
          }),
        ),
      );
      break;
  }
  return out;
}
