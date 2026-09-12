import type {
  NoteBlock,
  FurtherLearningResource,
  NoteDiagramBlock,
  NoteChartBlock,
} from "@catlium/contracts";
import { BookOpen, ExternalLink } from "lucide-react";

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
  return (
    <figure className="rounded-lg border p-3">
      {block.caption && (
        <figcaption className="mb-2 text-sm font-medium">{block.caption}</figcaption>
      )}
      {block.chartType === "bar" ? (
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
      ) : (
        <ul className="divide-y text-sm">
          {block.data.map((d) => (
            <li key={d.label} className="flex items-center justify-between py-1">
              <span>{d.label}</span>
              <span className="tabular-nums text-muted-foreground">{d.value}</span>
            </li>
          ))}
        </ul>
      )}
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
          <span
            key={n.id}
            className="rounded border bg-muted/30 px-2 py-1 text-xs font-medium"
          >
            {n.label}
          </span>
        ))}
      </div>
      {block.edges.length > 0 && (
        <ol className="mt-2 space-y-1">
          {block.edges.map((e, i) => (
            <li key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {nodeById.get(e.from) ?? e.from}
              </span>
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
      {blocks.map((block) => {
        switch (block.type) {
          case "heading":
            return (
              <h3 key={block.id} className="text-lg font-semibold">
                {block.content}
              </h3>
            );
          case "paragraph":
            return (
              <p key={block.id} className="text-sm leading-relaxed">
                {block.content}
              </p>
            );
          case "list":
            return (
              <ul key={block.id} className="list-disc space-y-1 pl-5 text-sm">
                {block.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            );
          case "steps":
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
          case "table":
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
          case "formula":
            return (
              <div
                key={block.id}
                className="overflow-x-auto rounded-lg border bg-muted/30 px-4 py-3 text-center font-mono text-sm"
              >
                {block.content}
              </div>
            );
          case "example":
            return (
              <div key={block.id} className="rounded-lg border-l-4 border-primary bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {block.title ? `Example — ${block.title}` : "Example"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{block.content}</p>
              </div>
            );
          case "callout":
            return (
              <div
                key={block.id}
                className={
                  block.variant === "warning"
                    ? "rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
                    : block.variant === "tip"
                      ? "rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30"
                      : block.variant === "important"
                        ? "rounded-lg border-l-4 border-destructive bg-destructive/5 p-3 text-sm"
                        : "rounded-lg border-l-4 border-sky-500 bg-sky-50 p-3 text-sm dark:bg-sky-950/30"
                }
              >
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  {block.variant}
                </p>
                <p className="mt-1 leading-relaxed">{block.content}</p>
              </div>
            );
          case "timeline":
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
          case "diagram":
            return <DiagramBlockView key={block.id} block={block} />;
          case "chart":
            return <ChartBlockView key={block.id} block={block} />;
        }
      })}
    </div>
  );
}