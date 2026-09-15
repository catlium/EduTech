// D5 coordinator pure logic — page validation + coverage checks, no NestJS.
// Run: pnpm --filter @catlium/api run test:ocr
import type { OcrPageDetail } from '@catlium/contracts';

/** Validate a worker's reported page list against a claimed chunk range.
 *  Rejects empty/oversized lists, out-of-range pages, and duplicates. */
export function validateChunkPages(
  pages: number[],
  startPage: number,
  endPage: number,
): void {
  if (!pages.length || pages.length > endPage - startPage + 1) {
    throw new Error('Page list does not fit the chunk range');
  }
  const seen = new Set<number>();
  for (const page of pages) {
    if (page < startPage || page > endPage) {
      throw new Error(`Page ${page} out of chunk range [${startPage}, ${endPage}]`);
    }
    if (seen.has(page)) {
      throw new Error(`Duplicate page ${page}`);
    }
    seen.add(page);
  }
}

/** True iff reported pages cover exactly {1..documentPages} with no gaps,
 *  overlaps, or extras. */
export function isCompleteCoverage(
  reportedPages: number[],
  documentPages: number,
): boolean {
  const reported = new Set(reportedPages);
  if (reported.size !== documentPages) return false;
  for (let p = 1; p <= documentPages; p++) {
    if (!reported.has(p)) return false;
  }
  return true;
}

// ── Per-page inspection / correction (pure) ─────────────────────────────

/** Minimal chunk shape sufficient for page derivation (subset of the row). */
export interface ChunkLike {
  chunkIndex: number;
  startPage: number;
  endPage: number;
  status: string;
  result: Record<string, unknown> | null;
}

export interface CorrectionLike {
  correctedText: string;
  correctedBy: string;
  correctedAt: string;
}

function pageEntriesOf(chunk: ChunkLike): Array<Record<string, unknown>> {
  const pages = chunk.result?.['pages'];
  return Array.isArray(pages) ? (pages as Array<Record<string, unknown>>) : [];
}

function chunkContaining(chunks: ChunkLike[], page: number): ChunkLike | undefined {
  return chunks.find((c) => c.startPage <= page && page <= c.endPage);
}

/** Per-page inspection rows for pages 1..pageCount. Status precedence:
 *  corrected (has a correction) > failed (chunk terminal-failed and no
 *  correction) > missing (submitted chunk but no page text) > extracted >
 *  pending. A submitted-but-empty page is `missing` so an incomplete result
 *  is never silently presented as complete. */
export function derivePageDetails(
  chunks: ChunkLike[],
  pageCount: number,
  corrections: Map<number, CorrectionLike>,
): OcrPageDetail[] {
  const rows: OcrPageDetail[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const correction = corrections.get(page);
    if (correction) {
      rows.push({
        page,
        status: 'corrected',
        source: sourceOf(chunks, page),
        text: textOf(chunks, page),
        correctedText: correction.correctedText,
        correctedBy: correction.correctedBy,
        correctedAt: correction.correctedAt,
      });
      continue;
    }

    const chunk = chunkContaining(chunks, page);
    if (chunk?.status === 'failed') {
      rows.push({ page, status: 'failed', source: null, text: null, correctedText: null, correctedBy: null, correctedAt: null });
      continue;
    }
    if (chunk?.status === 'submitted') {
      const entry = pageEntriesOf(chunk).find((p) => p['page'] === page);
      const text = typeof entry?.['text'] === 'string' ? entry['text'] : '';
      if (!entry || text.length === 0) {
        rows.push({ page, status: 'missing', source: null, text: null, correctedText: null, correctedBy: null, correctedAt: null });
        continue;
      }
      const source = entry['source'];
      rows.push({
        page,
        status: 'extracted',
        source: source === 'pymupdf' || source === 'paddleocr' ? source : null,
        text,
        correctedText: null,
        correctedBy: null,
        correctedAt: null,
      });
      continue;
    }
    rows.push({ page, status: 'pending', source: null, text: null, correctedText: null, correctedBy: null, correctedAt: null });
  }
  return rows;
}

/** Full-document text with corrections applied: page-by-page in order, a
 *  correction winning over the original OCR output for its page. Each page is
 *  a paragraph block; blank lines separate pages. Only `submitted` chunks
 *  contribute — callers must have proven complete coverage separately. */
export function aggregatePagesText(
  chunks: ChunkLike[],
  corrections: Map<number, string>,
): string {
  const lines: string[] = [];
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  for (const chunk of ordered) {
    if (chunk.status !== 'submitted') continue;
    const entries = pageEntriesOf(chunk).sort(
      (a, b) => Number(a['page']) - Number(b['page']),
    );
    for (const entry of entries) {
      const page = Number(entry['page']);
      const correction = corrections.get(page);
      lines.push(
        correction ?? (typeof entry['text'] === 'string' ? entry['text'] : ''),
      );
    }
  }

  return lines.filter((t) => t.length > 0).join('\n\n');
}

function sourceOf(chunks: ChunkLike[], page: number): 'pymupdf' | 'paddleocr' | null {
  const chunk = chunkContaining(chunks, page);
  if (!chunk) return null;
  const entry = pageEntriesOf(chunk).find((p) => p['page'] === page);
  const source = entry?.['source'];
  return source === 'pymupdf' || source === 'paddleocr' ? source : null;
}

function textOf(chunks: ChunkLike[], page: number): string | null {
  const chunk = chunkContaining(chunks, page);
  if (!chunk) return null;
  const entry = pageEntriesOf(chunk).find((p) => p['page'] === page);
  return entry && typeof entry['text'] === 'string' ? (entry['text'] as string) : null;
}