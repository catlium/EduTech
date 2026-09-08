"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Plus,
  Sparkles,
  X,
} from "lucide-react";

import { api, ApiError, waitForJob } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { ChapterTree } from "@/components/app/chapter-tree";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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
  ChapterResponse,
  MaterialResponse,
} from "@catlium/contracts";

type View = "loading" | "none" | "editing" | "confirmed";
type Generation = { jobId: string; status: string; error?: { message?: string } | null };

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function newChapter(): SyllabusChapter {
  return { name: "", description: "", topics: [{ name: "", description: "" }] };
}

export default function SyllabusPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [view, setView] = useState<View>("loading");
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [proposal, setProposal] = useState<SyllabusResponse | null>(null);
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [confirmedChapters, setConfirmedChapters] = useState<ChapterResponse[]>([]);

  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);

  const [proposalChapters, setProposalChapters] = useState<SyllabusChapter[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const eligibleMaterials = materials.filter(
    (m) => m.processingStatus === "READY" && m.status === "ACTIVE",
  );

  const load = useCallback(async () => {
    if (!institute) return;
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
        const { proposal: prop } = await api<{ proposal: SyllabusResponse }>(
          `/academic/subjects/${subjectId}/syllabus`,
        );
        setProposal(prop);
        if (prop.status === "CONFIRMED") {
          setView("confirmed");
          const { chapters } = await api<{ chapters: ChapterResponse[] }>(
            `/academic/subjects/${subjectId}/chapters`,
          );
          setConfirmedChapters(chapters);
        } else {
          setView("editing");
          setProposalChapters(deepClone(prop.structure.chapters));
          setDirty(false);
        }
      } catch {
        setView("none");
        if (matRes.materials.length > 0) setSelectedMaterialId(matRes.materials[0].id);
      }
    } catch {
      toast.error("Failed to load syllabus");
      setView("none");
    }
  }, [institute, subjectId]);

  useEffect(() => { void load(); }, [load]);

  /* ── Generate ──────────────────────────────────────────────────────────── */

  async function onGenerate() {
    if (!isTeacher || generating) return;
    setGenerating(true);
    setGenProgress(0);
    try {
      const { generation } = await api<{ generation: Generation }>(
        `/academic/subjects/${subjectId}/syllabus/generate`,
        { method: "POST", body: { materialId: selectedMaterialId || undefined } },
      );
      toast.success("AI syllabus generation started");

      await waitForJob(async () => {
        const { generation: g } = await api<{ generation: Generation }>(
          `/academic/subjects/${subjectId}/syllabus/jobs/${generation.jobId}`,
        );
        setGenProgress((p) => Math.min(p + 12, 90));
        return { job: { status: g.status, error: g.error } } as { job: { status: string } };
      });

      const { proposal: prop } = await api<{ proposal: SyllabusResponse }>(
        `/academic/subjects/${subjectId}/syllabus`,
      );
      setProposal(prop);
      setProposalChapters(deepClone(prop.structure.chapters));
      setDirty(false);
      setView("editing");
      toast.success("Syllabus generated — review and edit below");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Generation failed");
    } finally {
      setGenerating(false);
      setGenProgress(100);
    }
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
      const { chapters } = await api<{ chapters: ChapterResponse[] }>(
        `/academic/subjects/${subjectId}/chapters`,
      );
      setConfirmedChapters(chapters);
      setView("confirmed");
      toast.success("Syllabus confirmed — chapters and topics created");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  /* ── Structure editing helpers ──────────────────────────────────────────── */

  const updateChapter = (ci: number, patch: Partial<SyllabusChapter>) => {
    setProposalChapters((prev) => {
      const next = deepClone(prev);
      Object.assign(next[ci], patch);
      return next;
    });
    setDirty(true);
  };

  const updateTopic = (ci: number, ti: number, patch: Partial<SyllabusChapter["topics"][number]>) => {
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

  if (view === "loading") {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Loading syllabus...
      </div>
    );
  }

  /* ── Confirmed ─────────────────────────────────────────────────────────── */

  if (view === "confirmed") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
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
          <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">CONFIRMED</Badge>
          {proposal?.confirmedAt && (
            <p className="mt-2 text-sm text-muted-foreground">
              Confirmed {formatDate(proposal.confirmedAt)}
            </p>
          )}
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Chapters ({confirmedChapters.length})</h2>
          {confirmedChapters.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-8" />}
              title="No chapters"
              description="Confirm the proposal to generate the academic hierarchy."
            />
          ) : (
            <ChapterTree
              subjectId={subjectId}
              isTeacher={isTeacher}
              chapters={confirmedChapters.sort((a, b) => a.sortOrder - b.sortOrder)}
            />
          )}
        </section>
      </div>
    );
  }

  /* ── No proposal — generate ────────────────────────────────────────────── */

  if (view === "none") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
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
        </div>

        {generating ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generating syllabus...</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={genProgress} className="h-2" />
              <p className="text-sm text-muted-foreground">
                AI is analyzing your material and building the chapter/topic structure.
              </p>
            </CardContent>
          </Card>
        ) : eligibleMaterials.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" />}
            title="No syllabus material"
            description="Create a text material for this subject first, then generate an AI syllabus."
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
                Pick a source material. The AI will extract a chapter/topic structure
                you can review before confirming.
              </p>
              <div className="grid gap-2">
                <Label>Source material</Label>
                <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick a material" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleMaterials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {eligibleMaterials.length} eligible material{eligibleMaterials.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex justify-end">
                <Button disabled={!selectedMaterialId || !isTeacher} onClick={() => void onGenerate()}>
                  <Sparkles className="mr-1 size-3.5" /> Generate syllabus
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  /* ── Editing (PENDING_REVIEW) ──────────────────────────────────────────── */

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
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
            title="Edit syllabus"
            description={`${subject?.name ?? ""} — ${proposalChapters.length} chapters, ${topicCount} topics`}
          />
          <div className="flex items-center gap-2">
            <StatusBadge status={proposal?.status ?? "PENDING_REVIEW"} />
            {proposal?.updatedAt && (
              <span className="text-sm text-muted-foreground">Saved {formatDate(proposal.updatedAt)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={saving || !dirty} onClick={() => void onSave()}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" disabled={confirming || saving} onClick={() => setShowConfirmDialog(true)}>
            Confirm &amp; Create
          </Button>
        </div>
      </div>

      {/* chapters */}
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

                  {/* topics */}
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Topics ({chapter.topics.length})</p>
                    {chapter.topics.map((topic, ti) => (
                      <div key={ti} className="flex gap-2">
                        <Input
                          value={topic.name}
                          placeholder="Topic name..."
                          className="flex-1"
                          onChange={(e) => updateTopic(ci, ti, { name: e.target.value })}
                        />
                        <Input
                          value={topic.description ?? ""}
                          placeholder="Description..."
                          className="w-48"
                          onChange={(e) => updateTopic(ci, ti, { description: e.target.value || undefined })}
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

      {/* confirm dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm syllabus?</DialogTitle>
            <DialogDescription>
              This creates {proposalChapters.length} chapter(s) with {topicCount} topic(s)
              in the academic hierarchy. This action cannot be undone.
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
