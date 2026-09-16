import JSZip from 'jszip';

import type { DocumentModel } from './export.content-blocks.js';

/* Minimal-but-valid .xlsx: one zipped worksheet per table block, named after
 * the nearest preceding block heading. Pure builder (no express) so tests can
 * drive it directly. */
const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeXml = (v: string): string =>
  v.replace(/[&<>"]/g, (c) => XML_ESCAPE[c] ?? c);

const sheetName = (raw: string): string =>
  raw.replace(/[[\]*?/\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';

const CELL = (v: string): string =>
  `<c t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;

const sheetXml = (headers: string[], rows: string[][]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\
<sheetData>\
<row>${headers.map(CELL).join('')}</row>\
${rows.map((r) => `<row>${r.map(CELL).join('')}</row>`).join('')}\
</sheetData></worksheet>`;

export async function buildXlsxBuffer(model: DocumentModel): Promise<Buffer> {
  const zip = new JSZip();
  const sheets: { name: string; xml: string }[] = [];
  let currentName = 'Sheet1';
  for (const block of model.blocks) {
    if (block.kind === 'heading') currentName = block.text;
    if (block.kind === 'table') {
      sheets.push({ name: sheetName(currentName), xml: sheetXml(block.headers ?? [], block.rows) });
    }
  }
  if (sheets.length === 0) {
    sheets.push({ name: 'Sheet1', xml: sheetXml(['Content'], []) });
  }

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
<Default Extension="xml" ContentType="application/xml"/>\
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\
</Relationships>`,
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\
<sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>\
</workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}\
</Relationships>`,
  );
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));

  return zip.generateAsync({ type: 'nodebuffer' });
}