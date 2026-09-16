'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ErrorState } from '@/components/app/error-state';
import { StatusBadge } from '@/components/app/status-badge';
import { SkeletonRows } from '@/components/app/loading';
import { NewQuestionPaperDialog } from '@/components/questions/new-question-paper-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AssessmentListItem } from '@catlium/contracts';

function scheduleRange(startsAt?: string | null, endsAt?: string | null): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (v: string) =>
    new Date(v).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  if (startsAt) return `From ${fmt(startsAt)}`;
  return `Until ${fmt(endsAt!)}`;
}

export default function AssessmentsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchAssessments = () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api<{ assessments: AssessmentListItem[] }>('/assessments', { signal: ctrl.signal })
      .then(({ assessments }) => setAssessments(assessments))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  };

  useEffect(() => {
    const cleanup = fetchAssessments();
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institute]);

  return (
    <div>
      <PageHeader
        title="Assessments"
        description={`${assessments.length} assessment${assessments.length !== 1 ? 's' : ''}`}
        actions={
          isTeacher && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 size-3.5" /> New Assessment
            </Button>
          )
        }
      />

      <NewQuestionPaperDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="New Assessment — pick a Paper Pattern"
        description="An assessment is built from a Question Paper. Choose an approved Paper Pattern to create the paper first — you convert it into the assessment from the paper page."
      />

      {loading ? (
        <SkeletonRows />
      ) : error ? (
        <ErrorState onRetry={() => fetchAssessments()} description={error} />
      ) : assessments.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="No assessments yet"
          description="Create your first assessment to get started."
        >
          {isTeacher && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 size-3.5" /> New Assessment
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {assessments.map((a) => (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  <Link href={`/assessments/${a.id}`} className="hover:underline">
                    {a.title}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={a.status} />
                  <span className="text-muted-foreground">
                    {a.questionCount} question{a.questionCount !== 1 ? 's' : ''}
                  </span>
                  {a.durationMinutes && (
                    <span className="text-muted-foreground">
                      {formatDuration(a.durationMinutes)}
                    </span>
                  )}
                  {a.maxMarks && <span className="text-muted-foreground">{a.maxMarks} marks</span>}
                </div>
                {scheduleRange(a.startsAt, a.endsAt) && (
                  <p className="text-muted-foreground">{scheduleRange(a.startsAt, a.endsAt)}</p>
                )}
                <p className="text-muted-foreground">{formatDate(a.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
