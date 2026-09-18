'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { SubjectCard } from '@/components/app/subject-card';
import { EmptyState } from '@/components/app/empty-state';
import { SkeletonCards } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { SubjectResponse } from '@catlium/contracts';

export default function SubjectsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<'active' | 'deleted'>('active');
  const [deleted, setDeleted] = useState<SubjectResponse[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError('Failed to load subjects. Please try again.');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    const cleanup = load();
    return () => cleanup?.();
  }, [load]);

  const loadDeleted = useCallback(() => {
    if (!institute) return;
    setDeletedLoading(true);
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>('/academic/subjects/deleted', { signal: ctrl.signal })
      .then(({ subjects }) => setDeleted(subjects))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        toast.error('Failed to load deleted subjects');
      })
      .finally(() => setDeletedLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    if (view !== 'deleted') return;
    const cleanup = loadDeleted();
    return () => cleanup?.();
  }, [view, loadDeleted]);

  async function restoreSubject(subjectId: string) {
    setRestoring(subjectId);
    try {
      await api(`/academic/subjects/${subjectId}/restore`, { method: 'POST' });
      toast.success('Subject restored with its chapters, topics and materials');
      setDeleted((prev) => prev.filter((s) => s.id !== subjectId));
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Restore failed');
    } finally {
      setRestoring(null);
    }
  }

  const subjectExamples =
    subjects.length > 0
      ? subjects
          .slice(0, 3)
          .map((s) => s.name)
          .join(', ')
      : '';

  return (
    <div>
      <PageHeader
        title={view === 'deleted' ? 'Deleted subjects' : 'Subjects'}
        description={
          view === 'deleted'
            ? 'Soft-deleted subjects — restore one to bring back its whole tree.'
            : subjects.length > 0
              ? `${subjects.length} subject${subjects.length !== 1 ? 's' : ''} \u00b7 ${subjectExamples}`
              : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setView(view === 'deleted' ? 'active' : 'deleted')}>
              {view === 'deleted' ? (
                <>
                  <BookOpen className="mr-1 size-3.5" /> Subjects
                </>
              ) : (
                <>
                  <Trash2 className="mr-1 size-3.5" /> Deleted
                </>
              )}
            </Button>
            {view === 'active' && isTeacher && (
              <Button size="sm" asChild>
                <Link href="/subjects/new">
                  <Plus className="mr-1 size-3.5" /> New Subject
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {view === 'deleted' ? (
        deletedLoading ? (
          <SkeletonCards />
        ) : deleted.length === 0 ? (
          <EmptyState
            icon={<Trash2 className="size-8" />}
            title="Trash is empty"
            description="Deleted subjects appear here and can be restored."
          />
        ) : (
          <div className="space-y-3">
            {deleted.map((subject) => (
              <Card key={subject.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{subject.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {subject.description ?? subject.slug}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void restoreSubject(subject.id)}
                    disabled={restoring !== null}
                  >
                    <RotateCcw className="mr-1 size-3.5" />
                    {restoring === subject.id ? 'Restoring…' : 'Restore'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : loading ? (
        <SkeletonCards />
      ) : error ? (
        <ErrorState onRetry={() => load()} />
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No subjects yet"
          description="Create your first subject to start organizing your curriculum."
        >
          {isTeacher && (
            <Button size="sm" asChild>
              <Link href="/subjects/new">Create Subject</Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <SubjectCard key={subject.id} subject={subject} />
          ))}
        </div>
      )}
    </div>
  );
}
