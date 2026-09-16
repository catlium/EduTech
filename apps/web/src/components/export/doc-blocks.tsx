'use client';

/* Client renderer for the export DocumentModel. Mirrors the server's
 * DocBlock union in apps/api/src/export/export.content-blocks.ts — the HTML
 * preview and the PDF/DOCX export are generated from the SAME blocks, so
 * what you preview is exactly what gets exported. */

export interface DocBlockQuestion {
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

export type DocBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; title?: string; items: string[] }
  | { kind: 'flashcard'; front: string; back: string }
  | DocBlockQuestion
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

function QuestionBlock({ b, number }: { b: DocBlockQuestion; number: number }) {
  /* Student paper: numbered row, no card chrome.
   * Teacher answer-key: annotated card with type/difficulty + answers. */
  if (!b.showAnswer) {
    return (
      <div className="flex items-start gap-2 py-1.5">
        <span className="shrink-0 font-semibold tabular-nums">{number}.</span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-sm">{b.stem}</p>
          {b.choices && b.choices.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {b.choices.map((c) => (
                <div key={c.id} className="flex items-start gap-2 text-sm">
                  <span>•</span>
                  <span>{c.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {typeof b.marks === 'number' && (
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {b.marks} mark{b.marks !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium">{b.type}</span>
        {b.difficulty && <span>{b.difficulty}</span>}
        {typeof b.marks === 'number' && (
          <span>
            {b.marks} mark{b.marks !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm">{b.stem}</p>
      {b.choices && b.choices.length > 0 && (
        <div className="mt-2 space-y-1">
          {b.choices.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm">
              <span className={c.correct ? 'font-medium text-emerald-600' : ''}>
                {c.correct ? '✓' : '•'}
              </span>
              <span className={c.correct ? 'font-medium text-emerald-600' : ''}>{c.text}</span>
            </div>
          ))}
        </div>
      )}
      {b.showAnswer && b.answerNote && (
        <p className="mt-2 text-sm text-emerald-700">
          <span className="font-medium">Answer:</span> {b.answerNote}
        </p>
      )}
      {b.showAnswer && b.explanation && (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium">Explanation:</span> {b.explanation}
        </p>
      )}
    </div>
  );
}

export function DocBlocks({ model }: { model: DocumentModel }) {
  let qNo = 0;
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{model.title}</h3>
      {model.blocks.map((b, i) => {
        if (b.kind === 'heading') qNo = 0;
        if (b.kind === 'question' && !b.showAnswer) qNo += 1;
        switch (b.kind) {
          case 'heading':
            return (
              <h4 key={i} className="text-base font-semibold">
                {b.text}
              </h4>
            );
          case 'paragraph':
            return (
              <p key={i} className="whitespace-pre-wrap text-sm">
                {b.text}
              </p>
            );
          case 'bullets':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 text-sm">
                {b.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case 'steps':
            return (
              <div key={i} className="rounded-md bg-muted p-3">
                {b.title && <p className="text-sm font-medium">{b.title}</p>}
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                  {b.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ol>
              </div>
            );
          case 'flashcard':
            return (
              <div key={i} className="rounded-md border p-3 text-sm">
                <p>
                  <span className="font-medium">Front:</span> {b.front}
                </p>
                <p className="mt-1">
                  <span className="font-medium">Back:</span> {b.back}
                </p>
              </div>
            );
          case 'question':
            return <QuestionBlock key={i} b={b} number={qNo} />;
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  {b.headers && (
                    <thead className="bg-muted">
                      <tr>
                        {b.headers.map((h, j) => (
                          <th key={j} className="border-b px-3 py-1.5 text-left font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k} className="border-b px-3 py-1.5 align-top">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'formula':
            return (
              <div key={i} className="rounded-md bg-muted p-3 text-sm">
                {b.title && <p className="font-medium">{b.title}</p>}
                <p className="mt-1 font-mono">{b.content}</p>
                {b.explanation && <p className="mt-1 text-muted-foreground">{b.explanation}</p>}
                {b.variables && b.variables.length > 0 && (
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {b.variables.map((v, j) => (
                      <p key={j}>
                        <span className="font-mono font-medium">{v.symbol}</span> = {v.meaning}
                      </p>
                    ))}
                  </div>
                )}
                {b.example && <p className="mt-1">Example: {b.example}</p>}
                {b.note && <p className="mt-1 text-xs text-muted-foreground">Note: {b.note}</p>}
              </div>
            );
          case 'example':
            return (
              <div
                key={i}
                className="rounded-md border-l-4 border-muted-foreground/40 py-1 pl-3 text-sm"
              >
                {b.title && <p className="font-medium">{b.title}</p>}
                <p className={b.title ? 'mt-0.5' : ''}>{b.content}</p>
              </div>
            );
          case 'callout':
            return (
              <div
                key={i}
                className={`rounded-md px-3 py-2 text-sm ${
                  b.variant === 'warning'
                    ? 'bg-amber-50 text-amber-900'
                    : b.variant === 'tip'
                      ? 'bg-emerald-50 text-emerald-900'
                      : 'bg-blue-50 text-blue-900'
                }`}
              >
                {b.content}
              </div>
            );
          case 'timeline':
            return (
              <div key={i} className="space-y-1 text-sm">
                {b.caption && <p className="font-medium">{b.caption}</p>}
                {b.events.map((e, j) => (
                  <p key={j}>
                    <span className="font-medium">{e.period}:</span> {e.title}
                    {e.description ? ` — ${e.description}` : ''}
                  </p>
                ))}
              </div>
            );
          case 'diagram':
            return (
              <div key={i} className="space-y-1 text-sm">
                {b.caption && <p className="font-medium">{b.caption}</p>}
                <p className="text-muted-foreground">{b.nodes.map((n) => n.label).join(' · ')}</p>
                {b.edges.map((e, j) => (
                  <p key={j} className="text-xs text-muted-foreground">
                    {e.from} → {e.to}
                    {e.label ? ` (${e.label})` : ''}
                  </p>
                ))}
              </div>
            );
          case 'chart':
            return (
              <div key={i} className="space-y-1 text-sm">
                {b.caption && <p className="font-medium">{b.caption}</p>}
                {b.data.map((d, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <span className="w-40 truncate text-xs">{d.label}</span>
                    <div
                      className="h-3 rounded bg-muted-foreground/30"
                      style={{ width: `${Math.min(100, d.value)}%` }}
                    />
                    <span className="text-xs tabular-nums">{d.value}</span>
                  </div>
                ))}
              </div>
            );
          case 'further-learning':
            return (
              <div key={i} className="space-y-1 text-sm">
                <p className="font-medium">Further Learning</p>
                {b.resources.map((r, j) => (
                  <a key={j} href={r.url} className="block text-xs text-blue-600 hover:underline">
                    {r.title} ({r.kind}){r.note ? ` — ${r.note}` : ''}
                  </a>
                ))}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
