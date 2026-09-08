"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AssessmentResponse, AssessmentQuestion } from "@catlium/contracts";

export default function AssessmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ assessmentId: string }>();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!institute || !params.assessmentId) return;
    const ctrl = new AbortController();
    void Promise.all([
      api<{ assessment: AssessmentResponse }>(`/assessments/${params.assessmentId}`, {
        signal: ctrl.signal,
      }),
      api<{ questions: AssessmentQuestion[] }>(`/assessments/${params.assessmentId}/questions`, {
        signal: ctrl.signal,
      }),
    ])
      .then(([a, q]) => {
        setAssessment(a.assessment);
        setQuestions(q.questions);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          setAssessment(null);
        } else if (error.name !== "AbortError") {
          toast.error(error instanceof ApiError ? error.message : "Failed to load assessment");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.assessmentId]);

  async function onPublish() {
    if (!assessment) return;
    setWorking(true);
    try {
      const res = await api<{ assessment: AssessmentResponse }>(`/assessments/${assessment.id}/publish`, {
        method: "POST",
      });
      setAssessment(res.assessment);
      toast.success("Assessment published");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to publish assessment");
    } finally {
      setWorking(false);
    }
  }

  async function onDelete() {
    if (!assessment) return;
    if (!confirm("Delete this assessment?")) return;
    setWorking(true);
    try {
      await api(`/assessments/${assessment.id}`, { method: "DELETE" });
      toast.success("Assessment deleted");
      router.push("/assessments");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to delete assessment");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!assessment) {
    return (
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/assessments">
            <ArrowLeft className="mr-1 size-4" /> Back
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">Assessment not found.</p>
      </div>
    );
  }

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link href="/assessments">
          <ArrowLeft className="mr-1 size-4" /> Back
        </Link>
      </Button>

      <PageHeader
        title={assessment.title}
        description={assessment.description ?? undefined}
        actions={
          isTeacher &&
          (assessment.status === "DRAFT" ? (
            <Button onClick={onPublish} disabled={working}>
              <Send className="mr-1 size-4" /> Publish
            </Button>
          ) : assessment.status === "PUBLISHED" ? (
            <Button variant="outline" onClick={onDelete} disabled={working}>
              <Trash2 className="mr-1 size-4" /> Delete
            </Button>
          ) : null)
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-6 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={assessment.status} />
            {assessment.durationMinutes && (
              <span className="text-muted-foreground">Duration: {assessment.durationMinutes} min</span>
            )}
            {assessment.maxMarks && (
              <span className="text-muted-foreground">Max Marks: {assessment.maxMarks}</span>
            )}
            <span className="text-muted-foreground">Created: {formatDate(assessment.createdAt)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions in this assessment.</p>
        ) : (
          questions.map(({ question, marks }) => (
            <Card key={question.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{question.questionType}</Badge>
                    <Badge variant="secondary">{marks} marks</Badge>
                    <StatusBadge status={question.approvalStatus} />
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{question.stem}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
