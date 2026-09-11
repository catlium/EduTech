"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarClock, ClipboardList, History, Play, RotateCcw, Trophy } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCards } from "@/components/app/loading";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import type { AttemptHistoryItem, AvailableAssessment } from "@catlium/contracts";

type AttemptStatus = AttemptHistoryItem["status"];

function statusAction(a: AttemptHistoryItem): { label: string; href: string } {
  if (a.status === "IN_PROGRESS") return { label: "Continue", href: `/student/attempts/${a.id}` };
  if (a.status === "SUBMITTED" || a.status === "EXPIRED") return { label: "View result", href: `/student/attempts/${a.id}/result` };
  return { label: "Continue", href: `/student/attempts/${a.id}` };
}

export default function StudentExamsPage() {
  const { institute } = useTenant();
  const [open, setOpen] = useState<AvailableAssessment[]>([]);
  const [history, setHistory] = useState<AttemptHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    Promise.all([
      api<{ assessments: AvailableAssessment[] }>("/attempts/available", { signal: ctrl.signal }),
      api<{ attempts: AttemptHistoryItem[] }>("/attempts", { signal: ctrl.signal }),
    ])
      .then(([avail, mine]) => {
        setOpen(avail.assessments);
        setHistory(mine.attempts);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Failed to load exams");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  if (!institute) return null;

  if (error) {
    return (
      <div>
        <PageHeader title="Exams" />
        <ErrorState description={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const openCount = open.length;
  const inProgress = history.filter((a) => a.status === "IN_PROGRESS");
  const past = history.filter((a) => a.status !== "IN_PROGRESS");

  return (
    <div className="space-y-8">
      <PageHeader title="Exams" description="Your available exams and attempt history." />

      {/* Open exams */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-muted-foreground" /> Open exams ({openCount})
        </h2>
        {loading ? (
          <SkeletonCards count={3} />
        ) : open.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-8" />}
            title="No exams open right now"
            description="Check back when a teacher publishes and activates an assessment."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((a) => (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base leading-snug">{a.title}</CardTitle>
                  {a.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2">{a.description}</p>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ClipboardList className="size-4" /> {a.questionCount} questions
                    </span>
                    {a.durationMinutes ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-4" /> {a.durationMinutes} min
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Opens {formatDateTime(a.startsAt)} · closes {formatDateTime(a.endsAt)}
                    </p>
                    <StatusBadge status={a.status} />
                  </div>
                  {a.inProgressAttemptId ? (
                    <Button size="sm" className="w-full" asChild>
                      <Link href={`/student/attempts/${a.inProgressAttemptId}`}>
                        <RotateCcw className="mr-1 size-4" /> Continue attempt
                      </Link>
                    </Button>
                  ) : (
                    <Button size="sm" className="w-full" asChild>
                      <Link href={`/student/assessments/${a.id}`}>
                        <Play className="mr-1 size-4" /> View & start
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Attempt history */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-muted-foreground" /> My attempts
        </h2>
        {loading ? (
          <SkeletonCards count={2} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={<Trophy className="size-8" />}
            title="No attempts yet"
            description="Start an open exam above — your attempts and results will appear here."
          />
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {([...inProgress, ...past] as AttemptHistoryItem[]).map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.assessmentTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.questionCount} questions · started {formatDateTime(a.startedAt)}
                      {a.status !== "IN_PROGRESS" && a.submittedAt
                        ? ` · submitted ${formatDateTime(a.submittedAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {a.status !== "IN_PROGRESS" && a.score !== null && a.totalMarks !== null ? (
                      <span className={`text-sm font-semibold ${a.score >= a.totalMarks / 2 ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {a.score} / {a.totalMarks}
                      </span>
                    ) : null}
                    <StatusBadge status={a.status} />
                    <Button size="sm" asChild>
                      <Link href={statusAction(a).href}>{statusAction(a).label}</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}