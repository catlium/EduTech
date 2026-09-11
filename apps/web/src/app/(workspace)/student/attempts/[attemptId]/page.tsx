"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Timer, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  AttemptDetail,
  StudentAttemptQuestion,
  StudentQuestionPayload,
} from "@catlium/contracts";

type Answer = Record<string, unknown>;

function choiceList(payload: StudentQuestionPayload): Array<{ id: string; text: string }> {
  const choices = payload.choices;
  return Array.isArray(choices)
    ? (choices as Array<{ id?: string; text?: string }>).filter(
        (c): c is { id: string; text: string } => typeof c.id === "string" && typeof c.text === "string",
      )
    : [];
}

function mmss(ms: number): string {
  if (ms < 0) return "00:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function AttemptPlayerPage() {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  const { institute } = useTenant();
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer | null>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!institute || !params.attemptId) return;
    const ctrl = new AbortController();
    api<{ attempt: AttemptDetail }>(`/attempts/${params.attemptId}`, { signal: ctrl.signal })
      .then(({ attempt }) => {
        setAttempt(attempt);
        if (attempt.status !== "IN_PROGRESS") {
          router.replace(`/student/attempts/${attempt.id}/result`);
          return;
        }
        const map: Record<string, Answer | null> = {};
        for (const q of attempt.questions) map[q.attemptQuestionId] = q.answer;
        setAnswers(map);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof ApiError && error.status === 404) {
          setLoadError("not-found");
        } else {
          setLoadError(error instanceof ApiError ? error.message : "Failed to load attempt");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.attemptId, router]);

  const deadline = attempt?.deadline ? new Date(attempt.deadline).getTime() : null;
  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const ms = deadline - Date.now();
      setRemaining(ms);
      if (ms <= 0 && !submittedRef.current) {
        submittedRef.current = true;
        void doSubmit();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  const questions = attempt?.questions ?? [];
  const question = questions[index];

  async function saveAnswer(aqId: string, answer: Answer) {
    if (!institute || submittedRef.current) return;
    setAnswers((prev) => ({ ...prev, [aqId]: answer }));
    setSaving(true);
    try {
      await api(`/attempts/${params.attemptId}/questions/${aqId}`, { method: "PUT", body: { answer } });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to save answer");
    } finally {
      setSaving(false);
    }
  }

  async function doSubmit() {
    if (submitting || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await api(`/attempts/${params.attemptId}/submit`, { method: "POST" });
      router.replace(`/student/attempts/${params.attemptId}/result`);
    } catch (error) {
      submittedRef.current = false;
      setSubmitting(false);
      toast.error(error instanceof ApiError ? error.message : "Failed to submit attempt");
    }
  }

  const answeredCount = useMemo(
    () => Object.values(answers).filter((a) => a !== null && a !== undefined).length,
    [answers],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardContent className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadError === "not-found") {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <AlertTriangle className="mx-auto size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Attempt not found</p>
            <p className="text-xs text-muted-foreground">
              This attempt may have been removed, or you may not have access.
            </p>
            <Button size="sm" asChild>
              <Link href="/student/exams">Back to exams</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!attempt || !question) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Attempt not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const low = remaining !== null && remaining <= 60_000;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Attempt in progress</h1>
        <div
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm font-medium tabular-nums",
            low ? "border-destructive text-destructive" : "border-border",
          )}
        >
          <Timer className="size-4" />
          {remaining === null ? "No time limit" : mmss(remaining)}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Question {index + 1} of {questions.length}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium">
                <Check className="size-3.5" /> {answeredCount} answered
              </span>
            </div>

            <div>
              <p className="text-base leading-relaxed">{question.stem}</p>
            </div>

            <QuestionAnswerer
              question={question}
              value={answers[question.attemptQuestionId] ?? null}
              onChange={(answer) => void saveAnswer(question.attemptQuestionId, answer)}
            />

            <div className="flex items-center justify-between border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={index === 0}
                onClick={() => setIndex((i) => i - 1)}
              >
                <ArrowLeft className="mr-1 size-4" /> Previous
              </Button>
              <div className="flex items-center gap-2">
                {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
                {index < questions.length - 1 ? (
                  <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                    Next <ArrowRight className="ml-1 size-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Question navigator
              </span>
              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, i) => {
                  const answered = answers[q.attemptQuestionId] != null;
                  return (
                    <button
                      key={q.attemptQuestionId}
                      type="button"
                      onClick={() => setIndex(i)}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-md border text-sm",
                        i === index
                          ? "border-primary bg-primary text-primary-foreground"
                          : answered
                            ? "border-primary/40 text-primary"
                            : "text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm border border-primary/40" /> answered
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm border" /> unanswered
                </span>
              </div>
            </CardContent>
          </Card>

          <Dialog>
            <DialogTrigger asChild>
              <Button className="w-full" variant="destructive" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit attempt"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Submit your attempt?</DialogTitle>
                <DialogDescription>
                  {answeredCount === questions.length
                    ? "All questions answered. You can still change answers before submitting."
                    : `${questions.length - answeredCount} question(s) left unanswered. You can still change answers before submitting.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={() => void doSubmit()} disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit now"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {low ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          Less than a minute left — the attempt will be submitted automatically.
        </div>
      ) : null}
    </div>
  );
}

function QuestionAnswerer({
  question,
  value,
  onChange,
}: {
  question: StudentAttemptQuestion;
  value: Answer | null;
  onChange: (answer: Answer) => void;
}) {
  const { questionType, payload } = question;

  if (questionType === "MCQ") {
    const selected = typeof value?.choiceId === "string" ? value.choiceId : undefined;
    return (
      <RadioGroup value={selected} onValueChange={(choiceId) => onChange({ choiceId })} className="gap-3">
        {choiceList(payload).map((choice, i) => (
          <div key={choice.id} className="flex items-center gap-3 rounded-md border p-3">
            <RadioGroupItem id={`mc-${choice.id}`} value={choice.id} />
            <Label htmlFor={`mc-${choice.id}`} className="font-normal">
              <span className="mr-1 text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
              {choice.text}
            </Label>
          </div>
        ))}
      </RadioGroup>
    );
  }

  if (questionType === "TRUE_FALSE") {
    const selected = typeof value?.value === "boolean" ? String(value.value) : undefined;
    return (
      <RadioGroup
        value={selected}
        onValueChange={(v) => onChange({ value: v === "true" })}
        className="gap-3"
      >
        {[
          { label: "True", val: "true" },
          { label: "False", val: "false" },
        ].map((opt) => (
          <div key={opt.val} className="flex items-center gap-3 rounded-md border p-3">
            <RadioGroupItem id={`tf-${opt.val}`} value={opt.val} />
            <Label htmlFor={`tf-${opt.val}`} className="font-normal">
              {opt.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    );
  }

  const text = typeof value?.value === "string" ? value.value : "";
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft !== text) onChange({ value: draft });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <div className="space-y-2">
      <Label>Your answer</Label>
      <Input
        value={draft}
        placeholder="Type your answer…"
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  );
}