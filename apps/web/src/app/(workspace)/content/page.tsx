"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, FileText, Layers, Lightbulb, Archive, CheckCircle2, Eye } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import type { ContentListItem } from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { ResourceCard } from "@/components/app/resource-card";
import { StatusBadge } from "@/components/app/status-badge";
import { SkeletonCards } from "@/components/app/loading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";

type Tab = "all" | "NOTE" | "SUMMARY" | "FLASHCARD_SET" | "IMPORTANT_CONCEPTS" | "CORNELL_NOTE";

const contentTypeLabel: Record<string, string> = {
  NOTE: "Notes",
  SUMMARY: "Summary",
  FLASHCARD_SET: "Flashcards",
  IMPORTANT_CONCEPTS: "Concepts",
  CORNELL_NOTE: "Cornell Notes",
};

const contentTypeIcon: Record<string, React.ReactNode> = {
  NOTE: <FileText className="size-4" />,
  SUMMARY: <Layers className="size-4" />,
  FLASHCARD_SET: <BookOpen className="size-4" />,
  IMPORTANT_CONCEPTS: <Lightbulb className="size-4" />,
  CORNELL_NOTE: <FileText className="size-4" />,
};

export default function ContentListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("contentId");

  const [content, setContent] = useState<ContentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");

  const [confirmAction, setConfirmAction] = useState<{
    type: "activate" | "archive";
    contentId: string;
  } | null>(null);

  const refresh = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (tab !== "all") params.set("contentType", tab);
    const qs = params.toString();
    api<{ content: ContentListItem[] }>(`/content${qs ? `?${qs}` : ""}`, { signal: ctrl.signal })
      .then(({ content }) => setContent(content))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Failed to load content");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, tab]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(highlightId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, content]);

  async function activateContent(id: string) {
    try {
      await api(`/content/${id}/activate`, { method: "POST" });
      toast.success("Content activated");
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to activate");
    }
  }

  async function archiveContent(id: string) {
    try {
      await api(`/content/${id}/archive`, { method: "POST" });
      toast.success("Content archived");
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to archive");
    }
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Learning Content" />
        <ErrorState description={error} onRetry={refresh} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Learning Content"
        description={`${content.length} item${content.length !== 1 ? "s" : ""}`}
      />

      <div className="mb-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="NOTE">Notes</TabsTrigger>
            <TabsTrigger value="SUMMARY">Summaries</TabsTrigger>
            <TabsTrigger value="FLASHCARD_SET">Flashcards</TabsTrigger>
            <TabsTrigger value="IMPORTANT_CONCEPTS">Concepts</TabsTrigger>
            <TabsTrigger value="CORNELL_NOTE">Cornell</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <SkeletonCards count={6} />
      ) : content.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No content yet"
          description="Generate notes, summaries, or flashcards from a material."
        >
          <Button size="sm" onClick={() => router.push("/materials")}>
            Go to Materials
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {content.map((c) => (
            <ResourceCard
              key={c.id}
              icon={contentTypeIcon[c.type] ?? <FileText className="size-4" />}
              title={c.title}
              subtitle={`${contentTypeLabel[c.type] ?? c.type} · ${formatDate(c.createdAt)}`}
              badges={
                <>
                  <StatusBadge status={c.status} />
                  <StatusBadge status={c.source} />
                </>
              }
              actions={
                isTeacher && (
                  <div className="flex items-center gap-1">
                    {c.status === "DRAFT" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmAction({ type: "activate", contentId: c.id })}
                      >
                        <CheckCircle2 className="size-3.5" />
                      </Button>
                    )}
                    {c.status === "ACTIVE" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmAction({ type: "archive", contentId: c.id })}
                      >
                        <Archive className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(`/content/${c.id}`)}
                    >
                      <Eye className="size-3.5" />
                    </Button>
                  </div>
                )
              }
              onClick={() => router.push(`/content/${c.id}`)}
              id={c.id}
              className={c.id === highlightId ? "ring-2 ring-primary" : undefined}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmAction?.type === "activate"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Activate content?"
        description="This content will be available to students."
        confirmLabel="Activate"
        onConfirm={() => {
          if (confirmAction) return activateContent(confirmAction.contentId);
        }}
      />
      <ConfirmDialog
        open={confirmAction?.type === "archive"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Archive content?"
        description="This content will no longer be available to students."
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          if (confirmAction) return archiveContent(confirmAction.contentId);
        }}
      />
    </div>
  );
}
