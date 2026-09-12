"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCards } from "@/components/app/loading";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  SubjectResponse,
  TopicResponse,
  ContentResponse,
  ContentListItem,
  NoteBlock,
  FurtherLearningResource,
} from "@catlium/contracts";
import { NoteBlocks, FurtherLearning } from "@/components/content/note-blocks";

type Payload = Record<string, unknown>;

type ReadyContent = {
  id: string;
  type: string;
  title: string;
  version: number;
  payload: Payload;
  source: Payload | null;
};

const TYPE_LABELS: Record<string, string> = {
  NOTE: "Note",
  SUMMARY: "Summary",
  FLASHCARD_SET: "Flashcards",
  CORNELL_NOTE: "Cornell Notes",
  IMPORTANT_CONCEPTS: "Important Concepts",
};

export default function TopicReadingPage() {
  const { subjectId, topicId } = useParams<{ subjectId: string; topicId: string }>();
  const { institute } = useTenant();
  const [topic, setTopic] = useState<TopicResponse | null>(null);
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [contents, setContents] = useState<ReadyContent[]>([]);
  const [activeType, setActiveType] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!institute) return;
      setLoading(true);
      setError(null);
      try {
        const [t, s, list] = await Promise.all([
          api<{ topic: TopicResponse }>(`/academic/topics/${topicId}`, { signal }),
          api<{ subject: SubjectResponse }>(`/academic/subjects/${subjectId}`, { signal }),
          api<{ contents: ContentListItem[] }>(
            `/content?topicId=${topicId}&status=ACTIVE`,
            { signal },
          ),
        ]);
        setTopic(t.topic);
        setSubject(s.subject);

        const settled = await Promise.allSettled(
          list.contents.map((c) =>
            api<{ content: ContentResponse }>(`/content/${c.id}`, { signal }),
          ),
        );
        const failed: string[] = [];
        const items: ReadyContent[] = [];
        for (const cId of list.contents.map((c) => c.id)) {
          const i = list.contents.findIndex((c) => c.id === cId);
          const res = settled[i];
          if (res.status === "fulfilled") {
            const { content } = res.value;
            items.push({
              id: content.id,
              type: content.type,
              title: content.title,
              version: content.current.version,
              payload: content.current.payload,
              source: content.current.sourceReference ?? null,
            });
          } else {
            failed.push(cId);
          }
        }
        setContents(items);
        if (failed.length > 0) {
          toast.warning(`${failed.length} content item(s) could not be loaded.`);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : "Failed to load topic. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [institute, subjectId, topicId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (!institute) return null;

  if (loading) {
    return <SkeletonCards count={2} />;
  }

  if (error || !topic || !subject) {
    return (
      <ErrorState description={error ?? "Topic not found."} onRetry={() => void load()} />
    );
  }

  const types = ["all", ...Array.from(new Set(contents.map((c) => c.type)))];
  const visible = activeType === "all" ? contents : contents.filter((c) => c.type === activeType);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
          <Link href={`/student/learning/${subjectId}`}>
            <ArrowLeft className="mr-1.5 size-3.5" /> {subject.name}
          </Link>
        </Button>
        <PageHeader title={topic.name} description={topic.description ?? undefined} />
      </div>

      {contents.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="Nothing here yet"
          description="Nothing here yet — content for this topic is being prepared by your teachers."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {types.map((type) => (
              <Button
                key={type}
                size="sm"
                variant={activeType === type ? "default" : "outline"}
                onClick={() => setActiveType(type)}
              >
                {type === "all" ? "All" : TYPE_LABELS[type] ?? type}
              </Button>
            ))}
          </div>

          <div className="space-y-6">
            {visible.map((content) => (
              <ContentCard key={content.id} content={content} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ContentCard({ content }: { content: ReadyContent }) {
  const materialIds = Array.isArray(content.source?.materialIds)
    ? content.source.materialIds
    : [];
  return (
    <Card>
      <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-2">
        <Badge variant="secondary">{TYPE_LABELS[content.type] ?? content.type}</Badge>
        <CardTitle className="truncate text-base">{content.title}</CardTitle>
        <Badge variant="outline" className="shrink-0">
          v{content.version}
        </Badge>
      </CardHeader>
      <CardContent className="text-sm leading-relaxed text-foreground">
        <PayloadView type={content.type} payload={content.payload} />
        {materialIds.length > 0 && (
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            Prepared from {materialIds.length} source material{materialIds.length !== 1 ? "s" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PayloadView({ type, payload }: { type: string; payload: Payload }) {
  switch (type) {
    case "NOTE":
      return <NotePayloadView payload={payload} />;
    case "SUMMARY":
      return <SummaryPayloadView payload={payload} />;
    case "IMPORTANT_CONCEPTS":
      return <ConceptsPayloadView payload={payload} />;
    case "FLASHCARD_SET":
      return <FlashcardPayloadView payload={payload} />;
    case "CORNELL_NOTE":
      return <CornellPayloadView payload={payload} />;
    default:
      return <UnavailableNote />;
  }
}

function UnavailableNote() {
  return (
    <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
      Content unavailable — this item couldn't be rendered.
    </div>
  );
}

function NotePayloadView({ payload }: { payload: Payload }) {
  const blocks = (Array.isArray(payload.blocks) ? payload.blocks : []) as NoteBlock[];
  if (blocks.length === 0) return <UnavailableNote />;
  return (
    <div className="space-y-4">
      <NoteBlocks blocks={blocks} />
      <FurtherLearning resources={(payload.furtherLearning ?? []) as FurtherLearningResource[]} />
    </div>
  );
}

function SummaryPayloadView({ payload }: { payload: Payload }) {
  const summary = typeof payload.summary === "string" ? payload.summary : null;
  const keyConcepts = Array.isArray(payload.keyConcepts) ? payload.keyConcepts : [];
  const importantPoints = Array.isArray(payload.importantPoints) ? payload.importantPoints : [];
  if (!summary && keyConcepts.length === 0 && importantPoints.length === 0)
    return <UnavailableNote />;

  return (
    <div className="space-y-4">
      {summary && <p className="whitespace-pre-wrap">{summary}</p>}
      {keyConcepts.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">Key concepts</p>
          <ul className="list-disc space-y-1 pl-5">
            {keyConcepts.map((kc, i) => (
              <li key={i}>{String(kc)}</li>
            ))}
          </ul>
        </div>
      )}
      {importantPoints.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">Important points</p>
          <ul className="list-disc space-y-1 pl-5">
            {importantPoints.map((p, i) => (
              <li key={i}>{String(p)}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(payload.examples) && payload.examples.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Examples</p>
          {payload.examples.map((ex, i) => {
            const e = ex as { topic?: string; content?: string };
            return (
              <div key={i} className="rounded-lg border-l-4 border-primary bg-muted/20 p-3">
                {e.topic && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">{e.topic}</p>
                )}
                {e.content && <p className="mt-1 whitespace-pre-wrap text-sm">{e.content}</p>}
              </div>
            );
          })}
        </div>
      )}
      <FurtherLearning resources={(payload.furtherLearning ?? []) as FurtherLearningResource[]} />
    </div>
  );
}

function ConceptsPayloadView({ payload }: { payload: Payload }) {
  const concepts = Array.isArray(payload.concepts) ? payload.concepts : null;
  if (!concepts || concepts.length === 0) return <UnavailableNote />;

  return (
    <div className="space-y-2">
      {concepts.map((raw, i) => {
        const c = raw as { title?: string; definition?: string; name?: string; description?: string };
        const title = c.title ?? c.name ?? "";
        const definition = c.definition ?? c.description ?? "";
        return (
          <div key={i} className="rounded-lg bg-muted/30 p-3">
            {title && <p className="text-sm font-medium">{title}</p>}
            {definition && <p className="mt-1 text-sm text-muted-foreground">{definition}</p>}
          </div>
        );
      })}
    </div>
  );
}

function FlashcardPayloadView({ payload }: { payload: Payload }) {
  const cards = (Array.isArray(payload.cards) ? payload.cards : []).filter(
    (c): c is { id: string; front: string; back: string } => {
      const card = c as { id?: string; front?: string; back?: string };
      return Boolean(card.id && card.front && card.back);
    },
  );
  if (cards.length === 0) return <UnavailableNote />;

  return (
    <div className="flex flex-col gap-2">
      {cards.map((card) => <FlipCard key={card.id} card={card} />)}
    </div>
  );
}

function FlipCard({ card }: { card: { id: string; front: string; back: string } }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 transition-colors",
        flipped ? "bg-muted/30" : "bg-card",
      )}
    >
      <p>{flipped ? card.back : card.front}</p>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFlipped((f) => !f)}>
        {flipped ? "Hide answer" : "Show answer"}
      </Button>
    </div>
  );
}

function CornellPayloadView({ payload }: { payload: Payload }) {
  const sections = Array.isArray(payload.sections) ? payload.sections : null;
  const cueColumn = Array.isArray(payload.cueColumn) ? payload.cueColumn : null;
  const notesRaw = typeof payload.notes === "string" ? payload.notes : null;
  const summary = typeof payload.summary === "string" ? payload.summary : null;

  const cues = sections
    ? sections
        .map((s) => (s as { cue?: string }).cue ?? "")
        .filter(Boolean)
    : cueColumn?.map(String) ?? [];
  const notes = sections
    ? sections
        .map((s) => (s as { notes?: string }).notes ?? "")
        .filter(Boolean)
        .join("\n\n")
    : notesRaw;

  if (cues.length === 0 && !notes && !summary) return <UnavailableNote />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Cue Column</p>
          {cues.length > 0 ? (
            <ul className="list-disc pl-5">
              {cues.map((cue, i) => (
                <li key={i}>{cue}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No cues recorded.</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Notes</p>
          {notes ? (
            <p className="whitespace-pre-wrap">{notes}</p>
          ) : (
            <p className="text-muted-foreground">No notes recorded.</p>
          )}
        </div>
      </div>
      {summary && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Summary</p>
          <p className="whitespace-pre-wrap">{summary}</p>
        </div>
      )}
    </div>
  );
}