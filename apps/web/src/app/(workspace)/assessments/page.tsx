"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { SkeletonRows } from "@/components/app/loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { AssessmentListItem, CreateAssessmentRequest, AssessmentResponse } from "@catlium/contracts";
import { CreateAssessmentRequestSchema } from "@catlium/contracts";

function scheduleRange(startsAt?: string | null, endsAt?: string | null): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (v: string) =>
    new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  if (startsAt) return `From ${fmt(startsAt)}`;
  return `Until ${fmt(endsAt!)}`;
}

export default function AssessmentsListPage() {
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateAssessmentRequest>({
    resolver: zodResolver(CreateAssessmentRequestSchema),
    defaultValues: { title: "", description: "" },
  });

  const fetchAssessments = () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api<{ assessments: AssessmentListItem[] }>("/assessments", { signal: ctrl.signal })
      .then(({ assessments }) => setAssessments(assessments))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  };

  useEffect(() => {
    const cleanup = fetchAssessments();
    return () => cleanup?.();
  }, [institute]);

  async function onCreate(values: CreateAssessmentRequest) {
    setSubmitting(true);
    try {
      const { assessment } = await api<{ assessment: AssessmentResponse }>("/assessments", {
        method: "POST",
        body: {
          ...values,
          durationMinutes: values.durationMinutes || undefined,
          maxMarks: values.maxMarks || undefined,
          startsAt: values.startsAt || undefined,
          endsAt: values.endsAt || undefined,
        },
      });
      toast.success("Assessment created");
      setDialogOpen(false);
      form.reset();
      router.push(`/assessments/${assessment.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create assessment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Assessments"
        description={`${assessments.length} assessment${assessments.length !== 1 ? "s" : ""}`}
        actions={
          isTeacher && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 size-3.5" /> New Assessment
            </Button>
          )
        }
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) form.reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Assessment</DialogTitle>
            <DialogDescription>Create a new assessment to configure and publish.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" placeholder="Assessment title" {...form.register("title")} />
              {form.formState.errors.title && (
                <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" placeholder="Optional description" className="resize-none" {...form.register("description")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="durationMinutes">Duration (minutes)</Label>
                <Input id="durationMinutes" type="number" min={1} max={600} placeholder="Optional" {...form.register("durationMinutes", { valueAsNumber: true })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="maxMarks">Max Marks</Label>
                <Input id="maxMarks" type="number" min={1} max={10000} placeholder="Optional" {...form.register("maxMarks", { valueAsNumber: true })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="startsAt">Starts at</Label>
                <Input
                  id="startsAt"
                  type="datetime-local"
                  {...form.register("startsAt", {
                    setValueAs: (v: string) => (v ? new Date(v).toISOString() : undefined),
                  })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="endsAt">Ends at</Label>
                <Input
                  id="endsAt"
                  type="datetime-local"
                  {...form.register("endsAt", {
                    setValueAs: (v: string) => (v ? new Date(v).toISOString() : undefined),
                  })}
                />
              </div>
            </div>
            {form.formState.errors.startsAt?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.startsAt.message}</p>
            )}
            {form.formState.errors.root?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loading ? (
        <SkeletonRows />
      ) : error ? (
        <ErrorState onRetry={() => fetchAssessments()} description={error} />
      ) : assessments.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="No assessments yet"
          description="Create your first assessment to get started."
        >
          {isTeacher && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 size-3.5" /> New Assessment
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {assessments.map((a) => (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  <Link href={`/assessments/${a.id}`} className="hover:underline">
                    {a.title}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={a.status} />
                  <span className="text-muted-foreground">{a.questionCount} question{a.questionCount !== 1 ? "s" : ""}</span>
                  {a.durationMinutes && <span className="text-muted-foreground">{formatDuration(a.durationMinutes)}</span>}
                  {a.maxMarks && <span className="text-muted-foreground">{a.maxMarks} marks</span>}
                </div>
                {scheduleRange(a.startsAt, a.endsAt) && (
                  <p className="text-muted-foreground">{scheduleRange(a.startsAt, a.endsAt)}</p>
                )}
                <p className="text-muted-foreground">{formatDate(a.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
