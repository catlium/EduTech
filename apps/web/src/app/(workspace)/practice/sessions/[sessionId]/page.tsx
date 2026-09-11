"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Eye, Pencil, RotateCcw, X } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import type { PracticeSessionDetail, PracticeSessionItem } from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SkeletonRows } from "@/components/app/loading";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Item = PracticeSessionItem & {
  payload?: { choices?: Array<{ id: string; text: string }>; [key: string]: unknown };
};

type Answer = { choiceId?: string; value?: boolean | string };

function choiceList(item: Item): Array<{ id: string; text: string }> {
  const choices = item.payload?.choices;
  return Array.isArray(choices)
    ? choices.filter(
        (c): c is { id: string; text: string } => typeof c?.id === "string" && typeof c?.text === "string",
      )
    : [];
}

function answerText(item: Item): string {
  const a = item.answer as Answer | undefined;
  if (!a) return "Not answered";
  if (item.questionType === "MCQ") {
    const label = choiceList(item).find((c) => c.id === a.choiceId);
    return label ? label.text : "Selected option";
  }
  if (item.questionType === "TRUE_FALSE") {
    return typeof a.value === "boolean" ? (a.value ? "True" : "False") : "Not answered";
  }
  return typeof a.value === "string" && a.value ? a.value : "Not answered";
}

function revealText(item: Item): string {
  if (!item.reveal) return "—";
  let parsed: Answer;
  try {
    parsed = JSON.parse(item.reveal) as Answer;
  } catch {
    return item.reveal;
  }
  if (item.questionType === "MCQ") {
    const label = choiceList(item).find((c) => c.id === parsed.choiceId);
    return label ? label.text : "Selected option";
  }
  if (item.questionType === "TRUE_FALSE") {
    return typeof parsed.value === "boolean" ? (parsed.value ? "True" : "False") : "—";
  }
  return typeof parsed.value === "string" ? parsed.value : "—";
}

function AnsweredFeedback({ item }: { item: Item }) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="text-muted-foreground">Your answer: </span>
        <span className="font-medium">{answerText(item)}</span>
      </p>
      <p>
        <span className="text-muted-foreground">Correct answer: </span>
        <span className="font-medium text-emerald-600">{revealText(item)}</span>
      </p>
      {item.explanation && (
        <p className="rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Explanation
          </span>
          {item.explanation}
        </p>
      )}
    </div>
  );
}

function ReviewCard({ item, index }: { item: Item; index: number }) {
  const isQuestion = !!item.questionType;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {isQuestion ? `Question ${index + 1}` : `Card ${index + 1}`}
          </span>
          {isQuestion ? (
            item.isCorrect !== undefined ? (
              <span
                className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  item.isCorrect ? "text-emerald-600" : "text-destructive",
                )}
              >
                {item.isCorrect ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                {item.isCorrect ? "Correct" : "Incorrect"}
              </span>
            ) : (
              <span className="text-xs font-medium text-muted-foreground">Not answered</span>
            )
          ) : item.rating ? (
            <Badge variant={item.rating === "GOOD" ? "default" : "secondary"}>{item.rating}</Badge>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed">{item.prompt}</p>
        {isQuestion ? (
          item.isCorrect !== undefined ? (
            <AnsweredFeedback item={item} />
          ) : (
            <p className="text-sm text-muted-foreground">Not answered</p>
          )
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{item.reveal}</p>
        )}
      </CardContent>
    </Card>
  );
}

