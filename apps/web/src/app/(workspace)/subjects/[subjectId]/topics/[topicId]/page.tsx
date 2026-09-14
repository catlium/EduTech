"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  ExternalLink,
  Loader2,
  Sparkles,
  BookOpen,
  Eye,
  RefreshCw,
} from "lucide-react";

import { api, ApiError, waitForJob } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { AppBreadcrumbs } from "@/components/app/app-breadcrumbs";
import { StatusBadge } from "@/components/app/status-badge";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCards } from "@/components/app/loading";
import { ErrorState } from "@/components/app/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  GenerateResourcesDialog,
  RESOURCE_TYPES,
} from "@/components/app/generate-resources-dialog";
import type {
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
  MaterialResponse,
  ContentListItem,
  QuestionListItem,
  GenerationBatchResponse,
  GenerateBatchJobIds,
} from "@catlium/contracts";

export default function TopicPage() {
  const { subjectId, topicId } = useParams<{
    subjectId: string;
    topicId: string;
  }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [chapter, setChapter] = useState<ChapterResponse | null>(null);
  const [topic, setTopic] = useState<TopicResponse | null>(null);
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [resources, setResources] = useState<ContentListItem[]>([]);
  const [questions, setQuestions] = useState<QuestionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starter, setStarter] = useState<"idle" | "running" | "done" | "error">("idle");
  const [starterError, setStarterError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [batch, setBatch] = useState<{
    batchId: string;
    status: GenerationBatchResponse | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { subject: s } = await api<{ subject: SubjectResponse }>(
        `/academic/subjects/${subjectId}`,
      );
      setSubject(s);

      const { chapters } = await api<{ chapters: ChapterResponse[] }>(
        `/academic/subjects/${subjectId}/chapters`,
      );

      let foundTopic: TopicResponse | null = null;
      let foundChapter: ChapterResponse | null = null;
      for (const ch of chapters) {
        const { topics } = await api<{ topics: TopicResponse[] }>(
          `/academic/chapters/${ch.id}/topics`,
        );
        const match = topics.find((t) => t.id === topicId);
        if (match) {
          foundTopic = match;
          foundChapter = ch;
          break;
        }
      }

      if (!foundTopic || !foundChapter) {
        setError("Topic not found.");
        return;
      }

      setTopic(foundTopic);
      setChapter(foundChapter);

      const { materials: mats } = await api<{ materials: MaterialResponse[] }>(
        `/materials?topicId=${topicId}`,
      );
      setMaterials(mats);

      const resourceTypes = RESOURCE_TYPES.map((r) => r.type);
      const [{ contents }, { questions: qs }] = await Promise.all([
        api<{ contents: ContentListItem[] }>(`/content?topicId=${topicId}`),
        api<{ questions: QuestionListItem[] }>(`/questions?topicId=${topicId}`),
      ]);
      setResources(contents.filter((c) => resourceTypes.includes(c.type)));
      setQuestions(qs);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Failed to load topic. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [subjectId, topicId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load();
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    if (!batch) return;
    const ctrl = new AbortController();
    const tick = () => {
      api<{ batch: GenerationBatchResponse }>(`/content/generation-batches/${batch.batchId}`, {
        signal: ctrl.signal,
      })
        .then(({ batch: b }) => {
          setBatch((prev) => (prev ? { ...prev, status: b } : prev));
          if (b.active === 0) void load();
        })
        .catch(() => {});
    };
    const id = setInterval(tick, 2500);
    tick();
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.batchId]);

  async function startStarter() {
    setStarter("running");
    setStarterError(null);
    try {
      const { generation } = await api<{ generation: { jobId: string } }>(
        "/content/starter-material",
        { method: "POST", body: { topicId } },
      );
      await waitForJob(() =>
        api<{ job: { status: string } }>(`/jobs/${generation.jobId}`),
      );
      setStarter("done");
      void load();
    } catch (err) {
      setStarter("error");
      setStarterError(err instanceof ApiError ? err.message : "Generation failed");
    }
  }

  async function startBatch(types: string[]) {
    setStarting(true);
    try {
      const { batch: b } = await api<{ batch: GenerateBatchJobIds }>("/content/generate-batch", {
        method: "POST",
        body: { sourceType: "TOPIC", sourceId: topicId, types },
      });
      setDialogOpen(false);
      if (b.jobIds.length === 0) {
        toast.info("Those resources are already being generated");
        return;
      }
      toast.success(`Started ${b.jobIds.length} generation job${b.jobIds.length > 1 ? "s" : ""}`);
      setBatch({ batchId: b.batchId, status: null });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start generation");
    } finally {
      setStarting(false);
    }
  }

  function latestFor(type: string): ContentListItem | undefined {
    return resources
      .filter((r) => r.type === type)
      .sort((a, b) => b.currentVersion - a.currentVersion)[0];
  }

  const questionsSummary = (() => {
    const pending = questions.filter((q) => q.approvalStatus === "PENDING").length;
    const approved = questions.filter((q) => q.approvalStatus === "APPROVED").length;
    return { total: questions.length, pending, approved };
  })();

  if (loading) {
    return <SkeletonCards count={2} />;
  }
  if (error || !topic || !subject || !chapter) {
    return <ErrorState description={error ?? "Topic not found."} onRetry={() => void load()} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => router.replace(`/subjects/${subjectId}`)}
        >
          <ArrowLeft className="mr-1 size-3.5" /> {subject.name}
        </Button>
        <AppBreadcrumbs
          items={[
            { label: "Subjects", href: "/subjects" },
            { label: subject.name, href: `/subjects/${subjectId}` },
            { label: chapter.name },
            { label: topic.name },
          ]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{topic.name}</h1>
          <StatusBadge status={topic.status} />
        </div>
        {topic.description && (
          <p className="text-sm text-muted-foreground">{topic.description}</p>
        )}
      </div>

      {batch?.status && batch.status.active > 0 && (
        <Card>
          <CardContent className="flex items-center justify-between p-3 text-sm">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Generating… {batch.status.completed + batch.status.failed}/
              {batch.status.total} jobs done
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void api(`/content/generation-batches/${batch.batchId}/cancel`, {
                  method: "POST",
                }).then(() => setBatch(null));
              }}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="space-y-4">
        <SectionHeader
          title="Learning Resources"
          description="Notes, summaries, flashcards and more — generated from this topic's materials"
          actions={
            isTeacher ? (
              <Button size="sm" onClick={() => setDialogOpen(true)} disabled={Boolean(batch?.status?.active)}>
                <Sparkles className="mr-1 size-3.5" /> Generate resources
              </Button>
            ) : undefined
          }
        />
        {resources.length === 0 && !batch?.status?.active ? (
          <EmptyState
            icon={<BookOpen className="size-8" />}
            title="No learning resources yet"
            description={
              isTeacher
                ? "Generate notes, a summary, flashcards, concepts and Cornell notes from this topic's materials."
                : "The teacher has not generated learning resources for this topic yet."
            }
          >
            {isTeacher && (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Sparkles className="mr-1 size-3.5" /> Generate resources
              </Button>
            )}
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-lg border">
            {RESOURCE_TYPES.map(({ type, label }) => {
              const item = latestFor(type);
              return (
                <li key={type} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="flex size-8 items-center justify-center rounded-md bg-muted">
                    <BookOpen className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{label}</p>
                    {item ? (
                      <p className="text-xs text-muted-foreground">
                        v{item.currentVersion} · {item.status === "ACTIVE" ? "active" : "not published"}
                      </p>
                    ) : batch?.status?.active ? (
                      <p className="text-xs text-muted-foreground animate-pulse">Queued…</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not generated yet</p>
                    )}
                  </div>
                  {item && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/content/${item.id}`)}
                    >
                      <Eye className="mr-1 size-3.5" /> Open
                    </Button>
                  )}
                  {!item && isTeacher && !batch?.status?.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void startBatch([type])}
                      disabled={starting}
                    >
                      <Sparkles className="mr-1 size-3.5" /> Generate
                    </Button>
                  )}
                  {item && isTeacher && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void startBatch([type])}
                      disabled={starting}
                    >
                      <RefreshCw className="mr-1 size-3.5" /> Regenerate
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Questions"
          description={
            questions.length > 0
              ? `${questionsSummary.total} generated · ${questionsSummary.pending} pending review · ${questionsSummary.approved} approved`
              : undefined
          }
          actions={
            <Button size="sm" variant="outline" asChild>
              <Link href={`/questions?topicId=${topicId}`}>
                Manage questions <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
          }
        />
        {questionsSummary.total === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" />}
            title="No questions yet"
            description="Generate questions from this topic, or add them individually in the question bank."
          >
            <Button size="sm" asChild>
              <Link href={`/questions?topicId=${topicId}`}>Go to Question Bank</Link>
            </Button>
          </EmptyState>
        ) : (
          <p className="text-sm text-muted-foreground">
            Question generation and review happen in the question bank (
            {questionsSummary.total} active questions).
          </p>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Materials"
          description={
            materials.length > 0
              ? `${materials.length} material${materials.length !== 1 ? "s" : ""}`
              : undefined
          }
          actions={
            <Button size="sm" variant="outline" asChild>
              <Link href={`/materials?topic=${topicId}`}>
                Manage materials <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
          }
        />
        {materials.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" />}
            title="No materials yet"
            description={
              starter === "running"
                ? "Generating a starter material for this topic…"
                : starter === "error"
                  ? starterError ?? "Generation failed."
                  : "Upload or create materials for this topic, or let AI draft a starter material from the syllabus scope."
            }
          >
            <div className="flex flex-wrap justify-center gap-2">
              {isTeacher && (
                <Button
                  size="sm"
                  disabled={starter === "running"}
                  onClick={() => void startStarter()}
                >
                  {starter === "running" ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 size-3.5" />
                  )}
                  {starter === "running"
                    ? "Generating…"
                    : starter === "done"
                      ? "Generate another"
                      : "Generate starter material"}
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link href={`/materials?topic=${topicId}`}>Go to Materials</Link>
              </Button>
            </div>
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {materials.map((mat) => (
              <Card key={mat.id}>
                <CardContent className="p-0">
                  <Link
                    href={`/materials/${mat.id}`}
                    className="flex items-center gap-3 rounded-md p-3 hover:bg-accent/50"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{mat.title}</p>
                      <p className="text-xs text-muted-foreground">{mat.materialType}</p>
                    </div>
                    <StatusBadge status={mat.processingStatus} />
                    <StatusBadge status={mat.status} />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <GenerateResourcesDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onGenerate={(types) => void startBatch(types)}
          starting={starting}
          sourceLabel={topic.name}
        />
    </div>
  );
}