"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Clock, LayoutDashboard, Timer, X } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttemptDetail, StudentQuestionPayload } from "@catlium/contracts";

type DetailQuestion = AttemptDetail["questions"][number];

function choiceList(payload: StudentQuestionPayload): Array<{ id: string; text: string }> {
  const choices = payload.choices;
  return Array.isArray(choices)
    ? (choices as Array<{ id?: string; text?: string }>).filter(
        (c): c is { id: string; text: string } => typeof c.id === "string" && typeof c.text === "string",
      )
    : [];
}

function displayAnswer(question: DetailQuestion): string {
  const answer = question.answer;
  if (question.questionType === "MCQ") {
    const chosen = typeof answer?.choiceId === "string" ? answer.choiceId : null;
    if (!chosen) return "Not answered";
    const label = choiceList(question.payload).find((c) => c.id === chosen);
    return label ? label.text : "Selected option";
  }
  if (question.questionType === "TRUE_FALSE") {
    if (typeof answer?.value !== "boolean") return "Not answered";
    return answer.value ? "True" : "False";
  }
  if (question.questionType === "FILL_IN_BLANK") {
    return typeof answer?.value === "string" && answer.value ? answer.value : "Not answered";
  }
  return "Not answered";
}

export default function AttemptResultPage() {
  const params = useParams<{ attemptId: string }>();
  const { institute } = useTenant();
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!institute || !params.attemptId) return;
    const ctrl = new AbortController();
    api<{ attempt: AttemptDetail }>(`/attempts/${params.attemptId}`, { signal: ctrl.signal })
      .then(({ attempt }) => setAttempt(attempt))
      .catch((error) => {
        if (error instanceof ApiError) toast.error(error.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.attemptId]);

  if (loading) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (!attempt) {
    return <p className="text-muted-foreground">Attempt result not found.</p>;
  }

  const answered = attempt.questions.filter((q) => q.answer != null).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Attempt result</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/student/dashboard">
            <LayoutDashboard className="mr-1 size-4" /> Dashboard
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {attempt.status === "SUBMITTED" ? (
              <Badge className="bg-emerald-600">Submitted</Badge>
            ) : (
              <Badge variant="secondary">{attempt.status}</Badge>
            )}
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="size-4" /> {answered} of {attempt.questions.length} answered
            </span>
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Timer className="size-4" /> Submitted {formatDateTime(attempt.submittedAt)}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {attempt.score === null ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              Scoring is not available yet — results will appear here after evaluation.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-lg font-semibold">
                {attempt.score} / {attempt.totalMarks}
              </span>
              <span className="text-muted-foreground">marks</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {attempt.questions.map((question, i) => {
          const isAnswered = question.answer != null;
          return (
            <Card key={question.attemptQuestionId}>
              <CardContent className="p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Question {i + 1}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium">
                    {isAnswered ? (
                      <Check className="size-3.5 text-emerald-600" />
                    ) : (
                      <X className="size-3.5 text-destructive" />
                    )}
                    {isAnswered ? "Answered" : "Not answered"}
                  </span>
                </div>
                <p className="mb-3 text-sm leading-relaxed">{question.stem}</p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Your answer: </span>
                  <span className="font-medium">{displayAnswer(question)}</span>
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}