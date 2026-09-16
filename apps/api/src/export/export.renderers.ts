import { Response } from 'express';

import { buildXlsxBuffer } from './export.xlsx.js';

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
  TabStopType,
  SimpleField,
  PageBreak,
} from 'docx';

import type { DocBlock, DocumentModel } from './export.content-blocks.js';

/* DOCX renders through the structured `docx` library. PDF renders through the
 * shared Puppeteer/Chromium path in PuppeteerService — never a second layout. */
export function sendDoc(res: Response, model: DocumentModel, filename: string): void {
  void sendDocx(res, model, filename);
}

// ── XLSX ──────────────────────────────────────────────────────────────

export async function sendXlsx(res: Response, model: DocumentModel, filename: string): Promise<void> {
  const buffer = await buildXlsxBuffer(model);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(buffer);
}

// ── DOCX ─────────────────────────────────────────────────────────────

async function sendDocx(res: Response, model: DocumentModel, filename: string): Promise<void> {
  let qNo = 0;
  const children = model.blocks.flatMap((b) => {
    if (b.kind === 'heading') qNo = 0;
    if (b.kind === 'question' && !b.showAnswer) qNo += 1;
    return docxBlock(b, qNo);
  });
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

function docxBlock(block: DocBlock, qNo: number): (Paragraph | Table)[] {
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
      if (!block.showAnswer) {
        /* Student paper: plain numbered row with marks right-aligned (via a
         * right tab stop); no type/difficulty chrome (mirrors the HTML). */
        const pops: TextRun[] = [
          new TextRun({ text: `${qNo}. `, bold: true }),
          new TextRun({ text: block.stem }),
        ];
        if (block.marks != null) {
          pops.push(new TextRun({ text: '\t' }));
          pops.push(
            new TextRun({
              text: `${block.marks} mark${block.marks === 1 ? '' : 's'}`,
            }),
          );
        }
        out.push(
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: 9072 }],
            children: pops,
          }),
        );
      } else {
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
      }
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
