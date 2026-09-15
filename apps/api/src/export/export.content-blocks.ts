import { createHash } from 'node:crypto';

export type DocBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; title?: string; items: string[] }
  | { kind: 'flashcard'; front: string; back: string }
  | {
      kind: 'question';
      stem: string;
      type: string;
      difficulty: string;
      marks?: number;
      choices?: { id: string; text: string; correct: boolean }[];
      answerNote?: string;
      explanation?: string;
      showAnswer: boolean;
    }
  | { kind: 'table'; headers?: string[]; rows: string[][] }
  | {
      kind: 'formula';
      content: string;
      title?: string;
      explanation?: string;
      variables?: { symbol: string; meaning: string }[];
      example?: string;
      note?: string;
    }
  | { kind: 'example'; title?: string; content: string }
  | { kind: 'callout'; variant: string; content: string }
  | {
      kind: 'timeline';
      caption?: string;
      events: { period: string; title: string; description?: string }[];
    }
  | {
      kind: 'diagram';
      caption?: string;
      nodes: { id: string; label: string }[];
      edges: { from: string; to: string; label?: string }[];
    }
  | { kind: 'chart'; caption?: string; chartType: string; data: { label: string; value: number }[] }
  | {
      kind: 'further-learning';
      resources: { title: string; url: string; kind: string; note?: string }[];
    };

export interface DocumentModel {
  title: string;
  blocks: DocBlock[];
}

/** Deterministic digest of a document — the exported file is regenerated from
 * the same blocks, so a preview is valid only while its hash matches. */
export function docDigest(doc: DocumentModel): string {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

/** Preview = the exact document export would produce, plus its digest. The
 * export endpoints re-build the document and compare hashes, so exporting is
 * only possible for content that has actually been previewed: a missing or
 * stale hash returns 409 — no UI/API bypass. */
export interface ExportPreview {
  hash: string;
  document: DocumentModel;
}

export function buildPreview(doc: DocumentModel): ExportPreview {
  return { hash: docDigest(doc), document: doc };
}

function str(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

function strArr(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [];
}

export function questionDocBlock(args: {
  stem: string;
  type: string;
  difficulty: string | null;
  marks?: number | null;
  payload?: Record<string, unknown> | null;
  explanation?: string | null;
  includeAnswers: boolean;
  /* 'paper' renders a student-facing question: no difficulty, no answer
   * markers, no correct-choice flags, no explanation. 'teacher' (default)
   * renders the full annotated block for answer keys. */
  scope?: 'paper' | 'teacher';
}): DocBlock {
  const isPaper = args.scope === 'paper';
  const payload = args.payload ?? {};
  const correctId = payload['correctChoiceId'];
  const choices = (Array.isArray(payload['choices']) ? payload['choices'] : [])
    .map((c) => ({
      id: String((c as { id?: unknown })?.['id'] ?? ''),
      text: String((c as { text?: unknown })?.['text'] ?? ''),
      correct: !isPaper && (c as { id?: unknown })?.['id'] === correctId,
    }))
    .filter((c) => c.id && c.text);
  const fmt = (
    typeof payload['answerFormat'] === 'string' ? payload['answerFormat'] : args.type
  ).toUpperCase();
  let answerNote: string | undefined;
  if (args.includeAnswers && !isPaper) {
    if (fmt === 'FILL_IN_BLANK' && Array.isArray(payload['acceptableAnswers'])) {
      const acc = payload['acceptableAnswers'].map(String).filter((v) => v.length > 0);
      if (acc.length > 0) answerNote = acc.join(' / ');
    } else if (fmt === 'TRUE_FALSE') {
      if (payload['correctAnswer'] === true) answerNote = 'True';
      else if (payload['correctAnswer'] === false) answerNote = 'False';
    } else if (fmt === 'NUMERICAL') {
      const model = Number(payload['modelAnswer']);
      if (Number.isFinite(model)) answerNote = `≈ ${model}`;
    } else if (fmt === 'MATCHING' && payload['matches'] && typeof payload['matches'] === 'object') {
      const pairs = Object.entries(payload['matches'] as Record<string, unknown>);
      if (pairs.length > 0) answerNote = pairs.map(([l, r]) => `${l} → ${r}`).join(', ');
    }
  }
  return {
    kind: 'question',
    stem: args.stem,
    type: args.type,
    difficulty: isPaper ? '' : (args.difficulty ?? '').toUpperCase(),
    marks: args.marks ?? undefined,
    choices,
    answerNote,
    explanation: isPaper ? undefined : (args.explanation ?? undefined),
    showAnswer: isPaper ? false : args.includeAnswers,
  };
}

const rec = (x: unknown) => (x ?? {}) as Record<string, unknown>;
const recArr = (x: unknown) => (Array.isArray(x) ? x : []) as Record<string, unknown>[];

function furtherLearning(
  value: unknown,
): { title: string; url: string; kind: string; note?: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) => {
      const item = rec(r);
      return {
        title: str(item['title']) ?? '',
        url: str(item['url']) ?? '',
        kind: str(item['kind']) ?? 'resource',
        note: str(item['note']),
      };
    })
    .filter((r) => r.title && r.url);
}

