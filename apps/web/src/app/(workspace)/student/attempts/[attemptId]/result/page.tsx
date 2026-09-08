"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, LayoutDashboard, Timer, X } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttemptResult, AttemptResultQuestion, StudentQuestionPayload } from "@catlium/contracts";

function choiceList(payload: StudentQuestionPayload): Array<{ id: string; text: string }> {
  const choices = payload.choices;
  return Array.isArray(choices)
    ? (choices as Array<{ id?: string; text?: string }>).filter(
        (c): c is { id: string; text: string } => typeof c.id === "string" && typeof c.text === "string",
      )
    : [];
}

function displayMcq(payload: StudentQuestionPayload, choiceId: unknown): string {
  if (typeof choiceId !== "string" || !choiceId) return "Not answered";
  const label = choiceList(payload).find((c) => c.id === choiceId);
  return label ? label.text : "Selected option";
}

function answerLabel(question: AttemptResultQuestion): string {
  const answer = question.answer;
  if (question.questionType === "MCQ") return displayMcq(question.payload, answer?.choiceId);
  if (question.questionType === "TRUE_FALSE") {
    return typeof answer?.value === "boolean" ? (answer.value ? "True" : "False") : "Not answered";
  }
  return typeof answer?.value === "string" && answer.value ? answer.value : "Not answered";
}

function correctLabel(question: AttemptResultQuestion): string {
  const correct = question.correctAnswer;
  if (question.questionType === "MCQ") return displayMcq(question.payload, correct?.choiceId);
  if (question.questionType === "TRUE_FALSE") {
    return typeof correct?.value === "boolean" ? (correct.value ? "True" : "False") : "—";
  }
  return typeof correct?.value === "string" ? correct.value : "—";
}

export default function AttemptResultPage() {
  const params = useParams<{ attemptId: string }>();
  const { institute } = useTenant();
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!institute || !params.attemptId) return;
    const ctrl = new AbortController();
    api<{ result: AttemptResult }>(`/attempts/${params.attemptId}/result`, { signal: ctrl.signal })
      .then(({ result }) => setResult(result))
      .catch((error) => {
        if (error instanceof ApiError) toast.error(error.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.attemptId]);

  if (loading) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (!result) {
    return <p className="text-muted-foreground">Attempt result not found.</p>;
  }

  const correctCount = result.questions.filter((q) => q.isCorrect).length;

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
            {result.status === "SUBMITTED" ? (
              <Badge className="bg-emerald-600">Submitted</Badge>
            ) : (
              <Badge variant="secondary">{result.status}</Badge>
            )}
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="size-4" /> {correctCount} of {result.questions.length} correct
            </span>
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Timer className="size-4" /> Submitted {formatDateTime(result.submittedAt)}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold">
              {result.score ?? 0} / {result.totalMarks ?? 0}
            </span>
            <span className="text-sm text-muted-foreground">marks</span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {result.questions.map((question, i) => (
          <Card key={question.attemptQuestionId}>
            <CardContent className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Question {i + 1} · {question.marks} mark{question.marks === 1 ? "" : "s"}
                </span>
                <span
                  className={`flex items-center gap-1 text-xs font-medium ${
                    question.isCorrect ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {question.isCorrect ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  {question.isCorrect ? `Correct · +${question.marksAwarded}` : `Incorrect · 0/${question.marks}`}
                </span>
              </div>
              <p className="mb-3 text-sm leading-relaxed">{question.stem}</p>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Your answer: </span>
                  <span className="font-medium">{answerLabel(question)}</span>
                </p>
                {!question.isCorrect && (
                  <p>
                    <span className="text-muted-foreground">Correct answer: </span>
                    <span className="font-medium text-emerald-600">{correctLabel(question)}</span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}