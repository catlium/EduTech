"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, Clock, Gauge, ListChecks } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import type { AvailableAssessment } from "@catlium/contracts";

export default function StudentDashboardPage() {
  const { institute } = useTenant();
  const [assessments, setAssessments] = useState<AvailableAssessment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ assessments: AvailableAssessment[] }>("/attempts/available", { signal: ctrl.signal })
      .then(({ assessments }) => setAssessments(assessments))
      .catch((error) => {
        if (error instanceof ApiError) toast.error(error.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  return (
    <div>
      <PageHeader title="Student Dashboard" description="Assessments open for you right now." />
      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : assessments.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="No assessments available"
          description="Check back when a teacher publishes an assessment within its schedule window."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assessments.map((a) => (
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
                    <ListChecks className="size-4" /> {a.questionCount} questions
                  </span>
                  {a.durationMinutes ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-4" /> {a.durationMinutes} min
                    </span>
                  ) : null}
                  {a.maxMarks ? (
                    <span className="inline-flex items-center gap-1">
                      <Gauge className="size-4" /> {a.maxMarks} marks
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Opens {formatDateTime(a.startsAt)} · closes {formatDateTime(a.endsAt)}
                  </p>
                  <Badge variant="secondary">{a.status}</Badge>
                </div>
                <Button size="sm" asChild>
                  <Link href={`/student/assessments/${a.id}`}>View & start</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}