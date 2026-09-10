"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Clock,
  Layers,
  ListChecks,
  CircleDollarSign,
  Eye,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
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
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SubjectResponse, MaterialResponse } from "@catlium/contracts";
import {
  type BackendSection,
  type Rule,
  type Section,
  type TopicRow,
  TYPE_OPTIONS,
  TYPE_LABELS,
  emptyRule,
  emptySection,
  buildInstructions,
  ruleSubtotal,
  computeTotals,
  difficultySum,
  topicPercentSum,
  flattenSections,
  parseBackendSections,
  collectIssues,
} from "@/lib/paper-pattern-builder";

const SOURCE_TYPES_TEXT = ["TEXT", "MATERIAL"] as const;

/* ── response types (backend returns these shapes but contracts only exports the Zod schemas) ── */

interface PatternStructure {
  totalMarks: number;
  durationMinutes: number;
  instructions: string[];
  sections: BackendSection[];
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


/* ────────────────────────────────────────────── */

export default function PatternBuilderPage() {
  const { patternId } = useParams<{ patternId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [pattern, setPattern] = useState<PaperPattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* builder state */
  const [durationMinutes, setDurationMinutes] = useState<number | "">("");
  const [instructionsText, setInstructionsText] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [saving, setSaving] = useState(false);
  const [structureLoaded, setStructureLoaded] = useState(false);

  /* review dialog */
  const [reviewOpen, setReviewOpen] = useState(false);

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
      setDurationMinutes("");
      setInstructionsText("");
      setStructureLoaded(false);
      return;
    }
    setSections(parseBackendSections(s.sections));
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
  function updateRule(sIdx: number, rIdx: number, patch: Partial<Rule>) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === sIdx ? { ...s, rules: s.rules.map((r, j) => (j === rIdx ? { ...r, ...patch } : r)) } : s,
      ),
    );
  }
  function moveRule(sIdx: number, rIdx: number, dir: -1 | 1) {
    setSections((prev) =>
      prev.map((s, i) => {
        if (i !== sIdx) return s;
        const rules = [...s.rules];
        const target = rIdx + dir;
        if (target < 0 || target >= rules.length) return s;
        [rules[rIdx], rules[target]] = [rules[target], rules[rIdx]];
        return { ...s, rules };
      }),
    );
  }
  function removeRule(sIdx: number, rIdx: number) {
    setSections((prev) =>
      prev.map((s, i) => (i === sIdx ? { ...s, rules: s.rules.filter((_, j) => j !== rIdx) } : s)),
    );
  }
  function addRule(sIdx: number) {
    setSections((prev) => prev.map((s, i) => (i === sIdx ? { ...s, rules: [...s.rules, emptyRule()] } : s)));
  }

  /* ── save structure (via existing Paper Pattern PATCH + optimistic version) ── */
  async function onSave() {
    if (!pattern) return;
    if (!durationMinutes) {
      toast.error("Duration (minutes) is required");
      return;
    }
    const flattened = flattenSections(sections);
    if (flattened.length === 0) {
      toast.error("Add at least one section with a configured question-type rule");
      return;
    }
    if (flattened.length > 50) {
      toast.error("A paper pattern supports at most 50 sections");
      return;
    }
    const totals = computeTotals(sections);
    setSaving(true);
    try {
      const structure: PatternStructure = {
        totalMarks: Math.max(1, totals.marks),
        durationMinutes: Number(durationMinutes),
        instructions: buildInstructions(instructionsText),
        sections: flattened,
      };
      const { pattern: updated } = await api<{ pattern: PaperPattern }>(
        `/paper-patterns/${pattern.id}`,
        { method: "PATCH", body: { structure, version: pattern.version } },
      );
      setPattern(updated);
      applyStructure(updated.structure);
      setReviewOpen(false);
      toast.success("Blueprint saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Changed by someone else — reloaded");
        setReviewOpen(false);
        void loadPattern();
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  /* ── analyze (unchanged behavior) ── */
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

  /* ── derived values for render ── */
  const totals = computeTotals(sections);
  const durationLabel =
    durationMinutes === "" ? "—" : `${durationMinutes} min`;

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
    <TooltipProvider delayDuration={200}>
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
                    <Button size="sm" variant="outline" onClick={() => setApproveOpen(true)}>
                      Approve
                    </Button>
                  )}
                  {pattern.status === "APPROVED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAssessmentTitle(pattern.title ? `${pattern.title} — Assessment` : "Assessment");
                        setAssessmentMaxMarks(totals.marks || "");
                        setAssessmentOpen(true);
                      }}
                    >
                      Create Assessment
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setReviewOpen(true)}>
                    <Eye className="mr-1 size-3.5" /> Review &amp; Save
                  </Button>
                </>
              )}
            </div>
          }
        />

        {/* structure-loaded banner */}
        {structureLoaded && pattern.structure === null && sections.length > 0 && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
            Structure loaded from AI analysis — review then Save.
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

        {/* live totals */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Layers} label="Sections" value={totals.sections} />
          <StatCard
            icon={ListChecks}
            label="Questions"
            value={totals.questions}
            hint={totals.uncertain ? "some quantities unset" : undefined}
          />
          <StatCard
            icon={CircleDollarSign}
            label="Total marks"
            value={totals.marks}
            hint={totals.uncertain ? "computed from set values" : "count × marks"}
          />
          <StatCard icon={Clock} label="Duration" value={durationLabel} />
        </div>

        {/* blueprint editor */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Blueprint</CardTitle>
            {sections.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {flattenSections(sections).length} rule{sections.length !== 1 ? "s" : ""} ·{" "}
                {sections.length} section{sections.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {sections.length === 0 && !pattern.structure && !structureLoaded && (
              <EmptyState
                title="No blueprint yet"
                description="Add a section, then configure its question-type rules. Analyze can draft one for you."
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
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

            <Separator />

            {/* sections */}
            <div className="space-y-4">
              {sections.map((sec, sIdx) => (
                <Card key={sec.id} className="border-dashed">
                  <CardContent className="space-y-3 pt-4">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={sIdx === 0}
                                onClick={() => moveSection(sIdx, -1)}
                              >
                                <ArrowUp className="size-3.5" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Move section up</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={sIdx === sections.length - 1}
                                onClick={() => moveSection(sIdx, 1)}
                              >
                                <ArrowDown className="size-3.5" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Move section down</TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        className="font-medium"
                        value={sec.name}
                        onChange={(e) => updateSection(sIdx, { name: e.target.value })}
                        placeholder="Section name (e.g. Section A)"
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive"
                              onClick={() => removeSection(sIdx)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Remove section</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* section-level options */}
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={sec.compulsory}
                          onCheckedChange={(c) => updateSection(sIdx, { compulsory: !!c })}
                        />
                        Compulsory
                      </label>
                      {!sec.compulsory && (
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Attempt</Label>
                          <Input
                            type="number"
                            min={1}
                            className="w-20"
                            value={sec.attemptCount ?? ""}
                            placeholder="N of M"
                            onChange={(e) =>
                              updateSection(sIdx, {
                                attemptCount: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                          />
                          <span className="text-xs text-muted-foreground">questions</span>
                        </div>
                      )}
                    </div>

                    {/* rules */}
                    <div className="space-y-3">
                      {sec.rules.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No question-type rules — add one below.
                        </p>
                      )}
                      {sec.rules.map((rule, rIdx) => {
                        const sub = ruleSubtotal(rule);
                        const diffSum = difficultySum(rule.difficulty);
                        const diffComplete = rule.difficulty.EASY !== "" && rule.difficulty.MEDIUM !== "" && rule.difficulty.HARD !== "";
                        const topicsConfigured = rule.topics.filter((t) => t.name.trim()).length > 0;
                        const topicsSum = topicPercentSum(rule.topics);
                        return (
                          <div key={rule.id} className="rounded-lg border bg-muted/30 p-3">
                            <div className="grid items-end gap-3 sm:grid-cols-[minmax(150px,1fr)_120px_120px_auto_auto]">
                              <div className="grid gap-2">
                                <Label className="text-xs">Question type</Label>
                                <Select
                                  value={rule.questionType}
                                  onValueChange={(v) =>
                                    updateRule(sIdx, rIdx, {
                                      questionType: v as Rule["questionType"],
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TYPE_OPTIONS.map((qt) => (
                                      <SelectItem key={qt || "MIXED"} value={qt}>
                                        {qt === "" ? "Mixed" : TYPE_LABELS[qt]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-2">
                                <Label className="text-xs">Questions</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  value={rule.count ?? ""}
                                  placeholder="—"
                                  onChange={(e) =>
                                    updateRule(sIdx, rIdx, {
                                      count: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label className="text-xs">Marks / question</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  value={rule.marksPerQuestion ?? ""}
                                  placeholder="—"
                                  onChange={(e) =>
                                    updateRule(sIdx, rIdx, {
                                      marksPerQuestion: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                />
                              </div>
                              <div className="pb-1">
                                <Badge variant={sub != null ? "default" : "outline"} className="text-xs tabular-nums">
                                  {sub != null ? `${sub} marks` : "unset"}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-0.5 pb-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        disabled={rIdx === 0}
                                        onClick={() => moveRule(sIdx, rIdx, -1)}
                                      >
                                        <ArrowUp className="size-3" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Move rule up</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        disabled={rIdx === sec.rules.length - 1}
                                        onClick={() => moveRule(sIdx, rIdx, 1)}
                                      >
                                        <ArrowDown className="size-3" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Move rule down</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 text-destructive"
                                        onClick={() => removeRule(sIdx, rIdx)}
                                      >
                                        <Trash2 className="size-3" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Remove rule</TooltipContent>
                                </Tooltip>
                              </div>
                            </div>

                            {/* constraints */}
                            <div className="mt-3 grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs">Difficulty split (%)</Label>
                                  {diffComplete && diffSum !== 100 && (
                                    <Badge variant="destructive" className="text-[10px]">
                                      totals {diffSum}%
                                    </Badge>
                                  )}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  {(["EASY", "MEDIUM", "HARD"] as const).map((lv) => (
                                    <div key={lv} className="grid gap-1">
                                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        {lv === "EASY" ? "Easy" : lv === "MEDIUM" ? "Medium" : "Hard"}
                                      </span>
                                      <Input
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={rule.difficulty[lv]}
                                        placeholder="—"
                                        onChange={(e) =>
                                          updateRule(sIdx, rIdx, {
                                            difficulty: {
                                              ...rule.difficulty,
                                              [lv]: e.target.value ? Number(e.target.value) : "",
                                            },
                                          })
                                        }
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Topic distribution (%)</Label>
                                {rule.topics.map((t, ti) => (
                                  <div key={ti} className="flex items-center gap-2">
                                    <Input
                                      className="h-8"
                                      value={t.name}
                                      placeholder="Topic name"
                                      onChange={(e) =>
                                        updateRule(sIdx, rIdx, {
                                          topics: rule.topics.map((x, xi) =>
                                            xi === ti ? { ...x, name: e.target.value } : x,
                                          ),
                                        })
                                      }
                                    />
                                    <Input
                                      type="number"
                                      min={0}
                                      max={100}
                                      className="h-8 w-20"
                                      value={t.percentage}
                                      placeholder="%"
                                      onChange={(e) =>
                                        updateRule(sIdx, rIdx, {
                                          topics: rule.topics.map((x, xi) =>
                                            xi === ti
                                              ? { ...x, percentage: e.target.value ? Number(e.target.value) : "" }
                                              : x,
                                          ),
                                        })
                                      }
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 text-destructive"
                                      onClick={() =>
                                        updateRule(sIdx, rIdx, {
                                          topics: rule.topics.filter((_, i) => i !== ti),
                                        })
                                      }
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </div>
                                ))}
                                {topicsConfigured &&
                                  (() => {
                                    const withPct = rule.topics.some((t) => t.percentage !== "");
                                    return withPct && topicsSum !== 100 ? (
                                      <Badge variant="destructive" className="text-[10px]">
                                        totals {topicsSum}% (must be 100%)
                                      </Badge>
                                    ) : null;
                                  })()}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8"
                                  onClick={() =>
                                    updateRule(sIdx, rIdx, {
                                      topics: [...rule.topics, { name: "", percentage: "" }],
                                    })
                                  }
                                >
                                  <Plus className="mr-1 size-3.5" /> Add topic
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addRule(sIdx)}
                    >
                      <Plus className="mr-1 size-3.5" /> Add question-type rule
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            {isTeacher && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSections((prev) => [...prev, emptySection()])}
              >
                <Plus className="mr-1 size-3.5" /> Add section
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

        {/* ── Review & Save dialog ── */}
        <Dialog open={reviewOpen} onOpenChange={(o) => !saving && setReviewOpen(o)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Review blueprint</DialogTitle>
              <DialogDescription>
                Confirm the composition before it is saved to the paper pattern.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium">{pattern.title || "Untitled pattern"}</span>
                  <span className="text-muted-foreground"> · {durationLabel} · {totals.questions} questions · {totals.marks} marks</span>
                  {totals.uncertain && (
                    <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                      (some quantities unset)
                    </span>
                  )}
                </div>
                <StatusBadge status={pattern.status} />
              </div>

              {/* issues preview */}
              {(() => {
                const issues = collectIssues(sections);
                return issues.length ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <p className="mb-1 font-medium">Heads-up before saving:</p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {issues.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ) : null;
              })()}

              <Separator />

              {/* full blueprint readout */}
              {sections.map((sec) => {
                const configured = sec.rules.filter(
                  (r) => r.questionType !== "" || r.count != null || r.marksPerQuestion != null,
                );
                if (configured.length === 0) return null;
                const secSubtotal = configured.reduce(
                  (acc, r) => acc + (ruleSubtotal(r) ?? 0),
                  0,
                );
                return (
                  <div key={sec.id} className="space-y-1.5">
                    <div className="flex items-center justify-between border-b pb-1">
                      <span className="font-medium">{sec.name.trim() || "(untitled section)"}</span>
                      <span className="text-xs text-muted-foreground">
                        {sec.compulsory
                          ? "compulsory"
                          : `attempt ${sec.attemptCount ?? "?"} of ${configured.reduce((a, r) => a + (r.count ?? 0), 0)}`}
                        {" · "}
                        {secSubtotal} marks
                      </span>
                    </div>
                    {configured.map((r, i) => {
                      const sub = ruleSubtotal(r);
                      const title = TYPE_LABELS[r.questionType] ?? "Mixed";
                      const diffParts = [r.difficulty.EASY, r.difficulty.MEDIUM, r.difficulty.HARD].filter((v) => v !== "");
                      const topics = r.topics.filter((t) => t.name.trim());
                      return (
                        <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="min-w-[90px] text-muted-foreground">{title}</span>
                          <span className="tabular-nums">
                            {r.count ?? "?"} × {r.marksPerQuestion ?? "?"} ={" "}
                            <span className="font-medium tabular-nums">{sub ?? "—"}</span>
                          </span>
                          {r.questionType && <Badge variant="secondary" className="text-[10px]">{r.questionType}</Badge>}
                          {diffParts.length > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              E{diffParts[0]} M{diffParts[1] ?? "—"} H{diffParts[2] ?? "—"}
                            </Badge>
                          )}
                          {topics.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {topics.map((t) => `${t.name}${t.percentage !== "" ? `${t.percentage}%` : ""}`).join(", ")}
                            </span>
                          )}
                          {i === 0 && !sec.compulsory && sec.attemptCount != null && (
                            <Badge variant="outline" className="text-[10px]">choice</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={saving}>
                Keep editing
              </Button>
              <Button onClick={onSave} disabled={saving}>
                {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
                Save blueprint
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
    </TooltipProvider>
  );
}