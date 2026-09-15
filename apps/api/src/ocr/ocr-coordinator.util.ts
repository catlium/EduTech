// D5 coordinator pure logic — page validation + coverage checks, no NestJS.
// Run: pnpm --filter @catlium/api run test:ocr

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