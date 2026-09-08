"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AssessmentListItem, CreateAssessmentRequest, AssessmentResponse } from "@catlium/contracts";
import { CreateAssessmentRequestSchema } from "@catlium/contracts";

export default function AssessmentsListPage() {
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateAssessmentRequest>({
    resolver: zodResolver(CreateAssessmentRequestSchema),
    defaultValues: { title: "", description: "" },
  });

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ assessments: AssessmentListItem[] }>("/assessments", { signal: ctrl.signal })
      .then(({ assessments }) => setAssessments(assessments))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  async function onCreate(values: CreateAssessmentRequest) {
    if (!institute) return;
    setSubmitting(true);
    try {
      const { assessment } = await api<{ assessment: AssessmentResponse }>("/assessments", {
        method: "POST",
        body: {
          ...values,
          durationMinutes: values.durationMinutes ?? undefined,
          maxMarks: values.maxMarks ?? undefined,
        },
      });
      toast.success("Assessment created");
      setCreating(false);
      form.reset();
      router.push(`/assessments/${assessment.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to create assessment");
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
            <Button size="sm" onClick={() => setCreating((v) => !v)}>
              <Plus className="mr-1 size-3.5" /> New Assessment
            </Button>
          )
        }
      />

      {creating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New Assessment</CardTitle>
          </CardHeader>
          <CardContent>
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
                <Textarea
                  id="description"
                  placeholder="Optional description"
                  className="resize-none"
                  {...form.register("description")}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="durationMinutes">Duration (minutes)</Label>
                  <Input
                    id="durationMinutes"
                    type="number"
                    min={1}
                    max={600}
                    placeholder="Optional"
                    {...form.register("durationMinutes", { valueAsNumber: true })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxMarks">Max Marks</Label>
                  <Input
                    id="maxMarks"
                    type="number"
                    min={1}
                    max={10000}
                    placeholder="Optional"
                    {...form.register("maxMarks", { valueAsNumber: true })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : assessments.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="No assessments yet"
          description="Create your first assessment to get started."
        />
      ) : (
        <div className="space-y-4">
          {assessments.map((assessment) => (
            <Card key={assessment.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link href={`/assessments/${assessment.id}`} className="hover:underline">
                    {assessment.title}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={assessment.status} />
                  <span className="text-muted-foreground">{assessment.questionCount} questions</span>
                  {assessment.durationMinutes && (
                    <span className="text-muted-foreground">{assessment.durationMinutes} min</span>
                  )}
                  {assessment.maxMarks && (
                    <span className="text-muted-foreground">{assessment.maxMarks} marks</span>
                  )}
                </div>
                <p className="text-muted-foreground">{formatDate(assessment.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
