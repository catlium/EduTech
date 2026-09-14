import type {
  NoteBlock,
  FurtherLearningResource,
  NoteDiagramBlock,
  NoteChartBlock,
} from '@catlium/contracts';
import { BookOpen, ExternalLink } from 'lucide-react';

export function FurtherLearning({ resources }: { resources: FurtherLearningResource[] }) {
  if (!resources || resources.length === 0) return null;
  return (
    <section className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Further Learning / Popular Resources</h4>
      </div>
      <ul className="space-y-2">
        {resources.map((r, i) => (
          <li key={`${r.url}-${i}`} className="text-sm">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {r.title} <ExternalLink className="size-3" />
            </a>
            <span className="ml-1.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {r.kind}
            </span>
            {r.note && <p className="mt-0.5 text-xs text-muted-foreground">{r.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChartBlockView({ block }: { block: NoteChartBlock }) {
  const max = Math.max(...block.data.map((d) => d.value), 1);
  const palette = [
    '#2563eb',
    '#059669',
    '#d97706',
    '#dc2626',
    '#7c3aed',
    '#0891b2',
    '#db2777',
    '#65a30d',
  ];
  if (block.chartType === 'line') {
    const w = 340;
    const h = 150;
    const pad = 10;
    const n = block.data.length;
    const pts = block.data.map((d, i) => ({
      x: n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad),
      y: pad + (1 - d.value / max) * (h - 2 * pad),
    }));
    return (
      <figure className="rounded-lg border p-3">
        {block.caption && (
          <figcaption className="mb-2 text-sm font-medium">{block.caption}</figcaption>
        )}
        <svg
          viewBox={`0 0 ${w} ${h + 18}`}
          className="w-full"
          role="img"
          aria-label={block.caption ?? 'line chart'}
        >
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            className="text-primary"
          />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="3" className="fill-primary" />
              <text
                x={p.x}
                y={p.y - 7}
                textAnchor="middle"
                fontSize="9"
                className="fill-muted-foreground"
              >
                {block.data[i].value}
              </text>
            </g>
          ))}
          {block.data.map((d, i) => (
            <text
              key={`${d.label}-${i}`}
              x={pts[i].x}
              y={h + 14}
              textAnchor="middle"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label}
            </text>
          ))}
        </svg>
      </figure>
    );
  }
  if (block.chartType === 'pie') {
    const total = block.data.reduce((s, d) => s + d.value, 0);
    if (total <= 0) {
      return (
        <figure className="rounded-lg border p-3">
          {block.caption && (
            <figcaption className="mb-2 text-sm font-medium">{block.caption}</figcaption>
          )}
          <p className="text-sm text-muted-foreground">No data to display.</p>
        </figure>
      );
    }
    const arc = (a0: number, a1: number) => {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = 70 + 60 * Math.cos(a0);
      const y0 = 70 + 60 * Math.sin(a0);
      const x1 = 70 + 60 * Math.cos(a1);
      const y1 = 70 + 60 * Math.sin(a1);
      return `M70,70 L${x0.toFixed(1)},${y0.toFixed(1)} A60,60 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
    };
    let angle = -Math.PI / 2;
    return (
      <figure className="rounded-lg border p-3">
        {block.caption && (
          <figcaption className="mb-2 text-sm font-medium">{block.caption}</figcaption>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <svg
            viewBox="0 0 140 140"
            className="h-40 w-40 shrink-0"
            role="img"
            aria-label={block.caption ?? 'pie chart'}
          >
            {block.data.map((d, i) => {
              const sweep = (d.value / total) * Math.PI * 2;
              const path = arc(angle, angle + sweep);
              angle += sweep;
              return (
                <path
                  key={i}
                  d={path}
                  fill={palette[i % palette.length]}
                  stroke="white"
                  strokeWidth="1"
                />
              );
            })}
          </svg>
          <ul className="min-w-0 flex-1 space-y-1 text-xs">
            {block.data.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: palette[i % palette.length] }}
                />
                <span className="truncate">{d.label}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </figure>
    );
  }
  if (block.chartType === 'bar') {
    return (
      <figure className="rounded-lg border p-3">
        {block.caption && (
          <figcaption className="mb-2 text-sm font-medium">{block.caption}</figcaption>
        )}
        <div className="space-y-1.5">
          {block.data.map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-right sm:w-40">{d.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-primary/70"
                  style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
                />
              </div>
              <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{d.value}</span>
            </div>
          ))}
        </div>
      </figure>
    );
  }
  return (
    <figure className="rounded-lg border p-3">
      {block.caption && (
        <figcaption className="mb-2 text-sm font-medium">{block.caption}</figcaption>
      )}
      <ul className="divide-y text-sm">
        {block.data.map((d) => (
          <li key={d.label} className="flex items-center justify-between py-1">
            <span>{d.label}</span>
            <span className="tabular-nums text-muted-foreground">{d.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function DiagramBlockView({ block }: { block: NoteDiagramBlock }) {
  const nodeById = new Map(block.nodes.map((n) => [n.id, n.label]));
  return (
    <figure className="rounded-lg border p-3">
      {block.caption && (
        <figcaption className="mb-2 text-sm font-medium">{block.caption}</figcaption>
      )}
      <div className="flex flex-wrap gap-1.5">
        {block.nodes.map((n) => (
          <span key={n.id} className="rounded border bg-muted/30 px-2 py-1 text-xs font-medium">
            {n.label}
          </span>
        ))}
      </div>
      {block.edges.length > 0 && (
        <ol className="mt-2 space-y-1">
          {block.edges.map((e, i) => (
            <li key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{nodeById.get(e.from) ?? e.from}</span>
              <span aria-hidden>→</span>
              {e.label && <span className="text-muted-foreground">({e.label})</span>}
              <span className="font-medium text-foreground">{nodeById.get(e.to) ?? e.to}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

export function NoteBlocks({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <div className="max-w-none space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <h3 key={block.id} className="text-lg font-semibold">
                {block.content}
              </h3>
            );
          case 'paragraph':
            return (
              <p key={block.id} className="whitespace-pre-wrap text-sm leading-relaxed">
                {block.content}
              </p>
            );
          case 'list':
            return (
              <ul key={block.id} className="list-disc space-y-1 pl-5 text-sm">
                {block.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            );
          case 'steps':
            return (
              <div key={block.id} className="space-y-1">
                {block.title && <p className="text-sm font-semibold">{block.title}</p>}
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {block.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ol>
              </div>
            );
          case 'table':
            return (
              <div key={block.id} className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  {block.headers && (
                    <thead>
                      <tr className="border-b bg-muted/40">
                        {block.headers.map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 align-top">
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
              <div
                key={block.id}
                className="overflow-x-auto rounded-lg border bg-muted/30 px-4 py-3"
              >
                {block.title ? (
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    {block.title}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-center font-mono text-sm">{block.content}</p>
                {block.variables && block.variables.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="px-2 py-1 text-left font-semibold">Symbol</th>
                          <th className="px-2 py-1 text-left font-semibold">Meaning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.variables.map((v, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1 font-mono">{v.symbol}</td>
                            <td className="px-2 py-1">{v.meaning}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {block.explanation ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                    {block.explanation}
                  </p>
                ) : null}
                {block.example ? (
                  <div className="mt-3 rounded border-l-2 border-primary bg-muted/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Example
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                      {block.example}
                    </p>
                  </div>
                ) : null}
                {block.note ? (
                  <p className="mt-2 text-xs italic text-muted-foreground">Note: {block.note}</p>
                ) : null}
              </div>
            );
          case 'example':
            return (
              <div key={block.id} className="rounded-lg border-l-4 border-primary bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {block.title ? `Example — ${block.title}` : 'Example'}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{block.content}</p>
              </div>
            );
          case 'callout':
            return (
              <div
                key={block.id}
                className={
                  block.variant === 'warning'
                    ? 'rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950/30'
                    : block.variant === 'tip'
                      ? 'rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30'
                      : block.variant === 'important'
                        ? 'rounded-lg border-l-4 border-destructive bg-destructive/5 p-3 text-sm'
                        : 'rounded-lg border-l-4 border-sky-500 bg-sky-50 p-3 text-sm dark:bg-sky-950/30'
                }
              >
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  {block.variant}
                </p>
                <p className="mt-1 leading-relaxed">{block.content}</p>
              </div>
            );
          case 'timeline':
            return (
              <div key={block.id} className="rounded-lg border p-3">
                {block.caption && <p className="mb-2 text-sm font-medium">{block.caption}</p>}
                <ol className="space-y-2">
                  {block.events.map((e, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                        {e.period}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{e.title}</p>
                        {e.description && (
                          <p className="text-sm text-muted-foreground">{e.description}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          case 'diagram':
            return <DiagramBlockView key={block.id} block={block} />;
          case 'chart':
            return <ChartBlockView key={block.id} block={block} />;
          default: {
            // Unknown/legacy block: degrade to a styled paragraph, never hide content.
            const raw = block as unknown as { id?: string; content?: string };
            return (
              <p
                key={raw.id ?? `unknown-${i}`}
                className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
              >
                {raw.content ?? JSON.stringify(block)}
              </p>
            );
          }
        }
      })}
    </div>
  );
}
