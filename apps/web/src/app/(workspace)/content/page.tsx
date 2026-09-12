"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, FileText, Layers, Lightbulb, Archive, CheckCircle2, Eye, Search } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import type {
  ContentListItem,
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
} from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { ResourceCard } from "@/components/app/resource-card";
import { StatusBadge } from "@/components/app/status-badge";
import { SkeletonCards } from "@/components/app/loading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import {
  ScopeCascade,
  emptyCascade,
  FilterChip,
  type ScopeCascade as ScopeCascadeState,
} from "@/components/app/scope-cascade";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

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
  const [tab, setTab] = useState<Tab>(() => (searchParams.get("type") as Tab) || "all");
  const [scope, setScope] = useState<ScopeCascadeState>(() => ({
    subjectId: searchParams.get("subject") ?? "",
    chapterId: searchParams.get("chapter") ?? "",
    topicId: searchParams.get("topic") ?? "",
  }));
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [topics, setTopics] = useState<TopicResponse[]>([]);

  const [confirmAction, setConfirmAction] = useState<{
    type: "activate" | "archive";
    contentId: string;
  } | null>(null);

  const activeFilters =
    scope.subjectId || scope.chapterId || scope.topicId || debouncedSearch || tab !== "all";

  const refresh = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (tab !== "all") params.set("type", tab);
    if (scope.subjectId) params.set("subjectId", scope.subjectId);
    if (scope.chapterId) params.set("chapterId", scope.chapterId);
    if (scope.topicId) params.set("topicId", scope.topicId);
    if (debouncedSearch) params.set("q", debouncedSearch);
    const qs = params.toString();
    api<{ contents: ContentListItem[] }>(`/content${qs ? `?${qs}` : ""}`, {
      signal: ctrl.signal,
    })
      .then(({ contents }) => setContent(contents))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Failed to load content");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, tab, scope.subjectId, scope.chapterId, scope.topicId, debouncedSearch]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("type", tab);
    if (scope.subjectId) params.set("subject", scope.subjectId);
    if (scope.chapterId) params.set("chapter", scope.chapterId);
    if (scope.topicId) params.set("topic", scope.topicId);
    if (debouncedSearch) params.set("q", debouncedSearch);
    const qs = params.toString();
    router.replace(`/content${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [tab, scope, debouncedSearch, router]);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    if (subjects.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      subjects.map((s) =>
        api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${s.id}/chapters`, {
          signal: ctrl.signal,
        }),
      ),
    )
      .then((results) => {
        const allChapters = results.flatMap((r) => r.chapters);
        setChapters(allChapters);
        return Promise.all(
          allChapters.map((c) =>
            api<{ topics: TopicResponse[] }>(`/academic/chapters/${c.id}/topics`, {
              signal: ctrl.signal,
            }),
          ),
        );
      })
      .then((topicsResults) => setTopics(topicsResults.flatMap((r) => r.topics)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [subjects]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(highlightId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, content]);

  function clearFilter(key: "subject" | "chapter" | "topic" | "q") {
    if (key === "q") {
      setSearch("");
      return;
    }
    setScope((s) => ({ ...emptyCascade(), ...s, [key + "Id"]: "" }));
  }

  function clearAll() {
    setScope(emptyCascade());
    setSearch("");
    setTab("all");
  }

  function scopeName(kind: "subject" | "chapter" | "topic"): string {
    const id = scope[`${kind}Id`];
    if (!id) return "";
    const pool = kind === "subject" ? subjects : kind === "chapter" ? chapters : topics;
    return pool.find((x) => x.id === id)?.name ?? "";
  }

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

  const chips: { label: string; onClear: () => void }[] = [];
  if (scope.subjectId) chips.push({ label: scopeName("subject") || "Subject", onClear: () => clearFilter("subject") });
  if (scope.chapterId) chips.push({ label: scopeName("chapter") || "Chapter", onClear: () => clearFilter("chapter") });
  if (scope.topicId) chips.push({ label: scopeName("topic") || "Topic", onClear: () => clearFilter("topic") });
  if (debouncedSearch) chips.push({ label: `“${debouncedSearch}”`, onClear: () => clearFilter("q") });

  return (
    <div>
      <PageHeader
        title="Learning Content"
        description={`${content.length} item${content.length !== 1 ? "s" : ""}`}
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search content…"
              className="h-8 w-56 pl-7"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
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

        <ScopeCascade
          cascade={scope}
          subjects={subjects}
          chapters={chapters}
          topics={topics}
          onChange={setScope}
        />

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <FilterChip key={chip.label} label={chip.label} onClear={chip.onClear} />
            ))}
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      {!activeFilters && content.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No content yet"
          description="Generate notes, summaries, or flashcards from a material."
        >
          <Button size="sm" onClick={() => router.push("/materials")}>
            Go to Materials
          </Button>
        </EmptyState>
      ) : loading ? (
        <SkeletonCards count={6} />
      ) : content.length === 0 ? (
        <p className="text-sm text-muted-foreground">No content matches the current filters.</p>
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
                    {(c.status === "DRAFT" || c.status === "ARCHIVED") && (
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