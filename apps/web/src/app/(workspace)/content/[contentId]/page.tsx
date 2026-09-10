"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import type {
  ContentResponse,
  NotePayload,
  SummaryPayload,
  FlashcardSetPayload,
  ImportantConceptsPayload,
} from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ErrorState } from "@/components/app/error-state";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function ContentDetailPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();

  const [content, setContent] = useState<ContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<"activate" | "archive" | null>(null);

  const refresh = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ content: ContentResponse }>(`/content/${contentId}`, { signal: ctrl.signal })
      .then(({ content }) => setContent(content))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Failed to load content");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, contentId]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  async function activateContent() {
    try {
      await api(`/content/${contentId}/activate`, { method: "POST" });
      toast.success("Content activated");
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to activate");
    }
  }

  async function archiveContent() {
    try {
      await api(`/content/${contentId}/archive`, { method: "POST" });
      toast.success("Content archived");
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to archive");
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error || !content) {
    return (
      <div>
        <PageHeader title="Content" />
        <ErrorState description={error ?? "Content not found."} onRetry={refresh} />
      </div>
    );
  }

  const payload = content.current.payload as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.push("/content")}>
          <ArrowLeft className="mr-1 size-3.5" /> Content
        </Button>
        <PageHeader
          title={content.title}
          actions={
            isTeacher && (
              <div className="flex gap-2">
                {content.status === "DRAFT" && (
                  <Button size="sm" onClick={() => setConfirmAction("activate")}>
                    <CheckCircle2 className="mr-1 size-3.5" /> Activate
                  </Button>
                )}
                {content.status === "ACTIVE" && (
                  <Button size="sm" variant="outline" onClick={() => setConfirmAction("archive")}>
                    <Archive className="mr-1 size-3.5" /> Archive
                  </Button>
                )}
              </div>
            )
          }
        />
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge status={content.type} />
          <StatusBadge status={content.status} />
          <StatusBadge status={content.source} />
          <span className="text-muted-foreground">{formatDateTime(content.createdAt)}</span>
        </div>
      </div>

      <Separator />

      {content.type === "NOTE" && <NoteView payload={payload as unknown as NotePayload} />}
      {content.type === "SUMMARY" && <SummaryView payload={payload as unknown as SummaryPayload} />}
      {content.type === "FLASHCARD_SET" && <FlashcardView payload={payload as unknown as FlashcardSetPayload} />}
      {content.type === "IMPORTANT_CONCEPTS" && <ConceptsView payload={payload as unknown as ImportantConceptsPayload} />}

      <ConfirmDialog
        open={confirmAction === "activate"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Activate content?"
        description="This content will be available to students."
        confirmLabel="Activate"
        onConfirm={activateContent}
      />
      <ConfirmDialog
        open={confirmAction === "archive"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Archive content?"
        description="This content will no longer be available to students."
        confirmLabel="Archive"
        destructive
        onConfirm={archiveContent}
      />
    </div>
  );
}

function NoteView({ payload }: { payload: NotePayload }) {
  return (
    <div className="max-w-none space-y-4">
      {payload.blocks.map((block) => {
        if (block.type === "heading") {
          return (
            <h3 key={block.id} className="text-lg font-semibold">
              {block.content}
            </h3>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={block.id} className="text-sm leading-relaxed">
              {block.content}
            </p>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={block.id} className="list-disc space-y-1 pl-5 text-sm">
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          );
        }
        return null;
      })}
    </div>
  );
}

function SummaryView({ payload }: { payload: SummaryPayload }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-muted/30 p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{payload.summary}</p>
      </div>
      {payload.keyConcepts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Key Concepts</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {payload.keyConcepts.map((kc, i) => (
              <li key={i}>{kc}</li>
            ))}
          </ul>
        </div>
      )}
      {payload.importantPoints.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Important Points</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {payload.importantPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FlashcardView({ payload }: { payload: FlashcardSetPayload }) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = payload.cards;

  if (cards.length === 0) return <p className="text-sm text-muted-foreground">No cards.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {current + 1} / {cards.length}
        </span>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            disabled={current === 0}
            onClick={() => {
              setCurrent((c) => c - 1);
              setFlipped(false);
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            disabled={current === cards.length - 1}
            onClick={() => {
              setCurrent((c) => c + 1);
              setFlipped(false);
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div
        className="relative min-h-[200px] cursor-pointer rounded-lg border bg-card p-6 shadow-sm transition-shadow hover:shadow-md select-none"
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="absolute right-3 top-3 text-xs text-muted-foreground">
          {flipped ? "Back" : "Front"} · click to flip
        </div>
        <div className="flex min-h-[160px] items-center justify-center text-center">
          <p className="whitespace-pre-wrap text-base">
            {flipped ? cards[current].back : cards[current].front}
          </p>
        </div>
      </div>
      {payload.description && (
        <p className="text-xs text-muted-foreground">{payload.description}</p>
      )}
    </div>
  );
}

function ConceptsView({ payload }: { payload: ImportantConceptsPayload }) {
  return (
    <div className="space-y-3">
      {payload.concepts.map((c, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-1">
            <h3 className="text-sm font-semibold">{c.name}</h3>
            <p className="text-sm text-muted-foreground">{c.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
