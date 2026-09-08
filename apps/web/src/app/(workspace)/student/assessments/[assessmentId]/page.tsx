"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Gauge, ListChecks, Play } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { AvailableAssessment, AttemptDetail } from "@catlium/contracts";

export default function AssessmentIntroPage() {
  const router = useRouter();
  const params = useParams<{ assessmentId: string }>();
  const { institute } = useTenant();
  const [assessment, setAssessment] = useState<AvailableAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!institute || !params.assessmentId) return;
    const ctrl = new AbortController();
    api<{ assessments: AvailableAssessment[] }>("/attempts/available", { signal: ctrl.signal })
      .then(({ assessments }) => {
        const found = assessments.find((a) => a.id === params.assessmentId);
        setAssessment(found ?? null);
      })
      .catch((error) => {
        if (error instanceof ApiError) toast.error(error.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.assessmentId]);

  async function onStart() {
    if (!institute || !params.assessmentId) return;
    setStarting(true);
    try {
      const res = await api<{ attempt: AttemptDetail }>("/attempts", {
        method: "POST",
        body: { assessmentId: params.assessmentId },
      });
      router.push(`/student/attempts/${res.attempt.id}`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to start";
      if (error instanceof ApiError && error.status === 409) {
        toast.warning(message, { description: "Resume from the attempt page if you still have it open." });
      } else {
        toast.error(message);
      }
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (!assessment) {
    return (
      <EmptyState
        icon={<ListChecks className="size-8" />}
        title="Assessment not available"
        description="This assessment is outside its schedule window or was not found."
      >
        <Button size="sm" asChild>
          <Link href="/student/dashboard">Back to dashboard</Link>
        </Button>
      </EmptyState>
    );
  }

  const instructions = assessment.instructions as { text?: string } | null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/student/dashboard">
          <ArrowLeft className="mr-1 size-4" /> Back
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-xl">{assessment.title}</CardTitle>
            <Badge variant="secondary">{assessment.status}</Badge>
          </div>
          {assessment.description ? (
            <p className="text-sm text-muted-foreground">{assessment.description}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-4" /> {assessment.questionCount} questions
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-4" /> {assessment.durationMinutes ?? "—"} minutes
            </span>
            <span className="inline-flex items-center gap-1">
              <Gauge className="size-4" /> {assessment.maxMarks ?? "—"} marks
            </span>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Opens {formatDateTime(assessment.startsAt)} · Closes {formatDateTime(assessment.endsAt)}
            </p>
          </div>

          {instructions?.text ? (
            <>
              <Separator />
              <div>
                <h2 className="mb-1 text-sm font-medium">Instructions</h2>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{instructions.text}</p>
              </div>
            </>
          ) : null}

          <Alert>
            <AlertTitle>Before you start</AlertTitle>
            <AlertDescription>
              The clock starts when you begin and the deadline is enforced by the server. Your answers are
              saved automatically as you go.
            </AlertDescription>
          </Alert>

          <Button className="w-full" onClick={onStart} disabled={starting}>
            <Play className="mr-1 size-4" />
            {starting ? "Starting…" : "Start attempt"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}