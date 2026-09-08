"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AttemptListItem } from "@catlium/contracts";

export default function AssessmentResultsPage() {
  const params = useParams<{ assessmentId: string }>();
  const { institute } = useTenant();
  const [attempts, setAttempts] = useState<AttemptListItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!institute || !params.assessmentId) return;
    const ctrl = new AbortController();
    api<{ attempts: AttemptListItem[] }>(`/assessments/${params.assessmentId}/attempts`, {
      signal: ctrl.signal,
    })
      .then(({ attempts }) => setAttempts(attempts))
      .catch((error) => {
        if (error instanceof ApiError) toast.error(error.message);
        else if (error.name !== "AbortError") toast.error("Failed to load results");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.assessmentId]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link href={`/assessments/${params.assessmentId}`}>
          <ArrowLeft className="mr-1 size-4" /> Back
        </Link>
      </Button>

      <PageHeader
        title="Attempt results"
        description="Scores populated automatically after each attempt is submitted or expires."
      />

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : attempts === null ? (
            <p className="text-sm text-muted-foreground">Failed to load results.</p>
          ) : attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attempts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Student</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Score</th>
                    <th className="pb-2 pr-4 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((attempt) => (
                    <tr key={attempt.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{attempt.studentName}</div>
                        <div className="text-xs text-muted-foreground">{attempt.studentEmail}</div>
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={attempt.status} />
                      </td>
                      <td className="py-2 pr-4 font-medium">
                        {attempt.score === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          `${attempt.score} / ${attempt.totalMarks}`
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}