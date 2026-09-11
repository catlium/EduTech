"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { SkeletonCards } from "@/components/app/loading";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { AssessmentAnalytics, AttemptListItem } from "@catlium/contracts";

function formatAccuracy(accuracy: number | null | undefined): string {
  return accuracy === null || accuracy === undefined ? "—" : `${Math.round(accuracy * 100)}%`;
}

export default function AssessmentResultsPage() {
  const params = useParams<{ assessmentId: string }>();
  const { institute } = useTenant();
  const [attempts, setAttempts] = useState<AttemptListItem[] | null>(null);
  const [analytics, setAnalytics] = useState<AssessmentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!institute || !params.assessmentId) return;
    const ctrl = new AbortController();
    Promise.all([
      api<{ attempts: AttemptListItem[] }>(`/assessments/${params.assessmentId}/attempts`, {
        signal: ctrl.signal,
      }),
      api<{ analytics: AssessmentAnalytics }>(`/assessments/${params.assessmentId}/analytics`, {
        signal: ctrl.signal,
      }),
    ])
      .then(([{ attempts }, { analytics }]) => {
        setAttempts(attempts);
        setAnalytics(analytics);
      })
      .catch((error) => {
        if (error instanceof ApiError) toast.error(error.message);
        else if (error.name !== "AbortError") toast.error("Failed to load results");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, params.assessmentId]);

  const { summary } = analytics ?? { summary: null };

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

      {loading ? (
        <SkeletonCards count={4} />
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              {attempts === null ? (
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

          {analytics && summary && summary.evaluatedAttempts > 0 ? (
            <>
              <Card>
                <CardContent className="pt-6">
                  <h3 className="mb-4 text-sm font-semibold">Overview</h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Evaluated</div>
                      <div className="text-2xl font-semibold">{summary.evaluatedAttempts}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Average</div>
                      <div className="text-2xl font-semibold">{summary.averageScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Highest</div>
                      <div className="text-2xl font-semibold">{summary.highestScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Lowest</div>
                      <div className="text-2xl font-semibold">{summary.lowestScore}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <h3 className="mb-4 text-sm font-semibold">Score distribution</h3>
                  {analytics.scoreDistribution.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No scores yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {analytics.scoreDistribution.map((bucket) => (
                        <div key={bucket.score} className="flex items-center gap-3">
                          <div className="w-16 text-sm tabular-nums">{bucket.score}</div>
                          <Progress
                            value={Math.round(
                              (bucket.count / analytics.scoreDistribution.reduce((m, b) => Math.max(m, b.count), 0)) * 100,
                            )}
                            className="h-2"
                          />
                          <div className="w-24 text-sm tabular-nums text-muted-foreground">
                            {bucket.count} {bucket.count === 1 ? "student" : "students"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <h3 className="mb-4 text-sm font-semibold">Question performance</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">#</th>
                          <th className="pb-2 pr-4 font-medium">Question</th>
                          <th className="pb-2 pr-4 font-medium">Type</th>
                          <th className="pb-2 pr-4 font-medium">Difficulty</th>
                          <th className="pb-2 pr-4 font-medium text-right">Correct</th>
                          <th className="pb-2 pr-4 font-medium text-right">Incorrect</th>
                          <th className="pb-2 pr-4 font-medium text-right">Unanswered</th>
                          <th className="pb-2 pr-4 font-medium text-right">Accuracy</th>
                          <th className="pb-2 pr-4 font-medium text-right">Marks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.questionAccuracy.map((q) => (
                          <tr key={q.questionId} className="border-b last:border-0">
                            <td className="py-2 pr-4 text-muted-foreground">{q.sortOrder}</td>
                            <td className="py-2 pr-4 max-w-56 truncate">{q.stem}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{q.questionType.replaceAll("_", " ")}</td>
                            <td className="py-2 pr-4">
                              <Badge variant="outline">{q.difficulty}</Badge>
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">{q.correctCount}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{q.incorrectCount}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{q.unansweredCount}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{formatAccuracy(q.accuracy)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {q.marksAwarded} / {q.marksAvailable}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <h3 className="mb-4 text-sm font-semibold">Topic performance</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Topic</th>
                          <th className="pb-2 pr-4 font-medium text-right">Questions</th>
                          <th className="pb-2 pr-4 font-medium text-right">Responses</th>
                          <th className="pb-2 pr-4 font-medium text-right">Correct</th>
                          <th className="pb-2 pr-4 font-medium text-right">Accuracy</th>
                          <th className="pb-2 pr-4 font-medium text-right">Marks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.topicPerformance.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-2 text-muted-foreground">
                              No topic-level data.
                            </td>
                          </tr>
                        ) : (
                          analytics.topicPerformance.map((t) => (
                            <tr key={t.topicId} className="border-b last:border-0">
                              <td className="py-2 pr-4 font-medium">{t.topicName}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{t.questionCount}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{t.responses}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{t.correctResponses}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{formatAccuracy(t.accuracy)}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {t.marksEarned} / {t.marksAvailable}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <h3 className="mb-4 text-sm font-semibold">Difficulty performance</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Difficulty</th>
                          <th className="pb-2 pr-4 font-medium text-right">Questions</th>
                          <th className="pb-2 pr-4 font-medium text-right">Responses</th>
                          <th className="pb-2 pr-4 font-medium text-right">Correct</th>
                          <th className="pb-2 pr-4 font-medium text-right">Accuracy</th>
                          <th className="pb-2 pr-4 font-medium text-right">Marks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.difficultyPerformance.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-2 text-muted-foreground">
                              No difficulty-level data.
                            </td>
                          </tr>
                        ) : (
                          analytics.difficultyPerformance.map((d) => (
                            <tr key={d.difficulty} className="border-b last:border-0">
                              <td className="py-2 pr-4 font-medium">{d.difficulty}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{d.questionCount}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{d.responses}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{d.correctResponses}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{formatAccuracy(d.accuracy)}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {d.marksEarned} / {d.marksAvailable}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}