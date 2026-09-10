"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, ListChecks, Play } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import type {
  ChapterResponse,
  ContentListItem,
  PracticeSessionDetail,
  PracticeSessionListItem,
  SubjectResponse,
  TopicResponse,
} from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { StatusBadge } from "@/components/app/status-badge";
import { SkeletonCards, SkeletonRows } from "@/components/app/loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function PracticeHubPage() {
  const { institute } = useTenant();
  const router = useRouter();

  const [sets, setSets] = useState<ContentListItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [history, setHistory] = useState<PracticeSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [contentId, setContentId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [wholeBank, setWholeBank] = useState(false);
  const [starting, setStarting] = useState<"FLASHCARD" | "QUESTION" | null>(null);

  const refresh = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    Promise.all([
      api<{ contents: ContentListItem[] }>("/content?type=FLASHCARD_SET&status=ACTIVE", {
        signal: ctrl.signal,
      }),
      api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal }),
      api<{ sessions: PracticeSessionListItem[] }>("/practice/sessions", { signal: ctrl.signal }),
    ])
      .then(([{ contents }, { subjects }, { sessions }]) => {
        setSets(contents);
        setSubjects(subjects);
        setHistory(sessions);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : "Failed to load practice");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  const cascadeCtrl = useRef<AbortController | null>(null);

  const loadCascade = useCallback((config: { type: "subject"; id: string } | { type: "chapter"; id: string }) => {
    cascadeCtrl.current?.abort();
    const ctrl = new AbortController();
    cascadeCtrl.current = ctrl;
    if (config.type === "subject") {
      setChapters([]);
      setTopics([]);
      setChapterId("");
      setTopicId("");
      if (!config.id) return;
      api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${config.id}/chapters`, {
        signal: ctrl.signal,
      })
        .then(({ chapters }) => setChapters(chapters))
        .catch(() => setChapters([]));
    } else {
      setTopics([]);
      setTopicId("");
      if (!config.id) return;
      api<{ topics: TopicResponse[] }>(`/academic/chapters/${config.id}/topics`, {
        signal: ctrl.signal,
      })
        .then(({ topics }) => setTopics(topics))
        .catch(() => setTopics([]));
    }
  }, []);

  async function start(mode: "FLASHCARD" | "QUESTION") {
    if (!institute) return;
    setStarting(mode);
    try {
      const body =
        mode === "FLASHCARD"
          ? { mode, contentId }
          : wholeBank
            ? { mode }
            : { mode, topicId };
      const { session } = await api<{ session: PracticeSessionDetail }>("/practice/sessions", {
        method: "POST",
        body,
      });
      router.push(`/practice/sessions/${session.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.warning("You already have an open session for this source");
        api<{ sessions: PracticeSessionListItem[] }>("/practice/sessions")
          .then(({ sessions }) => setHistory(sessions))
          .catch(() => {});
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to start practice");
      }
    } finally {
      setStarting(null);
    }
  }

  if (!institute) return null;

  if (error) {
    return (
      <div>
        <PageHeader title="Practice" />
        <ErrorState description={error} onRetry={refresh} />
      </div>
    );
  }

  const flashcardReady = sets.length > 0 && !!contentId;
  const questionReady = wholeBank || (!!subjectId && !!chapterId && !!topicId);

  return (
    <div>
      <PageHeader
        title="Practice"
        description="Flashcard or question drills — answers are private practice, never an exam score."
      />

      {loading ? (
        <SkeletonCards count={2} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-4" /> Flashcards
              </CardTitle>
              <CardDescription>
                Rate each card AGAIN or GOOD to drill a flashcard set.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sets.length === 0 ? (
                <EmptyState
                  title="No active flashcard sets"
                  description="Create and activate a flashcard set to start practicing."
                />
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Flashcard set</Label>
                    <Select value={contentId} onValueChange={setContentId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a set" />
                      </SelectTrigger>
                      <SelectContent>
                        {sets.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => void start("FLASHCARD")}
                    disabled={!flashcardReady || starting !== null}
                  >
                    <Play className="mr-1 size-3.5" />
                    {starting === "FLASHCARD" ? "Starting…" : "Start"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-4" /> Question practice
              </CardTitle>
              <CardDescription>
                Answer MCQs, true/false, and fill-in-the-blank questions by topic or the whole bank.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={wholeBank}
                  onCheckedChange={(c) => {
                    const on = !!c;
                    setWholeBank(on);
                    if (on) {
                      setSubjectId("");
                      setChapterId("");
                      setTopicId("");
                    }
                  }}
                />
                Whole question bank
              </label>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Subject</Label>
                  <Select
                    value={subjectId}
                    disabled={wholeBank}
                    onValueChange={(v) => {
                      setSubjectId(v);
                      loadCascade({ type: "subject", id: v });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Chapter</Label>
                  <Select
                    value={chapterId}
                    disabled={wholeBank || !subjectId}
                    onValueChange={(v) => {
                      setChapterId(v);
                      loadCascade({ type: "chapter", id: v });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select chapter" />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Topic</Label>
                  <Select value={topicId} disabled={wholeBank || !chapterId} onValueChange={setTopicId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {topics.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={() => void start("QUESTION")}
                disabled={!questionReady || starting !== null}
              >
                <Play className="mr-1 size-3.5" />
                {starting === "QUESTION" ? "Starting…" : "Start"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">History</h2>
          <span className="text-sm text-muted-foreground">
            {history.length} session{history.length !== 1 ? "s" : ""}
          </span>
        </div>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-8" />}
            title="No practice sessions yet"
            description="Start a flashcard or question session above to see it here."
          />
        ) : (
          <div className="space-y-2">
            {history.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{s.mode === "FLASHCARD" ? "Flashcards" : "Questions"}</Badge>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {s.itemCount} items · {s.answeredCount} answered · {s.correctCount} correct
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Started {formatDateTime(s.startedAt)}
                      {s.completedAt ? ` · Completed ${formatDateTime(s.completedAt)}` : ""}
                    </p>
                  </div>
                  <Button size="sm" asChild>
                    <Link href={`/practice/sessions/${s.id}`}>
                      {s.status === "IN_PROGRESS" ? "Continue" : "View"}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}