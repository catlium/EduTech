"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { StatusBadge } from "@/components/app/status-badge";
import { SkeletonCards } from "@/components/app/loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  SyllabusResponse,
  SyllabusChapter,
  SubjectResponse,
  MaterialResponse,
} from "@catlium/contracts";

const STEPS = ["Generate", "Processing", "Review", "Confirm"] as const;

type Stage = "loading" | "generate" | "processing" | "review" | "confirmed";
type Generation = { jobId: string; status: string; error?: { message?: string } | null };

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function newChapter(): SyllabusChapter {
  return { name: "", description: "", topics: [{ name: "", description: "" }] };
}

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="mx-auto mb-8 flex w-full max-w-2xl flex-wrap items-center justify-center gap-y-3">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center">
            <span className="flex flex-col items-center gap-1.5 px-3">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-xs font-medium",
                  active && "border-primary bg-primary text-primary-foreground",
                  done && "border-emerald-500 bg-emerald-500 text-white",
                  !active && !done && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-xs",
                  active ? "font-semibold" : done ? "text-emerald-600" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span className={cn("hidden h-px w-8 bg-border sm:block", done && "bg-emerald-500")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function SyllabusPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [stage, setStage] = useState<Stage>("loading");
  const [loadError, setLoadError] = useState(false);
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [proposal, setProposal] = useState<SyllabusResponse | null>(null);
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);

  const [source, setSource] = useState("auto");
  const [jobId, setJobId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [jobError, setJobError] = useState<string | null>(null);

  const [proposalChapters, setProposalChapters] = useState<SyllabusChapter[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const eligibleMaterials = materials.filter(
    (m) => m.processingStatus === "READY" && m.status === "ACTIVE",
  );

  const fetchProposal = useCallback(async () => {
    const { proposal: prop } = await api<{ proposal: SyllabusResponse }>(
      `/academic/subjects/${subjectId}/syllabus`,
    );
    return prop;
  }, [subjectId]);

  const load = useCallback(async () => {
    if (!institute) return;
    setLoadError(false);
    setStage("loading");
    try {
      const [subjRes, matRes] = await Promise.all([
        api<{ subject: SubjectResponse }>(`/academic/subjects/${subjectId}`),
        api<{ materials: MaterialResponse[] }>(
          `/materials?subjectId=${subjectId}&processingStatus=READY&status=ACTIVE`,
        ),
      ]);
      setSubject(subjRes.subject);
      setMaterials(matRes.materials);

      try {
        const prop = await fetchProposal();
        setProposal(prop);
        if (prop.status === "CONFIRMED") {
          setStage("confirmed");
        } else {
          setProposalChapters(deepClone(prop.structure.chapters));
          setDirty(false);
          setStage("review");
        }
      } catch {
        setProposal(null);
        setStage("generate");
      }
    } catch {
      setLoadError(true);
    }
  }, [institute, subjectId, fetchProposal]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Generate ──────────────────────────────────────────────────────────── */

  async function onGenerate() {
    if (!isTeacher || generating) return;
    setGenerating(true);
    try {
      const { generation } = await api<{ generation: Generation }>(
        `/academic/subjects/${subjectId}/syllabus/generate`,
        { method: "POST", body: { materialId: source === "auto" ? undefined : source } },
      );
      toast.success("AI syllabus generation started");
      setJobId(generation.jobId);
    } catch (error) {
      setGenerating(false);
      toast.error(error instanceof ApiError ? error.message : "Failed to start generation");
    }
  }

  /* ── Job polling: 2s until completed/failed; aborted on leave ──────────── */

  useEffect(() => {
    if (!jobId) return;
    setStage("processing");
    setJobError(null);
    setGenProgress(0);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const { generation: g } = await api<{ generation: Generation }>(
          `/academic/subjects/${subjectId}/syllabus/jobs/${jobId}`,
          { signal: controller.signal },
        );
        if (cancelled) return;
        if (g.status === "completed" || g.status === "failed") {
          setGenerating(false);
          setGenProgress(100);
          if (g.status === "failed") {
            setJobError(g.error?.message ?? "Syllabus generation failed. Please try again.");
            return;
          }
          const prop = await fetchProposal();
          if (cancelled) return;
          setProposal(prop);
          setProposalChapters(deepClone(prop.structure.chapters));
          setDirty(false);
          setStage("review");
          toast.success("Syllabus generated — review and edit below");
          return;
        }
        setGenProgress((p) => Math.min(p + 12, 90));
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setGenerating(false);
        setJobError(
          error instanceof ApiError
            ? error.message
            : "Couldn't check generation progress. Please try again.",
        );
        return;
      }
      timer = setTimeout(poll, 2000);
    };

    timer = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [jobId, subjectId, fetchProposal]);

  function onCancelProcessing() {
    setJobId(null);
    setGenerating(false);
    setGenProgress(0);
    setStage("generate");
  }

  /* ── Save / Confirm ────────────────────────────────────────────────────── */

  async function onSave() {
    if (!proposal || !isTeacher) return;
    setSaving(true);
    try {
      const { proposal: updated } = await api<{ proposal: SyllabusResponse }>(
        `/academic/subjects/${subjectId}/syllabus`,
        { method: "PATCH", body: { structure: { chapters: proposalChapters } } },
      );
      setProposal(updated);
      setProposalChapters(deepClone(updated.structure.chapters));
      setDirty(false);
      toast.success("Syllabus saved");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function onConfirm() {
    if (!proposal || !isTeacher) return;
    setConfirming(true);
    setShowConfirmDialog(false);
    try {
      const { proposal: confirmed } = await api<{ proposal: SyllabusResponse }>(
        `/academic/subjects/${subjectId}/syllabus/confirm`,
        { method: "POST" },
      );
      setProposal(confirmed);
      setStage("confirmed");
      toast.success("Syllabus confirmed — chapters and topics created");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  /* ── Structure editing helpers ─────────────────────────────────────────── */

  const updateChapter = (ci: number, patch: Partial<SyllabusChapter>) => {
    setProposalChapters((prev) => {
      const next = deepClone(prev);
      Object.assign(next[ci], patch);
      return next;
    });
    setDirty(true);
  };

  const updateTopic = (
    ci: number,
    ti: number,
    patch: Partial<SyllabusChapter["topics"][number]>,
  ) => {
    setProposalChapters((prev) => {
      const next = deepClone(prev);
      Object.assign(next[ci].topics[ti], patch);
      return next;
    });
    setDirty(true);
  };

  const addTopic = (ci: number) => {
    setProposalChapters((prev) => {
      const next = deepClone(prev);
      next[ci].topics.push({ name: "", description: "" });
      return next;
    });
    setDirty(true);
  };

  const removeTopic = (ci: number, ti: number) => {
    setProposalChapters((prev) => {
      const next = deepClone(prev);
      next[ci].topics.splice(ti, 1);
      return next;
    });
    setDirty(true);
  };

  const removeChapter = (ci: number) => {
    setProposalChapters((prev) => {
      const next = deepClone(prev);
      next.splice(ci, 1);
      return next;
    });
    setDirty(true);
  };

  const addChapter = () => {
    setProposalChapters((prev) => [...deepClone(prev), newChapter()]);
    setDirty(true);
  };

  const topicCount = proposalChapters.reduce((n, c) => n + c.topics.length, 0);

  /* ── Loading ───────────────────────────────────────────────────────────── */

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Syllabus" description={subject?.name ?? ""} />
        <ErrorState
          title="Couldn't load the syllabus"
          description="We couldn't reach the server. Please try again."
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (stage === "loading") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Syllabus" description={subject?.name ?? ""} />
        <div className="py-8">
          <SkeletonCards count={3} />
        </div>
      </div>
    );
  }

  /* ── Generate ──────────────────────────────────────────────────────────── */

  if (stage === "generate") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => router.replace(`/subjects/${subjectId}`)}
          >
            <ArrowLeft className="mr-1 size-3.5" /> Back to subject
          </Button>
          <PageHeader title="Generate syllabus" description={subject?.name ?? ""} />
          <StepIndicator current={0} />
        </div>

        {proposal && (
          <Alert>
            <Info className="size-4" />
            <AlertTitle>You already have a syllabus draft</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Review your existing draft or regenerate it from material.</span>
              <span className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => setStage("review")}>
                  Review it
                </Button>
                <Button size="sm" onClick={() => void onGenerate()}>
                  Regenerate
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}

        {eligibleMaterials.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" />}
            title="No syllabus material"
            description="Add a text material for this subject first, then the AI can draft a syllabus from it."
          >
            <Button size="sm" variant="outline" onClick={() => router.push("/materials")}>
              Go to Materials
            </Button>
          </EmptyState>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generate AI syllabus</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The AI reads a subject material and drafts an ordered chapter and topic
                structure you can review and edit before confirming.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="syllabus-source">Source material</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id="syllabus-source" className="w-full">
                    <SelectValue placeholder="Choose a source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto — latest ready material</SelectItem>
                    {eligibleMaterials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {eligibleMaterials.length} eligible material
                  {eligibleMaterials.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex justify-end">
                <Button disabled={!isTeacher || generating} onClick={() => void onGenerate()}>
                  <Sparkles className="mr-1 size-3.5" /> Generate syllabus
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  /* ── Processing ────────────────────────────────────────────────────────── */

  if (stage === "processing") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => router.replace(`/subjects/${subjectId}`)}
          >
            <ArrowLeft className="mr-1 size-3.5" /> Back to subject
          </Button>
          <PageHeader title="Generate syllabus" description={subject?.name ?? ""} />
          <StepIndicator current={1} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="size-4 animate-spin" /> Drafting your syllabus
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobError ? (
              <div className="space-y-4">
                <ErrorState title="Generation failed" description={jobError} onRetry={() => void onGenerate()} />
                <Button variant="ghost" size="sm" onClick={() => setStage("generate")}>
                  Back to generate
                </Button>
              </div>
            ) : (
              <>
                <Progress value={genProgress} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  AI is drafting chapters and topics for {subject?.name}. This usually takes
                  about a minute.
                </p>
                <div>
                  <Button variant="ghost" size="sm" onClick={onCancelProcessing}>
                    <X className="mr-1 size-3.5" /> Stop monitoring
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ── Confirmed ─────────────────────────────────────────────────────────── */

  if (stage === "confirmed") {
    const chapters = proposal?.structure.chapters.length ?? 0;
    const topics =
      proposal?.structure.chapters.reduce((n, c) => n + c.topics.length, 0) ?? 0;
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => router.replace(`/subjects/${subjectId}`)}
          >
            <ArrowLeft className="mr-1 size-3.5" /> Back to subject
          </Button>
          <PageHeader title="Syllabus" description={subject?.name ?? ""} />
          <StepIndicator current={3} />
        </div>

        <Card className="py-10 text-center">
          <CardContent className="space-y-4">
            <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
            <h2 className="text-lg font-semibold">
              Syllabus confirmed — {chapters} chapter{chapters !== 1 ? "s" : ""}, {topics} topic
              {topics !== 1 ? "s" : ""} created
            </h2>
            <p className="text-sm text-muted-foreground">
              The academic hierarchy for {subject?.name} is ready to use.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button onClick={() => router.push(`/subjects/${subjectId}`)}>View subject</Button>
              <Button variant="outline" onClick={() => router.push("/materials")}>
                <FileText className="mr-1 size-3.5" /> Add learning material
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ── Review / Edit (PENDING_REVIEW) ────────────────────────────────────── */

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => router.replace(`/subjects/${subjectId}`)}
        >
          <ArrowLeft className="mr-1 size-3.5" /> Back to subject
        </Button>
        <PageHeader
          title="Review & edit syllabus"
          description={`${subject?.name ?? ""} — ${proposalChapters.length} chapters, ${topicCount} topics`}
        />
        <StepIndicator current={2} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={proposal?.status ?? "PENDING_REVIEW"} />
          {proposal?.updatedAt && (
            <span className="text-sm text-muted-foreground">Saved {formatDate(proposal.updatedAt)}</span>
          )}
        </div>
      </div>

      <section className="space-y-4">
        {proposalChapters.map((chapter, ci) => (
          <Card key={ci}>
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-1 shrink-0">
                  Ch. {ci + 1}
                </Badge>

                <div className="flex-1 space-y-3">
                  <Input
                    value={chapter.name}
                    placeholder="Chapter name..."
                    onChange={(e) => updateChapter(ci, { name: e.target.value })}
                  />
                  <Textarea
                    value={chapter.description ?? ""}
                    placeholder="Description (optional)..."
                    className="min-h-16 resize-none"
                    onChange={(e) => updateChapter(ci, { description: e.target.value || undefined })}
                  />

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Topics ({chapter.topics.length})</p>
                    {chapter.topics.map((topic, ti) => (
                      <div key={ti} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          value={topic.name}
                          placeholder="Topic name..."
                          className="flex-1"
                          onChange={(e) => updateTopic(ci, ti, { name: e.target.value })}
                        />
                        <Input
                          value={topic.description ?? ""}
                          placeholder="Description..."
                          className="w-full sm:w-48"
                          onChange={(e) =>
                            updateTopic(ci, ti, { description: e.target.value || undefined })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeTopic(ci, ti)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm" onClick={() => addTopic(ci)}>
                      <Plus className="mr-1 size-3.5" /> Add topic
                    </Button>
                  </div>
                </div>

                {proposalChapters.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeChapter(ci)}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" size="sm" className="w-full" onClick={addChapter}>
          <Plus className="mr-1 size-3.5" /> Add chapter
        </Button>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button size="sm" variant="ghost" onClick={() => setStage("generate")}>
          <RefreshCw className="mr-1 size-3.5" /> Regenerate
        </Button>
        <Button size="sm" variant="outline" disabled={saving || !dirty} onClick={() => void onSave()}>
          {saving ? "Saving..." : "Save draft"}
        </Button>
        <Button size="sm" disabled={confirming || saving} onClick={() => setShowConfirmDialog(true)}>
          Confirm &amp; Create
        </Button>
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm syllabus?</DialogTitle>
            <DialogDescription>
              This creates {proposalChapters.length} chapter(s) with {topicCount} topic(s) in the
              academic hierarchy. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirmDialog(false)} disabled={confirming}>
              Cancel
            </Button>
            <Button disabled={confirming} onClick={() => void onConfirm()}>
              {confirming ? "Confirming..." : "Confirm & Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}