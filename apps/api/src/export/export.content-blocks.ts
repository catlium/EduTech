export type DocBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'flashcard'; front: string; back: string }
  | { kind: 'question'; stem: string; type: string; difficulty: string };

export interface DocumentModel {
  title: string;
  blocks: DocBlock[];
}

export function contentBlocks(type: string, payload: Record<string, unknown>): DocBlock[] {
  const blocks: DocBlock[] = [];
  const title = typeof payload['title'] === 'string' ? payload['title'] : undefined;
  if (title) blocks.push({ kind: 'heading', text: title });

  switch (type) {
    case 'NOTE': {
      const noteBlocks = payload['blocks'];
      if (Array.isArray(noteBlocks)) {
        for (const b of noteBlocks) {
          const content = typeof b?.['content'] === 'string' ? b['content'] : undefined;
          if (b?.['type'] === 'heading' && content) {
            blocks.push({ kind: 'heading', text: content });
          } else if (b?.['type'] === 'paragraph' && content) {
            blocks.push({ kind: 'paragraph', text: content });
          } else if (b?.['type'] === 'list' && Array.isArray(b['items'])) {
            blocks.push({ kind: 'bullets', items: b['items'].filter((i): i is string => typeof i === 'string') });
          }
        }
      }
      return blocks;
    }
    case 'SUMMARY': {
      if (typeof payload['summary'] === 'string') blocks.push({ kind: 'paragraph', text: payload['summary'] });
      if (Array.isArray(payload['keyConcepts'])) {
        blocks.push({ kind: 'bullets', items: payload['keyConcepts'].map(String) });
      }
      if (Array.isArray(payload['importantPoints'])) {
        blocks.push({ kind: 'bullets', items: payload['importantPoints'].map(String) });
      }
      return blocks;
    }
    case 'FLASHCARD_SET': {
      if (typeof payload['description'] === 'string') blocks.push({ kind: 'paragraph', text: payload['description'] });
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
    default:
      return [{ kind: 'paragraph', text: JSON.stringify(payload, null, 2) }];
  }
}