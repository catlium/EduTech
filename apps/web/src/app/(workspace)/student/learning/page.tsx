'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';

import { api } from '@/lib/api';
import { useTenant } from '@/lib/tenant';
import { useMyScope } from '@/lib/use-my-scope';
import { scopedSubjectIds } from '@/lib/scope';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ErrorState } from '@/components/app/error-state';
import { SkeletonCards } from '@/components/app/loading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SubjectResponse } from '@catlium/contracts';

export default function StudentLearningPage() {
  const { institute } = useTenant();
  const { scope, error: scopeError } = useMyScope();
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!institute) return;
      setLoading(true);
      setError(null);
      api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal })
        .then(({ subjects }) => setSubjects(subjects))
        .catch((err) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setError('Failed to load subjects. Please try again.');
          }
        })
        .finally(() => setLoading(false));
    },
    [institute],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (!institute) return null;

  // Scope-filter: a placed student sees only their class's subjects. Until the
  // featured scope resolves, hold the skeleton so we never flash out-of-scope
  // subjects (clients show what the backend would serve anyway; the API is
  // still the authority — this is alignment, not enforcement).
  const subjectIds = scopedSubjectIds(scope);
  const visible = subjectIds === null ? subjects : subjects.filter((s) => subjectIds.includes(s.id));
  const placement = scope?.placement ?? null;
  const waiting = loading || (scope === null && !scopeError);

  return (
    <div className="space-y-6">
      <PageHeader title="My Subjects" description="Pick a subject to review chapters and topics." />

      {placement && (
        <div className="flex flex-wrap items-center gap-2">
          {[placement.academicYearName, placement.className, placement.divisionName].map((part) => (
            <span
              key={part}
              className="inline-flex items-center rounded-full border bg-background px-3 py-1 text-sm font-medium"
            >
              {part}
            </span>
          ))}
        </div>
      )}

      {waiting ? (
        <SkeletonCards />
      ) : error ? (
        <ErrorState description={error} onRetry={() => load()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No subjects in your scope"
          description={
            placement
              ? 'Your class has no subjects assigned yet — check back when your institute adds content.'
              : "You're not placed in a class yet — subjects appear once your institute places you in an Academic Year, Class and Division."
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((subject) => (
            <Link key={subject.id} href={`/student/learning/${subject.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <CardTitle>{subject.name}</CardTitle>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </CardHeader>
                {subject.description && (
                  <CardContent className="-mt-4 text-sm text-muted-foreground">
                    <p className="line-clamp-2">{subject.description}</p>
                  </CardContent>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}