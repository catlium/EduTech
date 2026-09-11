"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, Sparkles, Trash2, CheckCircle2 } from "lucide-react";

import { api, ApiError, jobDone } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import type {
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
  QuestionType,
  QuestionDifficulty,
  QuestionBankStats,
  GenerateMoreQuestionsResponse,
} from "@catlium/contracts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

const QUESTION_TYPES = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK"] as const;
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

const DEFAULT_CASCADE = { subjectId: "", chapterId: "", topicId: "" };
type Cascade = typeof DEFAULT_CASCADE;

interface BankBucketRow {
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  count: number;
}

function defaultRows(): BankBucketRow[] {
  return [
    { questionType: "MCQ", difficulty: "MEDIUM", count: 10 },
    { questionType: "TRUE_FALSE", difficulty: "MEDIUM", count: 10 },
    { questionType: "FILL_IN_BLANK", difficulty: "MEDIUM", count: 10 },
  ];
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
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsCascade, setStatsCascade] = useState<Cascade>(DEFAULT_CASCADE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [baseCascade, setBaseCascade] = useState<Cascade>(DEFAULT_CASCADE);
  const [rows, setRows] = useState<BankBucketRow[]>(defaultRows());
  const [checking, setChecking] = useState(false);
  const [deficits, setDeficits] = useState<GenerateMoreQuestionsResponse | null>(null);
  const [generating, setGenerating] = useState(false);

  const loadStats = useCallback((cascade: Cascade) => {
    if (!institute) return;
    setStatsLoading(true);
    const params = new URLSearchParams();
    if (cascade.subjectId) params.set("subjectId", cascade.subjectId);
    if (cascade.chapterId) params.set("chapterId", cascade.chapterId);
    if (cascade.topicId) params.set("topicId", cascade.topicId);
    const qs = params.toString();
    api<{ stats: QuestionBankStats }>(`/questions/bank/stats${qs ? `?${qs}` : ""}`)
      .then(({ stats }) => setStats(stats))
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, [institute]);

  useEffect(() => {
    loadStats(DEFAULT_CASCADE);
  }, [loadStats]);

  function scopePayload() {
    if (baseCascade.topicId) return { topicId: baseCascade.topicId };
    if (baseCascade.chapterId) return { chapterId: baseCascade.chapterId };
    if (baseCascade.subjectId) return { subjectId: baseCascade.subjectId };
    return null;
  }

  async function checkDeficits() {
    const scope = scopePayload();
    if (!scope) {
      toast.error("Select a subject, chapter, or topic scope");
      return;
    }
    setChecking(true);
    setDeficits(null);
    try {
      const resp = await api<GenerateMoreQuestionsResponse>("/questions/generate-more", {
        method: "POST",
        body: { ...scope, buckets: rows, dryRun: true },
      });
      setDeficits(resp);
      if (resp.totalDeficit === 0) {
        toast.info("Bank already has enough questions for these buckets");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to check bank");
    } finally {
      setChecking(false);
    }
  }

  async function generateMissing() {
    const scope = scopePayload();
    if (!scope) {
      toast.error("Select a subject, chapter, or topic scope");
      return;
    }
    const targets = deficits?.buckets ?? [];
    const buckets = targets
      .filter((b) => b.deficit > 0)
      .map((b) => ({ questionType: b.questionType, difficulty: b.difficulty, count: b.deficit }));
    if (buckets.length === 0) {
      toast.info("Nothing to generate — the bank covers these buckets");
      return;
    }
    setGenerating(true);
    try {
      const resp = await api<GenerateMoreQuestionsResponse>("/questions/generate-more", {
        method: "POST",
        body: { ...scope, buckets, dryRun: false },
      });
      toast.success(`Generation started (${resp.totalDeficit} questions queued)`);
      setDialogOpen(false);
      setDeficits(null);
      onChanged();
      void loadStats(DEFAULT_CASCADE);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start generation");
    } finally {
      setGenerating(false);
    }
  }

  function updateRow(i: number, patch: Partial<BankBucketRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Question Bank</span>
              <span className="text-xs text-muted-foreground">scope:</span>
              <ScopeMiniSelect
                cascade={statsCascade}
                subjects={subjects}
                chapters={chapters}
                topics={topics}
                onChange={(c) => {
                  setStatsCascade(c);
                  loadStats(c);
                }}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setStatsCascade(DEFAULT_CASCADE);
                loadStats(DEFAULT_CASCADE);
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
              <StatKpi label="MCQ" value={stats.byType.MCQ} />
              <StatKpi label="True/False" value={stats.byType.TRUE_FALSE} />
              <StatKpi label="Fill-in-blank" value={stats.byType.FILL_IN_BLANK} />
              <StatKpi label="Pending" value={stats.byApproval.PENDING} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Could not load bank stats.</p>
          )}

          {isTeacher && (
            <Button className="mt-3" size="sm" onClick={() => setDialogOpen(true)}>
              <Sparkles className="mr-1 size-3.5" /> Generate bank questions
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setDeficits(null); setRows(defaultRows()); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Generate bank questions</DialogTitle>
            <DialogDescription>
              Choose a scope and target buckets. Checking the bank will show which buckets
              still need questions before you generate.
            </DialogDescription>
          </DialogHeader>

          <ScopeMiniSelect
            cascade={baseCascade}
            subjects={subjects}
            chapters={chapters}
            topics={topics}
            onChange={setBaseCascade}
          />

          <div className="space-y-2">
            <Label>Target buckets</Label>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={row.questionType}
                  onValueChange={(v) => updateRow(i, { questionType: v as QuestionType })}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.difficulty}
                  onValueChange={(v) => updateRow(i, { difficulty: v as QuestionDifficulty })}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={row.count}
                  onChange={(e) => updateRow(i, { count: Number(e.target.value) || 0 })}
                  className="w-24"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove bucket"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRows((prev) => [...prev, { questionType: "MCQ", difficulty: "MEDIUM", count: 10 }])}
            >
              <Plus className="mr-1 size-3.5" /> Add bucket
            </Button>
          </div>

          {deficits && (
            <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                {deficits.totalDeficit === 0
                  ? "Bank already covers these buckets."
                  : `${deficits.totalDeficit} question${deficits.totalDeficit !== 1 ? "s" : ""} missing`}
              </p>
              {deficits.buckets.map((b) => (
                <div key={`${b.questionType}|${b.difficulty}`} className="flex items-center justify-between text-xs">
                  <span>
                    {b.questionType} · {b.difficulty}
                  </span>
                  <span className="text-muted-foreground">
                    have {b.existing} / want {b.requested}
                  </span>
                  <span className={cn(b.deficit > 0 ? "font-medium text-destructive" : "text-emerald-600")}>
                    {b.deficit > 0 ? `need ${b.deficit}` : "ok"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={checking || generating} onClick={() => void checkDeficits()}>
              {checking ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCw className="mr-1 size-3.5" />}
              Check bank
            </Button>
            <Button type="button" disabled={generating || checking || !deficits || deficits.totalDeficit === 0} onClick={() => void generateMissing()}>
              {generating ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 size-3.5" />}
              {generating ? "Starting…" : "Generate missing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatKpi({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-semibold tabular-nums">{value}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function ScopeMiniSelect({
  cascade,
  subjects,
  chapters,
  topics,
  onChange,
}: {
  cascade: Cascade;
  subjects: SubjectResponse[];
  chapters: ChapterResponse[];
  topics: TopicResponse[];
  onChange: (next: Cascade) => void;
}) {
  const chapterOptions = chapters.filter((c) => c.subjectId === cascade.subjectId);
  const topicOptions = topics.filter((t) => t.chapterId === cascade.chapterId);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={cascade.subjectId || undefined}
        onValueChange={(v) => onChange({ subjectId: v, chapterId: "", topicId: "" })}
      >
        <SelectTrigger className="w-[130px] h-7 text-xs">
          <SelectValue placeholder="Subject" />
        </SelectTrigger>
        <SelectContent>
          {subjects.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={cascade.chapterId || undefined}
        onValueChange={(v) => onChange({ ...cascade, chapterId: v, topicId: "" })}
        disabled={!cascade.subjectId}
      >
        <SelectTrigger className="w-[130px] h-7 text-xs">
          <SelectValue placeholder="Chapter" />
        </SelectTrigger>
        <SelectContent>
          {chapterOptions.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={cascade.topicId || undefined}
        onValueChange={(v) => onChange({ ...cascade, topicId: v })}
        disabled={!cascade.chapterId}
      >
        <SelectTrigger className="w-[130px] h-7 text-xs">
          <SelectValue placeholder="Topic" />
        </SelectTrigger>
        <SelectContent>
          {topicOptions.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}