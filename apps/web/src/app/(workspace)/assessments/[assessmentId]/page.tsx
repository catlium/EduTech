"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ClipboardList, ListOrdered, Plus, Trash2, Pencil } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDate, formatDuration } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { StatusBadge } from "@/components/app/status-badge";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { PageLoader } from "@/components/app/loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type {
  AssessmentResponse,
  AssessmentQuestion,
  CreateAssessmentRequest,
  UpdateAssessmentRequest,
  QuestionListItem,
} from "@catlium/contracts";
import {
  CreateAssessmentRequestSchema,
  UpdateAssessmentRequestSchema,
} from "@catlium/contracts";

const QUESTION_TYPES = ["ALL", "MCQ", "TRUE_FALSE", "FILL_IN_BLANK"] as const;

function scheduleRange(startsAt?: string | null, endsAt?: string | null): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (v: string) =>
    new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  if (startsAt) return `From ${fmt(startsAt)}`;
  return `Until ${fmt(endsAt!)}`;
}

function workflowHint(status: AssessmentResponse["status"]): string | null {
  switch (status) {
    case "DRAFT": return "Add questions, then Publish.";
    case "PUBLISHED": return "Activate when ready for the attempt window.";
    case "ACTIVE": return "Complete once the attempt window closes.";
    case "COMPLETED": return null;
  }
}

