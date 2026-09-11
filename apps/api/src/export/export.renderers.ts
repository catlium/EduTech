import { Response } from 'express';

import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
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

async function sendDocx(res: Response, model: DocumentModel, filename: string): Promise<void> {
  const children = model.blocks.map(docxBlock);
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: model.title, heading: HeadingLevel.TITLE }),
          ...children,
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
  res.send(buffer);
}

async function sendPdf(res: Response, model: DocumentModel, filename: string): Promise<void> {
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text(model.title, { align: 'center' });
  doc.moveDown();
  for (const block of model.blocks) {
    renderPdfBlock(doc, block);
  }
  doc.end();
}

function renderPdfBlock(doc: PDFKit.PDFDocument, block: DocBlock): void {
  switch (block.kind) {
    case 'heading':
      doc.fontSize(14).text(block.text);
      doc.moveDown(0.5);
      break;
    case 'paragraph':
      doc.fontSize(11).text(block.text);
      doc.moveDown(0.5);
      break;
    case 'bullets':
      block.items.forEach((item) => doc.fontSize(11).text(`• ${item}`));
      doc.moveDown(0.5);
      break;
    case 'flashcard':
      doc.fontSize(11).text(block.front);
      doc.moveDown(0.5);
      doc.fontSize(11).text(block.back);
      doc.moveDown(0.5);
      break;
    case 'question':
      doc.fontSize(11).text(`Q: ${block.stem} (${block.type}, ${block.difficulty})`);
      doc.moveDown(0.5);
      break;
  }
}

function docxBlock(block: DocBlock): Paragraph {
  switch (block.kind) {
    case 'heading':
      return new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1 });
    case 'paragraph':
      return new Paragraph({ text: block.text });
    case 'bullets':
      return new Paragraph({ text: block.items.map((i) => `• ${i}`).join('\n') });
    case 'flashcard':
      return new Paragraph({ text: `${block.front}\n${block.back}`, spacing: { after: 120 } });
    case 'question':
      return new Paragraph({ text: `Q: ${block.stem} (${block.type}, ${block.difficulty})` });
  }
}