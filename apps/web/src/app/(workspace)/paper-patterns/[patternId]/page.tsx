"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, ArrowDown, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCards } from "@/components/app/loading";
import { ErrorState } from "@/components/app/error-state";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import type { SubjectResponse, MaterialResponse } from "@catlium/contracts";

/* ── local types (backend returns these shapes but contracts only exports the Zod schemas) ── */

interface Section {
  id: string;
  name: string;
  questionType?: string;
  count?: number | null;
  marksPerQuestion?: number | null;
  totalMarks?: number | null;
  compulsory: boolean;
  attemptCount?: number | null;
  difficultyDistribution?: { EASY?: number; MEDIUM?: number; HARD?: number } | null;
  topicDistribution?: { name: string; percentage?: number | null }[] | null;
}

interface PatternStructure {
  totalMarks: number;
  durationMinutes: number;
  instructions: string[];
  sections: Section[];
}

interface PaperPattern {
  id: string;
  subjectId: string;
  title: string;
  description: string | null;
  status: string;
  version: number;
  sourceType: string;
  structure: PatternStructure | null;
  validatedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const QT_OPTIONS = ["", "MCQ", "TRUE_FALSE", "FILL_IN_BLANK"] as const;
const SOURCE_TYPES_TEXT = ["TEXT", "MATERIAL"] as const;

function emptySection(): Section {
  return { id: crypto.randomUUID(), name: "", compulsory: true };
}

function buildInstructions(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/* ────────────────────────────────────────────── */

export default function PatternDetailPage() {
  const { patternId } = useParams<{ patternId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [pattern, setPattern] = useState<PaperPattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* structure editor */
  const [totalMarks, setTotalMarks] = useState<number | "">("");
  const [durationMinutes, setDurationMinutes] = useState<number | "">("");
  const [instructionsText, setInstructionsText] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [saving, setSaving] = useState(false);
  const [structureLoaded, setStructureLoaded] = useState(false);

  /* dialogs */
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeSource, setAnalyzeSource] = useState<string>("TEXT");
  const [analyzeText, setAnalyzeText] = useState("");
  const [analyzeMaterialId, setAnalyzeMaterialId] = useState("");
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState("");

  const [validateResult, setValidateResult] = useState<{
    ok: boolean;
    messages: string[];
  } | null>(null);
  const [validating, setValidating] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentMaxMarks, setAssessmentMaxMarks] = useState<number | "">("");
  const [creatingAssessment, setCreatingAssessment] = useState(false);

  const alive = useRef(true);

  /* ── fetch pattern ── */
  const loadPattern = useCallback(async () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    try {
      const { pattern: p } = await api<{ pattern: PaperPattern }>(
        `/paper-patterns/${patternId}`,
      );
      if (!alive.current) return;
      setPattern(p);
      applyStructure(p.structure);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof ApiError && err.status === 404) {
        setError("NOT_FOUND");
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to load pattern");
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [institute, patternId]);

  useEffect(() => {
    alive.current = true;
    void loadPattern();
    return () => {
      alive.current = false;
    };
  }, [loadPattern]);

  function applyStructure(s: PatternStructure | null) {
    if (!s) {
      setSections([]);
      setTotalMarks("");
      setDurationMinutes("");
      setInstructionsText("");
      setStructureLoaded(false);
      return;
    }
    setSections(s.sections.map((sec) => ({ ...sec })));
    setTotalMarks(s.totalMarks);
    setDurationMinutes(s.durationMinutes);
    setInstructionsText(s.instructions.join("\n"));
    setStructureLoaded(true);
  }

  /* ── subject name ── */
  const [subjectName, setSubjectName] = useState("");
  useEffect(() => {
    if (!institute || !pattern) return;
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal })
      .then(({ subjects }) => {
        setSubjectName(subjects.find((s) => s.id === pattern.subjectId)?.name ?? "");
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute, pattern?.subjectId]);

  /* ── materials for analyze dialog ── */
  useEffect(() => {
    if (!institute || !analyzeOpen) return;
    const ctrl = new AbortController();
    api<{ materials: MaterialResponse[] }>("/materials?status=ACTIVE", { signal: ctrl.signal })
      .then(({ materials }) => setMaterials(materials))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute, analyzeOpen]);

  /* ── sections helpers ── */
  function updateSection(idx: number, patch: Partial<Section>) {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function moveSection(idx: number, dir: -1 | 1) {
    setSections((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function removeSection(idx: number) {
    setSections((prev) => prev.filter((_, i) => i !== idx));
  }

  /* ── save structure ── */
  async function onSaveStructure() {
    if (!pattern) return;
    const filled = sections.filter((s) => s.name.trim());
    if (filled.length === 0) {
      toast.error("Add at least one section with a name");
      return;
    }
    if (!totalMarks || !durationMinutes) {
      toast.error("Total marks and duration are required");
      return;
    }
    setSaving(true);
    try {
      const structure: PatternStructure = {
        totalMarks: Number(totalMarks),
        durationMinutes: Number(durationMinutes),
        instructions: buildInstructions(instructionsText),
        sections: filled.map((s) => ({
          ...s,
          id: crypto.randomUUID(),
          count: s.count == null ? null : Number(s.count),
          marksPerQuestion: s.marksPerQuestion == null ? null : Number(s.marksPerQuestion),
          totalMarks: s.totalMarks == null ? null : Number(s.totalMarks),
          attemptCount: s.attemptCount == null ? null : Number(s.attemptCount),
          questionType: s.questionType || undefined,
        })),
      };
      const { pattern: updated } = await api<{ pattern: PaperPattern }>(
        `/paper-patterns/${pattern.id}`,
        { method: "PATCH", body: { structure, version: pattern.version } },
      );
      setPattern(updated);
      applyStructure(updated.structure);
      toast.success("Saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Changed by someone else — reloaded");
        void loadPattern();
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  /* ── analyze ── */
  async function onAnalyze() {
    if (!pattern) return;
    const src =
      analyzeSource === "TEXT"
        ? { type: "TEXT" as const, text: analyzeText }
        : { type: "MATERIAL" as const, id: analyzeMaterialId };
    if (analyzeSource === "TEXT" && !analyzeText.trim()) {
      toast.error("Paste some text first");
      return;
    }
    if (analyzeSource === "MATERIAL" && !analyzeMaterialId) {
      toast.error("Select a material first");
      return;
    }
    setAnalyzing(true);
    setAnalyzeProgress("Starting analysis…");
    try {
      const { generation } = await api<{ generation: { jobId: string } }>(
        `/paper-patterns/${pattern.id}/analyze`,
        { method: "POST", body: { source: src } },
      );
      const jobId = generation.jobId;
      /* poll */
      let done = false;
      let ticks = 0;
      while (!done) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!alive.current) return;
        if (++ticks > 120) {
          toast.error("Analysis timed out");
          setAnalyzeOpen(false);
          return;
        }
        const { generation: polled } = await api<{
          generation: {
            status: string;
            result?: { proposal?: PatternStructure };
            error?: { message?: string };
          };
        }>(`/paper-patterns/${pattern.id}/analyze/${jobId}`);
        const status = polled.status.toUpperCase();
        if (status === "COMPLETED") {
          if (polled.result?.proposal) {
            applyStructure(polled.result.proposal);
            setStructureLoaded(true);
            toast.success("Structure loaded from AI analysis — review then Save");
          } else {
            toast("Analysis complete — no structural proposal");
          }
          done = true;
          setAnalyzeOpen(false);
        } else if (status === "FAILED") {
          toast.error(polled.error?.message ?? "Analysis failed");
          done = true;
          setAnalyzeOpen(false);
        } else {
          setAnalyzeProgress(
            status === "RUNNING" || status === "PROCESSING"
              ? "Analyzing… (this may take a minute)"
              : "Analyzing…",
          );
        }
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  /* ── validate ── */
  async function onValidate() {
    if (!pattern) return;
    setValidating(true);
    setValidateResult(null);
    try {
      const res = await api<{ valid: boolean; errors: string[] }>(
        `/paper-patterns/${pattern.id}/validate`,
        { method: "POST" },
      );
      setValidateResult({ ok: res.valid, messages: res.errors });
      toast.success(res.valid ? "Validation passed" : "Validation found issues");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  /* ── approve ── */
  async function onApprove() {
    if (!pattern) return;
    setApproving(true);
    try {
      const { pattern: updated } = await api<{ pattern: PaperPattern }>(
        `/paper-patterns/${pattern.id}/approve`,
        { method: "POST" },
      );
      setPattern(updated);
      setApproveOpen(false);
      toast.success("Pattern approved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  }

  /* ── create assessment ── */
  async function onCreateAssessment() {
    if (!pattern) return;
    setCreatingAssessment(true);
    try {
      const body: Record<string, unknown> = {};
      if (assessmentTitle.trim()) body.title = assessmentTitle.trim();
      if (assessmentMaxMarks !== "") body.maxMarks = Number(assessmentMaxMarks);
      const { assessment } = await api<{ assessment: { id: string } }>(
        `/paper-patterns/${pattern.id}/assessment`,
        { method: "POST", body },
      );
      toast.success("Assessment created");
      router.push(`/assessments/${assessment.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create assessment");
    } finally {
      setCreatingAssessment(false);
    }
  }

  /* ── render ── */
  if (loading) {
    return (
      <div>
        <div className="mb-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/paper-patterns">
              <ArrowLeft className="mr-1 size-3.5" /> Paper Patterns
            </Link>
          </Button>
        </div>
        <SkeletonCards count={2} />
      </div>
    );
  }

  if (error === "NOT_FOUND") {
    return (
      <div>
        <div className="mb-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/paper-patterns">
              <ArrowLeft className="mr-1 size-3.5" /> Paper Patterns
            </Link>
          </Button>
        </div>
        <EmptyState
          title="Pattern not found"
          description="This paper pattern may have been deleted or the link is incorrect."
        >
          <Button size="sm" asChild>
            <Link href="/paper-patterns">Back to patterns</Link>
          </Button>
        </EmptyState>
      </div>
    );
  }

  if (error || !pattern) {
    return (
      <div>
        <div className="mb-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/paper-patterns">
              <ArrowLeft className="mr-1 size-3.5" /> Paper Patterns
            </Link>
          </Button>
        </div>
        <ErrorState description={error ?? "Failed to load pattern"} onRetry={loadPattern} />
      </div>
    );
  }

  const canApprove = pattern.status !== "APPROVED";

  return (
    <div>
      {/* back */}
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/paper-patterns">
            <ArrowLeft className="mr-1 size-3.5" /> Paper Patterns
          </Link>
        </Button>
      </div>

      <PageHeader
        title={pattern.title || "Untitled pattern"}
        description={pattern.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={pattern.status} />
            {isTeacher && (
              <>
                <Button size="sm" variant="outline" onClick={() => setAnalyzeOpen(true)}>
                  Analyze
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onValidate}
                  disabled={validating}
                >
                  {validating && <Loader2 className="mr-1 size-3 animate-spin" />}
                  Validate
                </Button>
                {canApprove && (
                  <Button size="sm" onClick={() => setApproveOpen(true)}>
                    Approve
                  </Button>
                )}
                {pattern.status === "APPROVED" && (
                  <Button size="sm" onClick={() => {
                    setAssessmentTitle(pattern.title ? `${pattern.title} — Assessment` : "Assessment");
                    setAssessmentMaxMarks(pattern.structure?.totalMarks ?? "");
                    setAssessmentOpen(true);
                  }}>
                    Create Assessment
                  </Button>
                )}
                <Button size="sm" onClick={onSaveStructure} disabled={saving}>
                  {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
                  Save
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* structure-loaded banner */}
      {structureLoaded && pattern.structure === null && sections.length > 0 && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
          Structure loaded from AI analysis — review then Save
        </div>
      )}

      {/* validate result */}
      {validateResult && (
        <div
          className={`mb-4 rounded-lg border p-4 text-sm ${
            validateResult.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {validateResult.ok ? (
            <div className="flex items-center gap-2 font-medium">
              <span className="text-lg">✓</span> Looks valid
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-medium">Findings:</p>
              <ul className="list-disc pl-4">
                {validateResult.messages.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* structure editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Structure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sections.length === 0 && !pattern.structure && !structureLoaded && (
            <EmptyState
              title="No structure yet"
              description="Write one below or use Analyze to draft it."
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Total marks *</Label>
              <Input
                type="number"
                min={1}
                value={totalMarks}
                onChange={(e) => setTotalMarks(e.target.value ? Number(e.target.value) : "")}
              />
            </div>
            <div className="grid gap-2">
              <Label>Duration (minutes) *</Label>
              <Input
                type="number"
                min={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value ? Number(e.target.value) : "")}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Instructions (one per line)</Label>
            <Textarea
              className="resize-none"
              rows={3}
              value={instructionsText}
              onChange={(e) => setInstructionsText(e.target.value)}
              placeholder="Read carefully before answering..."
            />
          </div>

          {/* sections */}
          <div className="space-y-3">
            {sections.map((sec, idx) => (
              <Card key={sec.id} className="border-dashed">
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={idx === 0}
                        onClick={() => moveSection(idx, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={idx === sections.length - 1}
                        onClick={() => moveSection(idx, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      onClick={() => removeSection(idx)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Section name *</Label>
                      <Input
                        value={sec.name}
                        onChange={(e) => updateSection(idx, { name: e.target.value })}
                        placeholder="e.g. Section A"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Question type</Label>
                      <Select
                        value={sec.questionType ?? ""}
                        onValueChange={(v) =>
                          updateSection(idx, { questionType: v || undefined })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Mixed" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Mixed</SelectItem>
                          {QT_OPTIONS.slice(1).map((qt) => (
                            <SelectItem key={qt} value={qt}>
                              {qt.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Count</Label>
                      <Input
                        type="number"
                        min={0}
                        value={sec.count ?? ""}
                        onChange={(e) =>
                          updateSection(idx, {
                            count: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Marks / question</Label>
                      <Input
                        type="number"
                        min={0}
                        value={sec.marksPerQuestion ?? ""}
                        onChange={(e) =>
                          updateSection(idx, {
                            marksPerQuestion: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Section total marks</Label>
                      <Input
                        type="number"
                        min={0}
                        value={sec.totalMarks ?? ""}
                        onChange={(e) =>
                          updateSection(idx, {
                            totalMarks: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </div>
                    <div className="flex items-end gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={sec.compulsory}
                          onCheckedChange={(c) => updateSection(idx, { compulsory: !!c })}
                        />
                        Compulsory
                      </label>
                      {!sec.compulsory && (
                        <div className="grid gap-1">
                          <Label className="text-xs">Attempt N of M</Label>
                          <Input
                            type="number"
                            min={1}
                            className="w-20"
                            value={sec.attemptCount ?? ""}
                            onChange={(e) =>
                              updateSection(idx, {
                                attemptCount: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* readonly difficulty/topic chips */}
                  {(sec.difficultyDistribution || (sec.topicDistribution && sec.topicDistribution.length > 0)) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {sec.difficultyDistribution && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          E:{sec.difficultyDistribution.EASY ?? "—"} M:{sec.difficultyDistribution.MEDIUM ?? "—"} H:{sec.difficultyDistribution.HARD ?? "—"}
                        </Badge>
                      )}
                      {sec.topicDistribution?.map((t, ti) => (
                        <Badge key={ti} variant="secondary" className="text-xs font-normal">
                          {t.name}{t.percentage != null ? ` ${t.percentage}%` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {isTeacher && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSections((prev) => [...prev, emptySection()])}>
              Add section
            </Button>
          )}
        </CardContent>
      </Card>

      {/* footer chips */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">{pattern.sourceType.replace(/_/g, " ")}</Badge>
        <Badge variant="secondary">v{pattern.version}</Badge>
        <span>Created {formatDate(pattern.createdAt)}</span>
        <span>Updated {formatDate(pattern.updatedAt)}</span>
        {subjectName && <span>{subjectName}</span>}
      </div>

      {/* ── Analyze dialog ── */}
      <Dialog open={analyzeOpen} onOpenChange={(o) => !analyzing && setAnalyzeOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Analyze paper pattern</DialogTitle>
            <DialogDescription>
              AI will analyze content and propose a structure.
            </DialogDescription>
          </DialogHeader>
          {analyzing ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-5 animate-spin" />
              <p className="text-sm text-muted-foreground">{analyzeProgress}</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex gap-4">
                  {SOURCE_TYPES_TEXT.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="analyze-source"
                        value={t}
                        checked={analyzeSource === t}
                        onChange={(e) => setAnalyzeSource(e.target.value)}
                      />
                      {t === "TEXT" ? "Paste text" : "From material"}
                    </label>
                  ))}
                </div>
                {analyzeSource === "TEXT" ? (
                  <Textarea
                    className="resize-none min-h-[120px]"
                    placeholder="Paste exam content or syllabus text..."
                    value={analyzeText}
                    onChange={(e) => setAnalyzeText(e.target.value)}
                  />
                ) : (
                  <Select value={analyzeMaterialId} onValueChange={setAnalyzeMaterialId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a material" />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAnalyzeOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={onAnalyze}>Analyze</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Approve dialog ── */}
      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve pattern"
        description="This marks the pattern as approved. It will be used for question generation and assessment creation."
        confirmLabel="Approve"
        loading={approving}
        onConfirm={onApprove}
      />

      {/* ── Create Assessment dialog ── */}
      <Dialog open={assessmentOpen} onOpenChange={(o) => !creatingAssessment && setAssessmentOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Assessment</DialogTitle>
            <DialogDescription>
              Generate an assessment from this approved pattern.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="assess-title">Title</Label>
              <Input
                id="assess-title"
                value={assessmentTitle}
                onChange={(e) => setAssessmentTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assess-marks">Max marks</Label>
              <Input
                id="assess-marks"
                type="number"
                min={1}
                value={assessmentMaxMarks}
                onChange={(e) =>
                  setAssessmentMaxMarks(e.target.value ? Number(e.target.value) : "")
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssessmentOpen(false)} disabled={creatingAssessment}>
              Cancel
            </Button>
            <Button onClick={onCreateAssessment} disabled={creatingAssessment}>
              {creatingAssessment && <Loader2 className="mr-1 size-3 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