export default function AssessmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ assessmentId: string }>();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editForm = useForm<UpdateAssessmentRequest>({
    resolver: zodResolver(UpdateAssessmentRequestSchema),
  });

  // Status action loading
  const [working, setWorking] = useState(false);

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<"publish" | "activate" | "unpublish" | "complete" | "delete" | null>(null);
  const [removingQuestionId, setRemovingQuestionId] = useState<string | null>(null);

  // Add questions dialog
  const [addOpen, setAddOpen] = useState(false);
  const [bankQuestions, setBankQuestions] = useState<QuestionListItem[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marksMap, setMarksMap] = useState<Record<string, number | "">>({});
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [adding, setAdding] = useState(false);

  const linkedIds = useRef(new Set(questions.map((q) => q.questionId)));

  const inFlight = useRef(false);

  const fetchData = useCallback(() => {
    if (!institute || !params.assessmentId) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    void Promise.all([
      api<{ assessment: AssessmentResponse }>(`/assessments/${params.assessmentId}`, { signal: ctrl.signal }),
      api<{ questions: AssessmentQuestion[] }>(`/assessments/${params.assessmentId}/questions`, { signal: ctrl.signal }),
    ])
      .then(([a, q]) => {
        if (!inFlight.current) return;
        setAssessment(a.assessment);
        setQuestions(q.questions);
        linkedIds.current = new Set(q.questions.map((item) => item.questionId));
      })
      .catch((err) => {
        if (!inFlight.current) return;
        if (err instanceof ApiError && err.status === 404) {
          setAssessment(null);
        } else if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Failed to load assessment");
        }
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [institute, params.assessmentId]);

  useEffect(() => {
    const cleanup = fetchData();
    return () => cleanup?.();
  }, [fetchData]);

  // Open edit dialog pre-filled
  function openEdit() {
    if (!assessment) return;
    editForm.reset({
      title: assessment.title,
      description: assessment.description ?? undefined,
      durationMinutes: assessment.durationMinutes ?? undefined,
      maxMarks: assessment.maxMarks ?? undefined,
      startsAt: assessment.startsAt?.slice(0, 16) ?? undefined,
      endsAt: assessment.endsAt?.slice(0, 16) ?? undefined,
    });
    setEditOpen(true);
  }

  async function onEdit(values: UpdateAssessmentRequest) {
    if (!assessment) return;
    setEditSubmitting(true);
    try {
      const res = await api<{ assessment: AssessmentResponse }>(`/assessments/${assessment.id}`, {
        method: "PATCH",
        body: {
          ...values,
          durationMinutes: values.durationMinutes ?? null,
          maxMarks: values.maxMarks ?? null,
          startsAt: values.startsAt ?? null,
          endsAt: values.endsAt ?? null,
        },
      });
      setAssessment(res.assessment);
      toast.success("Assessment updated");
      setEditOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update assessment");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function onStatusAction(action: string) {
    if (!assessment) return;
    setWorking(true);
    try {
      const res = await api<{ assessment: AssessmentResponse }>(`/assessments/${assessment.id}/${action}`, { method: "POST" });
      setAssessment(res.assessment);
      toast.success(`Assessment ${action === "publish" ? "published" : action === "activate" ? "activated" : action === "unpublish" ? "unpublished" : "completed"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${action} assessment`);
    } finally {
      setWorking(false);
      setConfirmAction(null);
    }
  }

  async function onDelete() {
    if (!assessment) return;
    setWorking(true);
    try {
      await api(`/assessments/${assessment.id}`, { method: "DELETE" });
      toast.success("Assessment deleted");
      router.push("/assessments");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete assessment");
    } finally {
      setWorking(false);
      setConfirmAction(null);
    }
  }

  // ── Add questions dialog ──

  function openAddDialog() {
    setBankLoading(true);
    setSelectedIds(new Set());
    setMarksMap({});
    setSearch("");
    setTypeFilter("ALL");
    setAddOpen(true);
    api<{ questions: QuestionListItem[] }>("/questions")
      .then(({ questions: qs }) => setBankQuestions(qs))
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Failed to load questions"))
      .finally(() => setBankLoading(false));
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setMarksMap((m) => { const n = { ...m }; delete n[id]; return n; });
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll(visible: QuestionListItem[]) {
    const visibleIds = visible.map((q) => q.id);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
      setMarksMap((m) => {
        const n = { ...m };
        visibleIds.forEach((id) => delete n[id]);
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  const filteredBank = bankQuestions.filter((q) => {
    if (linkedIds.current.has(q.id)) return false;
    if (q.approvalStatus !== "APPROVED") return false;
    if (typeFilter !== "ALL" && q.questionType !== typeFilter) return false;
    if (search && !q.stem.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedCount = filteredBank.filter((q) => selectedIds.has(q.id)).length;

  async function onAddQuestions() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setAdding(true);
    try {
      const marks: Record<string, number> = {};
      ids.forEach((id) => {
        const v = marksMap[id];
        if (v !== undefined && v !== "" && v > 0) marks[id] = Number(v);
      });
      await api(`/assessments/${params.assessmentId}/questions`, {
        method: "POST",
        body: { questionIds: ids, ...(Object.keys(marks).length > 0 ? { marks } : {}) },
      });
      toast.success(`Added ${ids.length} question${ids.length !== 1 ? "s" : ""}`);
      setAddOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add questions");
    } finally {
      setAdding(false);
    }
  }

  async function onRemoveQuestion(questionId: string) {
    setWorking(true);
    try {
      await api(`/assessments/${params.assessmentId}/questions/${questionId}`, { method: "DELETE" });
      toast.success("Question removed");
      fetchData();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove question");
    } finally {
      setWorking(false);
    }
  }

  // ── Render ──

  if (loading) return <PageLoader />;

  if (error) {
    return (
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/assessments"><ArrowLeft className="mr-1 size-4" /> Back</Link>
        </Button>
        <ErrorState description={error} onRetry={() => fetchData()} />
      </div>
    );
  }

  if (!assessment) {
    return (
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/assessments"><ArrowLeft className="mr-1 size-4" /> Back</Link>
        </Button>
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="Assessment not found"
          description="This assessment may have been deleted."
        >
          <Button size="sm" asChild><Link href="/assessments">Back to Assessments</Link></Button>
        </EmptyState>
      </div>
    );
  }

  const editable = assessment.status === "DRAFT" || assessment.status === "PUBLISHED";

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link href="/assessments"><ArrowLeft className="mr-1 size-4" /> Back</Link>
      </Button>

      <PageHeader
        title={assessment.title}
        description={assessment.description ?? undefined}
        actions={
          isTeacher && (
            <div className="flex items-center gap-2">
              {editable && (
                <Button variant="outline" size="sm" onClick={openEdit}>
                  <Pencil className="mr-1 size-3.5" /> Edit
                </Button>
              )}
              {assessment.status === "DRAFT" && (
                <>
                  <Button size="sm" onClick={() => setConfirmAction("publish")} disabled={working}>
                    Publish
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmAction("delete")} disabled={working}>
                    <Trash2 className="mr-1 size-3.5" /> Delete
                  </Button>
                </>
              )}
              {assessment.status === "PUBLISHED" && (
                <>
                  <Button size="sm" onClick={() => setConfirmAction("activate")} disabled={working}>
                    Activate
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmAction("unpublish")} disabled={working}>
                    Unpublish
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmAction("delete")} disabled={working}>
                    <Trash2 className="mr-1 size-3.5" /> Delete
                  </Button>
                </>
              )}
              {assessment.status === "ACTIVE" && (
                <Button size="sm" onClick={() => setConfirmAction("complete")} disabled={working}>
                  Complete
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href={`/assessments/${assessment.id}/results`}>
                  <ClipboardList className="mr-1 size-3.5" /> Results
                </Link>
              </Button>
            </div>
          )
        }
      />

      {/* Status meta */}
      <Card className="mb-6">
        <CardContent className="pt-6 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={assessment.status} />
            {assessment.durationMinutes && <span className="text-muted-foreground">Duration: {formatDuration(assessment.durationMinutes)}</span>}
            {assessment.maxMarks && <span className="text-muted-foreground">Max Marks: {assessment.maxMarks}</span>}
            <span className="text-muted-foreground">Created: {formatDate(assessment.createdAt)}</span>
          </div>
          {scheduleRange(assessment.startsAt, assessment.endsAt) && (
            <p className="mt-1 text-muted-foreground">{scheduleRange(assessment.startsAt, assessment.endsAt)}</p>
          )}
        </CardContent>
      </Card>

      {/* Questions manager */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-base">Questions</CardTitle>
            <CardDescription>{questions.length} question{questions.length !== 1 ? "s" : ""}</CardDescription>
          </div>
          {isTeacher && editable && (
            <Button size="sm" variant="outline" onClick={openAddDialog}>
              <Plus className="mr-1 size-3.5" /> Add Questions
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {questions.length === 0 ? (
            <EmptyState
              icon={<ListOrdered className="size-8" />}
              title="No questions yet"
              description="Add questions from the Question Bank to build this assessment."
            >
              {isTeacher && editable && (
                <Button size="sm" onClick={openAddDialog}>
                  <Plus className="mr-1 size-3.5" /> Add Questions
                </Button>
              )}
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {questions.map(({ id, questionId, sortOrder, marks, question }) => (
                <div key={id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium">
                    {sortOrder}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{question.questionType}</Badge>
                      <span className="text-muted-foreground">{marks} marks</span>
                      <StatusBadge status={question.approvalStatus} />
                    </div>
                    <p className="line-clamp-3 text-muted-foreground">{question.stem}</p>
                  </div>
                  {isTeacher && editable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setRemovingQuestionId(questionId)}
                      disabled={working}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workflow hint */}
      {workflowHint(assessment.status) && (
        <p className="text-sm text-muted-foreground">{workflowHint(assessment.status)}</p>
      )}

      {/* ── Edit dialog ── */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) editForm.reset(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Assessment</DialogTitle>
            <DialogDescription>Update the assessment details.</DialogDescription>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" {...editForm.register("title")} />
              {editForm.formState.errors.title && (
                <p className="text-sm text-destructive">{editForm.formState.errors.title.message}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea id="edit-description" className="resize-none" {...editForm.register("description")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-duration">Duration (minutes)</Label>
                <Input id="edit-duration" type="number" min={1} max={600} placeholder="Optional" {...editForm.register("durationMinutes", { valueAsNumber: true })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-maxMarks">Max Marks</Label>
                <Input id="edit-maxMarks" type="number" min={1} max={10000} placeholder="Optional" {...editForm.register("maxMarks", { valueAsNumber: true })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-startsAt">Starts at</Label>
                <Input
                  id="edit-startsAt"
                  type="datetime-local"
                  {...editForm.register("startsAt", {
                    setValueAs: (v: string) => (v ? new Date(v).toISOString() : undefined),
                  })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-endsAt">Ends at</Label>
                <Input
                  id="edit-endsAt"
                  type="datetime-local"
                  {...editForm.register("endsAt", {
                    setValueAs: (v: string) => (v ? new Date(v).toISOString() : undefined),
                  })}
                />
              </div>
            </div>
            {editForm.formState.errors.startsAt?.message && (
              <p className="text-sm text-destructive">{editForm.formState.errors.startsAt.message}</p>
            )}
            {editForm.formState.errors.root?.message && (
              <p className="text-sm text-destructive">{editForm.formState.errors.root.message}</p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={editSubmitting}>{editSubmitting ? "Saving..." : "Save Changes"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add questions dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Questions</DialogTitle>
            <DialogDescription>Select approved questions from the bank to add to this assessment.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3 py-2">
            <Input
              placeholder="Search questions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t === "ALL" ? "All types" : t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground ml-auto">
              {selectedCount} selected
            </span>
          </div>

          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-1">
            {bankLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading questions...</p>
            ) : filteredBank.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {bankQuestions.length === 0 ? "No questions in the bank." : "No matching questions."}
              </p>
            ) : (
              <>
                <label className="flex items-center gap-3 rounded border px-3 py-2 text-sm font-medium text-muted-foreground cursor-pointer hover:bg-muted/50">
                  <Checkbox
                    checked={filteredBank.length > 0 && filteredBank.every((q) => selectedIds.has(q.id))}
                    onCheckedChange={() => toggleSelectAll(filteredBank)}
                  />
                  Select all ({filteredBank.length})
                </label>
                {filteredBank.map((q) => (
                  <label key={q.id} className="flex items-center gap-3 rounded border px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={selectedIds.has(q.id)}
                      onCheckedChange={() => toggleSelect(q.id)}
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{q.questionType}</Badge>
                      </div>
                      <p className="line-clamp-2 text-muted-foreground">{q.stem}</p>
                    </div>
                    {selectedIds.has(q.id) && (
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Input
                          type="number"
                          min={1}
                          placeholder="Marks"
                          className="w-20"
                          value={marksMap[q.id] ?? ""}
                          onChange={(e) =>
                            setMarksMap((m) => ({
                              ...m,
                              [q.id]: e.target.value === "" ? "" : Number(e.target.value),
                            }))
                          }
                        />
                      </div>
                    )}
                  </label>
                ))}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={onAddQuestions} disabled={adding || selectedCount === 0}>
              {adding ? "Adding..." : `Add ${selectedCount || ""} Question${selectedCount !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm dialogs ── */}
      <ConfirmDialog
        open={confirmAction === "publish"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Publish Assessment"
        description={
          questions.length === 0
            ? "This assessment has no questions. Students will see an empty assessment. Publish anyway?"
            : "Students will be able to see this assessment once activated."
        }
        confirmLabel="Publish"
        loading={working}
        onConfirm={() => onStatusAction("publish")}
      />
      <ConfirmDialog
        open={confirmAction === "activate"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Activate Assessment"
        description="Students will be able to start attempts within the schedule window."
        confirmLabel="Activate"
        loading={working}
        onConfirm={() => onStatusAction("activate")}
      />
      <ConfirmDialog
        open={confirmAction === "unpublish"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Unpublish Assessment"
        description="This will move the assessment back to Draft."
        confirmLabel="Unpublish"
        loading={working}
        onConfirm={() => onStatusAction("unpublish")}
      />
      <ConfirmDialog
        open={confirmAction === "complete"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Complete Assessment"
        description="This will end the assessment. No new attempts will be allowed."
        confirmLabel="Complete"
        loading={working}
        onConfirm={() => onStatusAction("complete")}
      />
      <ConfirmDialog
        open={confirmAction === "delete"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Delete Assessment"
        description="This action cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={working}
        onConfirm={onDelete}
      />
      <ConfirmDialog
        open={!!removingQuestionId}
        onOpenChange={(o) => !o && setRemovingQuestionId(null)}
        title="Remove Question"
        description="Remove this question from the assessment?"
        confirmLabel="Remove"
        destructive
        loading={working}
        onConfirm={() => {
          if (removingQuestionId) onRemoveQuestion(removingQuestionId);
        }}
      />
    </div>
  );
}
