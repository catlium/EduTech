"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Layers,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import type {
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
  QuestionTypeDefinition,
  QuestionDifficulty,
  QuestionBankStats,
  GenerateMoreQuestionsResponse,
  GenerateBankResponse,
  DeriveDistributionResponse,
  PaperPattern,
} from "@catlium/contracts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

const ANSWER_FORMATS = [
  "MCQ",
  "TRUE_FALSE",
  "FILL_IN_BLANK",
  "TEXT",
  "MATCHING",
  "NUMERICAL",
] as const;

const ANSWERS_FORMAT_LABEL: Record<string, string> = {
  MCQ: "Multiple choice",
  TRUE_FALSE: "True / False",
  FILL_IN_BLANK: "Fill in the blank",
  TEXT: "Written answer",
  MATCHING: "Match pairs",
  NUMERICAL: "Numerical answer",
};

type ScopeMode = "subject" | "chapters" | "topics";

interface ScopeRef {
  id: string;
  label: string;
  kind: "subject" | "chapter" | "topic";
}

function StatKpi({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-semibold tabular-nums">{value}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground hover:border-muted-foreground/40",
      )}
    >
      {children}
    </button>
  );
}

export function QuestionBankPanel({
  subjects,
  chapters,
  topics,
  onChanged,
}: {
  subjects: SubjectResponse[];
  chapters: ChapterResponse[];
  topics: TopicResponse[];
  onChanged: () => void;
}) {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [stats, setStats] = useState<QuestionBankStats | null>(null);
  const [statsSubjectId, setStatsSubjectId] = useState("");
  const [statsLoading, setStatsLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [patterns, setPatterns] = useState<PaperPattern[]>([]);

  const [mode, setMode] = useState<ScopeMode>("subject");
  const [subjectId, setSubjectId] = useState("");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "MCQ",
    "TRUE_FALSE",
    "FILL_IN_BLANK",
  ]);
  const [selectedDifficulties, setSelectedDifficulties] = useState<QuestionDifficulty[]>([
    "EASY",
    "MEDIUM",
    "HARD",
  ]);
  const [size, setSize] = useState(30);
  const [blueprintId, setBlueprintId] = useState("");
  /* Automatic/derived mode: ask the server to infer the type×difficulty
   * distribution from existing bank questions + approved paper patterns. */
  const [autoMode, setAutoMode] = useState(false);
  const [derivedSources, setDerivedSources] = useState<string[]>([]);

  const [types, setTypes] = useState<QuestionTypeDefinition[]>([]);
  const [showCustomType, setShowCustomType] = useState(false);
  const [customType, setCustomType] = useState({
    name: "",
    answerFormat: "TEXT",
    kind: "SUBJECTIVE",
    defaultMarks: 2,
  });
  const [creatingType, setCreatingType] = useState(false);

  const [checking, setChecking] = useState(false);
  const [deficits, setDeficits] = useState<
    { scopeLabel: string; status: GenerateMoreQuestionsResponse }[]
  >([]);
  const [generating, setGenerating] = useState(false);

  const loadTypes = useCallback(() => {
    api<{ types: QuestionTypeDefinition[] }>("/question-types")
      .then(({ types }) => setTypes(types))
      .catch(() => setTypes([]));
  }, []);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  const loadStats = useCallback(
    (subjectId: string) => {
      if (!institute) return;
      setStatsLoading(true);
      const qs = subjectId ? `?subjectId=${subjectId}` : "";
      api<{ stats: QuestionBankStats }>(`/questions/bank/stats${qs}`)
        .then(({ stats }) => setStats(stats))
        .catch(() => setStats(null))
        .finally(() => setStatsLoading(false));
    },
    [institute],
  );

  useEffect(() => {
    loadStats(statsSubjectId);
  }, [loadStats, statsSubjectId]);

  useEffect(() => {
    if (!dialogOpen) return;
    const ctrl = new AbortController();
    api<{ patterns: PaperPattern[] }>("/paper-patterns", { signal: ctrl.signal })
      .then(({ patterns }) => setPatterns(patterns))
      .catch(() => setPatterns([]));
    return () => ctrl.abort();
  }, [dialogOpen]);

  const chaptersBySubject = useMemo(
    () => chapters.filter((c) => c.subjectId === subjectId),
    [chapters, subjectId],
  );
  const topicsByChapter = useMemo(() => {
    const byChapter = new Map<string, TopicResponse[]>();
    for (const t of topics) {
      if (!selectedChapterIds.includes(t.chapterId)) continue;
      const list = byChapter.get(t.chapterId) ?? [];
      list.push(t);
      byChapter.set(t.chapterId, list);
    }
    return byChapter;
  }, [topics, selectedChapterIds]);

  const availablePatterns = useMemo(
    () =>
      patterns
        .filter((p) => p.status === "APPROVED" && p.subjectId === subjectId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [patterns, subjectId],
  );

  const scopes = useMemo((): ScopeRef[] => {
    if (mode === "subject") {
      return subjectId ? [{ id: subjectId, label: "Whole subject", kind: "subject" }] : [];
    }
    if (mode === "chapters") {
      return chaptersBySubject
        .filter((c) => selectedChapterIds.includes(c.id))
        .map((c) => ({ id: c.id, label: c.name, kind: "chapter" as const }));
    }
    return selectedTopicIds
      .map((id) => topics.find((t) => t.id === id))
      .filter((t): t is TopicResponse => Boolean(t))
      .map((t) => ({ id: t.id, label: t.name, kind: "topic" as const }));
  }, [mode, subjectId, chaptersBySubject, selectedChapterIds, topics, selectedTopicIds]);

  function toggleType(t: string) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  async function createCustomType() {
    if (!customType.name.trim()) {
      toast.error("Give the question type a name");
      return;
    }
    setCreatingType(true);
    try {
      const { type } = await api<{ type: QuestionTypeDefinition }>("/question-types", {
        method: "POST",
        body: {
          name: customType.name.trim(),
          answerFormat: customType.answerFormat,
          kind: customType.kind,
          defaultMarks: customType.defaultMarks,
        },
      });
      setTypes((prev) => [...prev, type]);
      setSelectedTypes((prev) => [...prev, type.code]);
      setCustomType({ name: "", answerFormat: "TEXT", kind: "SUBJECTIVE", defaultMarks: 2 });
      setShowCustomType(false);
      toast.success(`Question type '${type.name}' created`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create question type");
    } finally {
      setCreatingType(false);
    }
  }

  function toggleDifficulty(d: QuestionDifficulty) {
    setSelectedDifficulties((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  function toggleChapter(id: string) {
    setSelectedChapterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleTopic(id: string) {
    setSelectedTopicIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleAllChapters() {
    setSelectedChapterIds((prev) =>
      prev.length === chaptersBySubject.length
        ? []
        : chaptersBySubject.map((c) => c.id),
    );
  }

  function toggleAllTopics() {
    const all = chaptersBySubject.flatMap((c) =>
      topics.filter((t) => t.chapterId === c.id).map((t) => t.id),
    );
    setSelectedTopicIds((prev) =>
      prev.length === all.length ? [] : all,
    );
  }

  function scopePayload(scope: ScopeRef) {
    return scope.kind === "subject"
      ? { subjectId: scope.id }
      : scope.kind === "chapter"
        ? { chapterId: scope.id }
        : { topicId: scope.id };
  }

  /** Equal split of `size` across the selected scope; per-scope ≤ 100. */
  const perScopeSize = scopes.length > 0
    ? Math.max(1, Math.min(100, Math.round(size / scopes.length)))
    : size;

  function difficultyDistribution(): { EASY: number; MEDIUM: number; HARD: number } {
    const dist: { EASY: number; MEDIUM: number; HARD: number } = {
      EASY: 0,
      MEDIUM: 0,
      HARD: 0,
    };
    if (selectedDifficulties.length === 0) return dist;
    const each = Math.floor(100 / selectedDifficulties.length);
    let remainder = 100;
    for (const d of selectedDifficulties) {
      dist[d] = each;
      remainder -= each;
    }
    if (selectedDifficulties.length > 0) dist[selectedDifficulties[0]!] += remainder;
    return dist;
  }

  /** Manual target buckets: selected types × selected difficulties. */
  function manualBuckets() {
    const dist = difficultyDistribution();
    return selectedTypes.flatMap((questionType) =>
      selectedDifficulties.map((difficulty) => ({
        questionType,
        difficulty,
        count: Math.max(1, Math.round((perScopeSize * dist[difficulty]) / 100)),
      })),
    );
  }

  /** Target buckets for one scope: derived (automatic), or manual. */
  async function bucketsForScope(scope: ScopeRef) {
    if (!autoMode) return manualBuckets();
    const derived = await api<DeriveDistributionResponse>("/questions/bank/derive", {
      method: "POST",
      body: { ...scopePayload(scope), count: perScopeSize },
    });
    return derived.buckets.map((b) => ({
      questionType: b.questionType,
      difficulty: b.difficulty,
      count: Math.max(1, b.count),
    }));
  }

  async function checkDeficits() {
    if (scopes.length === 0) {
      toast.error("Select a subject, chapters, or topics to check");
      return;
    }
    if (!blueprintId && !autoMode && selectedTypes.length === 0) {
      toast.error("Select at least one question type");
      return;
    }
    if (!blueprintId && !autoMode && selectedDifficulties.length === 0) {
      toast.error("Select at least one difficulty");
      return;
    }
    setChecking(true);
    setDeficits([]);
    try {
      const results = await Promise.all(
        scopes.map(async (scope): Promise<{ scopeLabel: string; status: GenerateMoreQuestionsResponse }> => {
          const buckets = await bucketsForScope(scope);
          if (buckets.length === 0) {
            throw new Error("No target buckets derived for this scope");
          }
          const resp = await api<GenerateMoreQuestionsResponse>("/questions/generate-more", {
            method: "POST",
            body: { ...scopePayload(scope), buckets, dryRun: true },
          });
          return { scopeLabel: scope.label, status: resp };
        }),
      );
      setDeficits(results);
      const total = results.reduce((sum, r) => sum + r.status.totalDeficit, 0);
      if (total === 0) toast.info("Bank already covers these buckets across all scopes");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to check bank");
    } finally {
      setChecking(false);
    }
  }

  function deficitBucketsFor(resp: GenerateMoreQuestionsResponse) {
    return resp.buckets.filter((b) => b.deficit > 0);
  }

  async function generate(
    scope: ScopeRef,
    resp?: GenerateMoreQuestionsResponse,
  ): Promise<{ jobId?: string | null; label: string }> {
    if (blueprintId) {
      const { generation } = await api<{ generation: GenerateBankResponse }>(
        "/questions/bank/generate-blueprint",
        {
          method: "POST",
          body: { ...scopePayload(scope), blueprintId },
        },
      );
      return { jobId: generation.jobId, label: scope.label };
    }
    const target = deficitBucketsFor(resp!);
    const resp2 = await api<GenerateMoreQuestionsResponse>("/questions/generate-more", {
      method: "POST",
      body: {
        ...scopePayload(scope),
        buckets: target.map((b) => ({
          questionType: b.questionType,
          difficulty: b.difficulty,
          count: b.deficit,
        })),
      },
    });
    return { jobId: resp2.jobId, label: scope.label };
  }

  async function generateMissing() {
    if (scopes.length === 0) {
      toast.error("Select a scope first");
      return;
    }
    if (!blueprintId && deficits.length === 0) {
      toast.error("Check the bank first to see what is missing");
      return;
    }
    setGenerating(true);
    try {
      const results: { label: string; jobId?: string | null }[] = [];
      for (const scope of scopes) {
        if (blueprintId) {
          results.push(await generate(scope));
          continue;
        }
        const resp = deficits.find((d) => d.scopeLabel === scope.label)?.status;
        if (!resp || deficitBucketsFor(resp).length === 0) continue;
        results.push(await generate(scope, resp));
      }
      const queued = results.filter((r) => r.jobId);
      if (queued.length === 0) {
        toast.info("Nothing generated — the bank covers the requested buckets");
      } else {
        toast.success(
          `Generation started for ${queued.map((r) => r.label).join(", ")} — check the Jobs page`,
        );
      }
      setDialogOpen(false);
      setDeficits([]);
      setBlueprintId("");
      onChanged();
      void loadStats(statsSubjectId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start generation");
    } finally {
      setGenerating(false);
    }
  }

  const aggregateDeficit = deficits.reduce((sum, d) => sum + d.status.totalDeficit, 0);
  const aggregateExisting = deficits.reduce((sum, d) => sum + d.status.totalExisting, 0);
  const aggregatePending = deficits.reduce(
    (sum, d) =>
      sum + d.status.buckets.reduce((s, b) => s + (b.pending ?? 0), 0),
    0,
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Question Bank</span>
              <span className="text-xs text-muted-foreground">scope:</span>
              <Select
                value={statsSubjectId}
                onValueChange={setStatsSubjectId}
              >
                <SelectTrigger className="h-7 w-[150px] text-xs">
                  <SelectValue placeholder="All subjects" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setStatsSubjectId("");
                loadStats("");
              }}
            >
              <RefreshCw className="mr-1 size-3.5" /> Reset scope
            </Button>
          </div>

          {statsLoading ? (
            <div className="mt-3 h-4 w-40 animate-pulse rounded bg-muted" />
          ) : stats ? (
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
              <StatKpi label="Total" value={stats.total} />
              <StatKpi label="Usable (approved)" value={stats.usable} />
              {Object.entries(stats.byType).map(([code, value]) => (
                <StatKpi
                  key={code}
                  label={types.find((t) => t.code === code)?.name ?? code.replace("_", " ").toLowerCase()}
                  value={value}
                />
              ))}
              <StatKpi label="EASY" value={stats.byDifficulty.EASY} />
              <StatKpi label="MEDIUM" value={stats.byDifficulty.MEDIUM} />
              <StatKpi label="HARD" value={stats.byDifficulty.HARD} />
              <StatKpi label="Pending" value={stats.byApproval.PENDING} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Could not load bank stats.
            </p>
          )}

          {isTeacher && (
            <Button className="mt-3" size="sm" onClick={() => setDialogOpen(true)}>
              <Sparkles className="mr-1 size-3.5" /> Generate bank questions
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setDeficits([]);
            setBlueprintId("");
            setSelectedChapterIds([]);
            setSelectedTopicIds([]);
            setMode("subject");
            setAutoMode(false);
            setDerivedSources([]);
            setShowCustomType(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate bank questions</DialogTitle>
            <DialogDescription>
              Pick one or more scopes and target buckets. Checking the bank reports what is
              still missing before anything is generated.
            </DialogDescription>
          </DialogHeader>

          {/* Scope: subject / multiple chapters / multiple topics */}
          <div className="space-y-2">
            <Label>Scope</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Chip active={mode === "subject"} onClick={() => setMode("subject")}>
                Whole subject
              </Chip>
              <Chip active={mode === "chapters"} onClick={() => setMode("chapters")}>
                Chapters
              </Chip>
              <Chip active={mode === "topics"} onClick={() => setMode("topics")}>
                Topics
              </Chip>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="Subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {subjectId && mode === "chapters" && (
              <div className="rounded-md border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium">Chapters</span>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={toggleAllChapters}
                  >
                    {selectedChapterIds.length === chaptersBySubject.length
                      ? "Clear all"
                      : "Select all"}
                  </button>
                </div>
                <div className="grid max-h-40 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
                  {chaptersBySubject.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedChapterIds.includes(c.id)}
                        onCheckedChange={() => toggleChapter(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {subjectId && mode === "topics" && (
              <div className="rounded-md border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium">Topics — pick chapters first</span>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={toggleAllTopics}
                  >
                    {selectedTopicIds.length > 0 ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="grid max-h-40 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
                  {chaptersBySubject.map((c) => {
                    const chapterTopics = topics.filter((t) => t.chapterId === c.id);
                    if (chapterTopics.length === 0) return null;
                    return (
                      <div key={c.id} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{c.name}</p>
                        {chapterTopics.map((t) => (
                          <label key={t.id} className="flex items-center gap-2 pl-3 text-sm">
                            <Checkbox
                              checked={selectedTopicIds.includes(t.id)}
                              onCheckedChange={() => toggleTopic(t.id)}
                            />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Blueprint-driven generation */}
          <div className="space-y-2">
            <Label>
              Paper pattern (optional){" "}
              <span className="text-xs font-normal text-muted-foreground">
                — derives targets from an approved blueprint
              </span>
            </Label>
            <Select
              value={blueprintId}
              onValueChange={(v) => {
                setBlueprintId(v === "none" ? "" : v);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={subjectId ? "No pattern — manual targets" : "Select a subject first"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No pattern — manual targets</SelectItem>
                {availablePatterns.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
                {availablePatterns.length === 0 && subjectId && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No approved patterns for this subject yet.
                  </p>
                )}
              </SelectContent>
            </Select>
          </div>

          {!blueprintId && (
            <>
              <div className="space-y-2">
                <Label>Question type source</Label>
                <div className="flex flex-wrap gap-2">
                  <Chip active={!autoMode} onClick={() => setAutoMode(false)}>
                    Select manually
                  </Chip>
                  <Chip active={autoMode} onClick={() => setAutoMode(true)}>
                    Automatic — derive from resources
                  </Chip>
                </div>
                {autoMode && (
                  <p className="text-xs text-muted-foreground">
                    The server inspects existing bank questions and approved paper patterns
                    for the selected scope and proposes a type × difficulty distribution.
                    Nothing is generated until you check the bank.
                  </p>
                )}
              </div>

              {!autoMode && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Question types</Label>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => setShowCustomType((v) => !v)}
                      >
                        {showCustomType ? "Cancel" : "+ Custom type"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {types.map((t) => (
                        <Chip
                          key={t.code}
                          active={selectedTypes.includes(t.code)}
                          onClick={() => toggleType(t.code)}
                        >
                          {t.name}
                          {t.isGlobal ? "" : " ★"}
                        </Chip>
                      ))}
                      {types.length === 0 && (
                        <span className="text-xs text-muted-foreground">Loading types…</span>
                      )}
                    </div>

                    {showCustomType && (
                      <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-2">
                        <Input
                          placeholder="Type name (e.g. Case Analysis)"
                          value={customType.name}
                          onChange={(e) =>
                            setCustomType((p) => ({ ...p, name: e.target.value }))
                          }
                        />
                        <Select
                          value={customType.answerFormat}
                          onValueChange={(v) =>
                            setCustomType((p) => ({ ...p, answerFormat: v }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ANSWER_FORMATS.map((f) => (
                              <SelectItem key={f} value={f}>
                                {ANSWERS_FORMAT_LABEL[f]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={customType.kind}
                          onValueChange={(v) => setCustomType((p) => ({ ...p, kind: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="OBJECTIVE">Objective</SelectItem>
                            <SelectItem value="SUBJECTIVE">Subjective</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            className="w-24"
                            value={customType.defaultMarks}
                            onChange={(e) =>
                              setCustomType((p) => ({
                                ...p,
                                defaultMarks: Math.max(1, Number(e.target.value) || 1),
                              }))
                            }
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={creatingType}
                            onClick={() => void createCustomType()}
                          >
                            {creatingType ? (
                              <Loader2 className="mr-1 size-3.5 animate-spin" />
                            ) : null}
                            Create type
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Difficulty</Label>
                    <div className="flex flex-wrap gap-2">
                      {DIFFICULTIES.map((d) => (
                        <Chip
                          key={d}
                          active={selectedDifficulties.includes(d)}
                          onClick={() => toggleDifficulty(d)}
                        >
                          {d}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label>Bank size (total across scope)</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={size}
                  onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  {scopes.length > 0
                    ? `${scopes.length} scope${scopes.length !== 1 ? "s" : ""} → ~${perScopeSize} per scope`
                    : "Select a scope above to see the split"}
                </p>
              </div>
            </>
          )}

          {deficits.length > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Layers className="size-4" />
                {aggregateExisting} existing · {aggregateDeficit} missing across{" "}
                {deficits.length} scope{deficits.length !== 1 ? "s" : ""}
                {aggregatePending > 0 && (
                  <span className="font-normal text-amber-600">
                    · {aggregatePending} pending approval
                  </span>
                )}
              </div>
              {deficits.map((d) => (
                <div key={d.scopeLabel} className="rounded border bg-background p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{d.scopeLabel}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.status.totalExisting} have / {d.status.totalDeficit} need
                    </span>
                  </div>
                  {d.status.buckets.map((b) => (
                    <div
                      key={`${d.scopeLabel}|${b.questionType}|${b.difficulty}`}
                      className="flex items-center justify-between text-xs"
                    >
                      <span>
                        {b.questionType} · {b.difficulty}
                      </span>
                      <span className="text-muted-foreground">
                        have {b.existing} / want {b.requested}
                        {(b.pending ?? 0) > 0 && (
                          <span className="text-amber-600"> · {b.pending} pending</span>
                        )}
                      </span>
                      <span
                        className={cn(
                          b.deficit > 0 ? "font-medium text-destructive" : "text-emerald-600",
                        )}
                      >
                        {b.deficit > 0 ? `need ${b.deficit}` : "ok"}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={checking || generating}
              onClick={() => void checkDeficits()}
            >
              {checking ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <FileText className="mr-1 size-3.5" />
              )}
              Check bank
            </Button>
            <Button
              type="button"
              disabled={
                generating || checking || scopes.length === 0 ||
                (!blueprintId && deficits.length === 0)
              }
              onClick={() => void generateMissing()}
            >
              {generating ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 size-3.5" />
              )}
              {generating ? "Starting…" : "Generate missing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}