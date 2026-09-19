'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FileSearch, FileText, Plus } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ErrorState } from '@/components/app/error-state';
import { SkeletonRows } from '@/components/app/loading';
import { NewQuestionPaperDialog } from '@/components/questions/new-question-paper-dialog';
import { QuestionSourceExtractionDialog } from '@/components/questions/question-source-extraction-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { QuestionPaperListItem } from '@catlium/contracts';

export default function QuestionPapersListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();
  const [papers, setPapers] = useState<QuestionPaperListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceExtractionOpen, setSourceExtractionOpen] = useState(false);

  const fetchPapers = () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api<{ papers: QuestionPaperListItem[] }>('/question-papers', { signal: ctrl.signal })
      .then(({ papers }) => setPapers(papers))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  };

  useEffect(() => {
    const cleanup = fetchPapers();
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institute]);

  return (
    <div>
      <PageHeader
        title="Question Papers"
        description={`${papers.length} paper${papers.length !== 1 ? 's' : ''}`}
        actions={
          isTeacher && (
            <>
              <Button size="sm" variant="outline" onClick={() => setSourceExtractionOpen(true)}>
                <FileSearch className="mr-1 size-3.5" /> Extract from Source
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 size-3.5" /> New Question Paper
              </Button>
            </>
          )
        }
      />

      <QuestionSourceExtractionDialog
        open={sourceExtractionOpen}
        onOpenChange={setSourceExtractionOpen}
        basePath="/question-papers"
        onStarted={({ jobId, paperId }) =>
          paperId
            ? router.push(`/question-papers/${paperId}?extraction=${jobId}`)
            : router.push(`/questions/extractions/${jobId}`)
        }
      />

      <NewQuestionPaperDialog open={createOpen} onOpenChange={setCreateOpen} />

      {loading ? (
        <SkeletonRows />
      ) : error ? (
        <ErrorState onRetry={() => fetchPapers()} description={error} />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="No question papers yet"
          description="Generate a question paper from an approved Paper Pattern to get started."
        >
          {isTeacher && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-3.5" /> New Question Paper
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {papers.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  <Link href={`/question-papers/${p.id}`} className="hover:underline">
                    {p.title}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">
                    {p.questionCount} question{p.questionCount !== 1 ? 's' : ''}
                  </span>
                  {p.durationMinutes && (
                    <span className="text-muted-foreground">{p.durationMinutes} min</span>
                  )}
                  {p.maxMarks && <span className="text-muted-foreground">{p.maxMarks} marks</span>}
                </div>
                <p className="text-muted-foreground">{formatDate(p.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}