'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { StatusBadge } from '@/components/app/status-badge';
import { SkeletonCards } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PaperPattern, SubjectResponse } from '@catlium/contracts';

export default function PaperPatternsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();
  const [patterns, setPatterns] = useState<PaperPattern[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    Promise.all([
      api<{ patterns: PaperPattern[] }>('/paper-patterns', { signal: ctrl.signal }),
      api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal: ctrl.signal }),
    ])
      .then(([p, s]) => {
        setPatterns(p.patterns);
        setSubjects(s.subjects);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Failed to load paper patterns');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    return load();
  }, [load]);

  const subjectMap = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
  const filtered =
    subjectFilter === 'all' ? patterns : patterns.filter((p) => p.subjectId === subjectFilter);

  return (
    <div>
      <PageHeader
        title="Paper Patterns"
        description={
          patterns.length > 0
            ? `${patterns.length} pattern${patterns.length !== 1 ? 's' : ''}`
            : undefined
        }
        actions={
          isTeacher && (
            <Button size="sm" asChild>
              <Link href="/paper-patterns/new">
                <Plus className="mr-1 size-3.5" /> New Pattern
              </Link>
            </Button>
          )
        }
      />

      {!loading && patterns.length > 0 && (
        <div className="mb-4">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading ? (
        <SkeletonCards />
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="No paper patterns yet"
          description="Create your first paper pattern to define an exam blueprint."
        >
          {isTeacher && (
            <Button size="sm" asChild>
              <Link href="/paper-patterns/new">Create Pattern</Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {filtered.map((pattern) => (
            <Card
              key={pattern.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => router.push(`/paper-patterns/${pattern.id}`)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{pattern.title || 'Untitled pattern'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={pattern.status} />
                  {pattern.structure && (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {pattern.structure.totalMarks ?? '—'} marks
                    </span>
                  )}
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                    {pattern.sourceType}
                  </span>
                  <span className="text-muted-foreground">
                    {subjectMap[pattern.subjectId] ?? 'Unknown subject'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Updated {formatDate(pattern.updatedAt)}</span>
                  {pattern.validatedAt && <span>Validated {formatDate(pattern.validatedAt)}</span>}
                  {pattern.approvedAt && <span>Approved {formatDate(pattern.approvedAt)}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