function FlashcardItem({
  item,
  flipped,
  saving,
  onFlip,
  onRate,
}: {
  item: Item;
  flipped: boolean;
  saving: boolean;
  onFlip: () => void;
  onRate: (rating: "AGAIN" | "GOOD") => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {flipped ? "Back" : "Front"}
          </span>
          {item.rating && (
            <Badge variant={item.rating === "GOOD" ? "default" : "secondary"}>{item.rating}</Badge>
          )}
        </div>
        <p className="text-sm leading-relaxed">{flipped ? item.reveal : item.prompt}</p>
        {!flipped ? (
          <Button size="sm" variant="outline" onClick={onFlip}>
            <Eye className="mr-1 size-3.5" /> Show answer
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => onRate("AGAIN")}>
              <RotateCcw className="mr-1 size-3.5" /> Again
            </Button>
            <Button size="sm" disabled={saving} onClick={() => onRate("GOOD")}>
              <Check className="mr-1 size-3.5" /> Good
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function McqChoices({
  item,
  answering,
  onAnswer,
}: {
  item: Item;
  answering: boolean;
  onAnswer: (a: Answer) => void;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {choiceList(item).map((c, i) => (
          <button
            key={c.id}
            type="button"
            disabled={answering}
            onClick={() => setSelected(c.id)}
            className={cn(
              "w-full rounded-md border p-3 text-left text-sm",
              selected === c.id && "border-primary bg-primary/5",
              answering && "opacity-60",
            )}
          >
            <span className="mr-1 text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
            {c.text}
          </button>
        ))}
      </div>
      <Button size="sm" disabled={!selected || answering} onClick={() => onAnswer({ choiceId: selected })}>
        {answering ? "Saving…" : "Answer"}
      </Button>
    </div>
  );
}

function TrueFalseChoices({
  answering,
  onAnswer,
}: {
  answering: boolean;
  onAnswer: (a: Answer) => void;
}) {
  const [value, setValue] = useState<boolean | null>(null);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={answering}
          onClick={() => setValue(true)}
          className={cn(
            "rounded-md border p-3 text-sm",
            value === true && "border-primary bg-primary/5",
            answering && "opacity-60",
          )}
        >
          True
        </button>
        <button
          type="button"
          disabled={answering}
          onClick={() => setValue(false)}
          className={cn(
            "rounded-md border p-3 text-sm",
            value === false && "border-primary bg-primary/5",
            answering && "opacity-60",
          )}
        >
          False
        </button>
      </div>
      <Button
        size="sm"
        disabled={value === null || answering}
        onClick={() => value !== null && onAnswer({ value })}
      >
        {answering ? "Saving…" : "Answer"}
      </Button>
    </div>
  );
}

function FillBlankInput({
  answering,
  onAnswer,
}: {
  answering: boolean;
  onAnswer: (a: Answer) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label>Your answer</Label>
        <Input
          value={draft}
          placeholder="Type your answer…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft && !answering) onAnswer({ value: draft });
          }}
        />
      </div>
      <Button
        size="sm"
        disabled={!draft.trim() || answering}
        onClick={() => onAnswer({ value: draft })}
      >
        {answering ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

function QuestionAnswerer({
  item,
  answering,
  onAnswer,
}: {
  item: Item;
  answering: boolean;
  onAnswer: (a: Answer) => void;
}) {
  if (item.questionType === "MCQ") return <McqChoices item={item} answering={answering} onAnswer={onAnswer} />;
  if (item.questionType === "TRUE_FALSE")
    return <TrueFalseChoices answering={answering} onAnswer={onAnswer} />;
  return <FillBlankInput answering={answering} onAnswer={onAnswer} />;
}

export default function PracticeSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const { institute } = useTenant();

  const [session, setSession] = useState<PracticeSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!institute || !params.sessionId) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api<{ session: PracticeSessionDetail }>(`/practice/sessions/${params.sessionId}`, {
      signal: ctrl.signal,
    })
      .then(({ session }) => setSession(session))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError && err.status === 404) {
          setError("notfound");
        } else {
          setError(err instanceof ApiError ? err.message : "Failed to load session");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.sessionId]);

  useEffect(() => {
    return load();
  }, [load]);

  const items = session?.items ?? [];
  const answeredCount = items.filter((i) => i.rating !== undefined || i.answer !== undefined).length;
  const correctCount = items.filter((i) => i.isCorrect === true).length;
  const current = items[index];
  const isFlashcard = session?.mode === "FLASHCARD";

  function replaceItem(updated: Item) {
    setSession((prev) =>
      prev ? { ...prev, items: prev.items.map((i) => (i.id === updated.id ? updated : i)) } : prev,
    );
  }

  async function rate(itemId: string, rating: "AGAIN" | "GOOD", advance: () => void) {
    setSaving(itemId);
    try {
      const { item } = await api<{ item: Item }>(
        `/practice/sessions/${params.sessionId}/items/${itemId}`,
        { method: "PUT", body: { rating } },
      );
      replaceItem(item);
      setCardFlipped(false);
      advance();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save rating");
    } finally {
      setSaving(null);
    }
  }

  async function answer(itemId: string, answer: Answer) {
    setSaving(itemId);
    try {
      const { item } = await api<{ item: Item }>(
        `/practice/sessions/${params.sessionId}/items/${itemId}`,
        { method: "PUT", body: { answer } },
      );
      replaceItem(item);
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save answer");
    } finally {
      setSaving(null);
    }
  }

  async function completeSession() {
    setCompleting(true);
    try {
      await api(`/practice/sessions/${params.sessionId}/complete`, { method: "POST" });
      setConfirmOpen(false);
      setSession(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to complete session");
    } finally {
      setCompleting(false);
    }
  }

  function toggleFlip() {
    setCardFlipped((f) => !f);
  }

  if (!institute) return null;

  if (loading) {
    return (
      <div>
        <PageHeader title="Practice" />
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (error === "notfound") {
    return (
      <div>
        <PageHeader title="Practice" />
        <EmptyState
          icon={<X className="size-8" />}
          title="Practice session not found"
          description="This session may have been removed or you don't have access to it."
        >
          <Button size="sm" asChild>
            <Link href="/practice">Back to Practice</Link>
          </Button>
        </EmptyState>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div>
        <PageHeader title="Practice" />
        <ErrorState description={error ?? "Failed to load session"} onRetry={load} />
      </div>
    );
  }

  const allAnswered = answeredCount === items.length && items.length > 0;
  const completed = session.status === "COMPLETED";

  return (
    <div>
      <PageHeader
        title={isFlashcard ? "Flashcard practice" : "Question practice"}
        description={
          session.completedAt
            ? `Completed on ${new Date(session.completedAt).toLocaleString()}`
            : `${answeredCount} of ${items.length} answered · ${correctCount} correct`
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/practice">
              <ArrowLeft className="mr-1 size-3.5" /> Back to practice
            </Link>
          </Button>
        }
      />

      {completed ? (
        <div className="space-y-3">
          <StatusBadge status={session.status} />
          {items.map((item, i) => (
            <ReviewCard key={item.id} item={item} index={i} />
          ))}
        </div>
      ) : isFlashcard ? (
        <div className="mx-auto max-w-xl space-y-4">
          <StatusBadge status={session.status} />
          {items.length === 0 ? (
            <EmptyState
              title="No cards in this session"
              description="This flashcard set appears to be empty. Complete the session to clear it."
            >
              <Button size="sm" onClick={() => setConfirmOpen(true)}>
                Complete session
              </Button>
            </EmptyState>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => {
                    setIndex((i) => i - 1);
                    setCardFlipped(false);
                  }}
                >
                  <ArrowLeft className="mr-1 size-4" /> Previous
                </Button>
                <span className="flex-1 text-center text-xs uppercase tracking-wide text-muted-foreground">
                  Card {index + 1} of {items.length} · {answeredCount} rated
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={index === items.length - 1}
                  onClick={() => {
                    setIndex((i) => i + 1);
                    setCardFlipped(false);
                  }}
                >
                  Next <ArrowRight className="ml-1 size-4" />
                </Button>
              </div>
              <FlashcardItem
                item={items[index]}
                flipped={cardFlipped}
                saving={saving === items[index].id}
                onFlip={toggleFlip}
                onRate={(rating) =>
                  void rate(
                    items[index].id,
                    rating,
                    () => index < items.length - 1 && setIndex((i) => i + 1),
                  )
                }
              />
              {allAnswered && (
                <Button className="w-full" onClick={() => setConfirmOpen(true)}>
                  Complete session
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
          <Card>
            <CardContent className="space-y-5 p-6">
              {!current ? (
                <div className="space-y-4 py-4 text-center">
                  <p className="text-sm text-muted-foreground">No questions in this session.</p>
                  <Button size="sm" onClick={() => setConfirmOpen(true)}>
                    Complete session
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Question {index + 1} of {items.length}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {answeredCount} answered
                    </span>
                  </div>
                  <p className="text-base leading-relaxed">{current.prompt}</p>
                  {current.answer !== undefined && editingId !== current.id ? (
                    <div className="space-y-3">
                      <AnsweredFeedback item={current} />
                      <Button size="sm" variant="outline" onClick={() => setEditingId(current.id)}>
                        <Pencil className="mr-1 size-3.5" /> Change answer
                      </Button>
                    </div>
                  ) : (
                    <QuestionAnswerer
                      key={editingId === current.id ? `editing-${current.id}` : current.id}
                      item={current}
                      answering={saving === current.id}
                      onAnswer={(a) => void answer(current.id, a)}
                    />
                  )}
                  <div className="flex items-center justify-between border-t pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => setIndex((i) => i - 1)}
                    >
                      <ArrowLeft className="mr-1 size-4" /> Previous
                    </Button>
                    {saving === current.id && (
                      <span className="text-xs text-muted-foreground">Saving…</span>
                    )}
                    {index < items.length - 1 ? (
                      <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                        Next <ArrowRight className="ml-1 size-4" />
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardContent className="p-4">
                <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Navigator
                </span>
                <div className="grid grid-cols-5 gap-2">
                  {items.map((q, i) => {
                    const answered = q.answer !== undefined;
                    return (
                      <button
                        key={q.id}
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

            {items.length > 0 && (
              <Button className="w-full" onClick={() => setConfirmOpen(true)}>
                Complete session
              </Button>
            )}
            {allAnswered && (
              <p className="text-center text-xs text-muted-foreground">
                All items answered — you can complete the session.
              </p>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Complete this session?"
        description={
          allAnswered
            ? "All items are answered. Completing closes the session and shows your review."
            : `${items.length - answeredCount} item(s) unanswered. You can complete now or keep practicing — completed sessions are read-only.`
        }
        confirmLabel={completing ? "Completing…" : "Complete"}
        loading={completing}
        onConfirm={() => void completeSession()}
      />
    </div>
  );
}