export function contentBlocks(type: string, payload: Record<string, unknown>): DocBlock[] {
  const blocks: DocBlock[] = [];
  const title = str(payload['title']);
  if (title) blocks.push({ kind: 'heading', text: title });

  switch (type) {
    case 'NOTE': {
      const noteBlocks = payload['blocks'];
      if (Array.isArray(noteBlocks)) {
        for (const b of noteBlocks) {
          const btype = str(b?.['type']) ?? '';
          const content = str(b?.['content']) ?? '';
          if (btype === 'heading' && content) blocks.push({ kind: 'heading', text: content });
          else if (btype === 'paragraph' && content)
            blocks.push({ kind: 'paragraph', text: content });
          else if (btype === 'list') blocks.push({ kind: 'bullets', items: strArr(b?.['items']) });
          else if (btype === 'steps')
            blocks.push({ kind: 'steps', title: str(b?.['title']), items: strArr(b?.['items']) });
          else if (btype === 'table')
            blocks.push({
              kind: 'table',
              headers: strArr(b?.['headers']) || undefined,
              rows: recArr(b?.['rows']).map((r) => strArr(r)),
            });
          else if (btype === 'formula' && content)
            blocks.push({
              kind: 'formula',
              content,
              title: str(b?.['title']),
              explanation: str(b?.['explanation']),
              variables: recArr(b?.['variables'])
                .map((v) => ({ symbol: str(v['symbol']) ?? '', meaning: str(v['meaning']) ?? '' }))
                .filter((v) => v.symbol),
              example: str(b?.['example']),
              note: str(b?.['note']),
            });
          else if (btype === 'example' && content)
            blocks.push({ kind: 'example', title: str(b?.['title']), content });
          else if (btype === 'callout' && content)
            blocks.push({ kind: 'callout', variant: str(b?.['variant']) ?? 'note', content });
          else if (btype === 'timeline')
            blocks.push({
              kind: 'timeline',
              caption: str(b?.['caption']),
              events: recArr(b?.['events'])
                .map((e) => ({
                  period: str(e['period']) ?? '',
                  title: str(e['title']) ?? '',
                  description: str(e['description']),
                }))
                .filter((e) => e.title),
            });
          else if (btype === 'diagram')
            blocks.push({
              kind: 'diagram',
              caption: str(b?.['caption']),
              nodes: recArr(b?.['nodes']).map((n) => ({
                id: str(n['id']) ?? '',
                label: str(n['label']) ?? '',
              })),
              edges: recArr(b?.['edges'])
                .map((e) => ({
                  from: str(e['from']) ?? '',
                  to: str(e['to']) ?? '',
                  label: str(e['label']),
                }))
                .filter((e) => e.from && e.to),
            });
          else if (btype === 'chart')
            blocks.push({
              kind: 'chart',
              caption: str(b?.['caption']),
              chartType: str(b?.['chartType']) ?? 'bar',
              data: recArr(b?.['data'])
                .map((d) => ({ label: str(d['label']) ?? '', value: Number(d['value']) || 0 }))
                .filter((d) => d.label),
            });
        }
      }
      if (Array.isArray(payload['furtherLearning'])) {
        blocks.push({
          kind: 'further-learning',
          resources: furtherLearning(payload['furtherLearning']),
        });
      }
      return blocks;
    }
    case 'SUMMARY': {
      if (typeof payload['summary'] === 'string')
        blocks.push({ kind: 'paragraph', text: payload['summary'] });
      if (Array.isArray(payload['keyConcepts'])) {
        blocks.push({ kind: 'bullets', items: payload['keyConcepts'].map(String) });
      }
      if (Array.isArray(payload['importantPoints'])) {
        blocks.push({ kind: 'bullets', items: payload['importantPoints'].map(String) });
      }
      if (Array.isArray(payload['examples'])) {
        for (const ex of payload['examples']) {
          if (typeof ex?.['content'] === 'string') {
            blocks.push({ kind: 'example', title: str(ex['topic']), content: ex['content'] });
          }
        }
      }
      if (Array.isArray(payload['furtherLearning'])) {
        blocks.push({
          kind: 'further-learning',
          resources: furtherLearning(payload['furtherLearning']),
        });
      }
      return blocks;
    }
    case 'FLASHCARD_SET': {
      if (typeof payload['description'] === 'string')
        blocks.push({ kind: 'paragraph', text: payload['description'] });
      if (Array.isArray(payload['cards'])) {
        for (const c of payload['cards']) {
          if (typeof c?.['front'] === 'string' && typeof c?.['back'] === 'string') {
            blocks.push({ kind: 'flashcard', front: c['front'], back: c['back'] });
          }
        }
      }
      return blocks;
    }
    case 'IMPORTANT_CONCEPTS': {
      if (Array.isArray(payload['concepts'])) {
        for (const c of payload['concepts']) {
          if (typeof c?.['name'] === 'string') {
            const desc = typeof c?.['description'] === 'string' ? ` — ${c['description']}` : '';
            blocks.push({ kind: 'paragraph', text: `${c['name']}${desc}` });
          }
        }
      }
      return blocks;
    }
    case 'CORNELL_NOTE': {
      if (Array.isArray(payload['sections'])) {
        for (const s of payload['sections']) {
          const cue = str(s?.['cue']);
          const notes = str(s?.['notes']);
          if (cue !== undefined && notes !== undefined) {
            blocks.push({ kind: 'flashcard', front: cue, back: notes });
          }
        }
      }
      if (typeof payload['summary'] === 'string' && payload['summary'].length > 0) {
        blocks.push({ kind: 'paragraph', text: `Summary: ${payload['summary']}` });
      }
      return blocks;
    }
    default:
      return [{ kind: 'paragraph', text: JSON.stringify(payload, null, 2) }];
  }
}
