'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, Eye, FileKey2 } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { PageLoader } from '@/components/app/loading';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DocBlocks } from '@/components/export/doc-blocks';
import type { DocumentModel } from '@/components/export/doc-blocks';

/* Assessment preview: renders EXACTLY the document the export endpoints
 * produce (paper = student-facing, answers = teacher key) and remembers the
 * preview hash so the assessment page can enable its export buttons. */

const previewStorageKey = (assessmentId: string, include: 'paper' | 'answers', rev: string) =>
  `catlium:export-preview:${assessmentId}:${include}:${rev}`;

interface PreviewPayload {
  hash: string;
  document: DocumentModel;
}

export default function AssessmentPreviewPage() {
  const params = useParams<{ assessmentId: string }>();
  const [include, setInclude] = useState<'paper' | 'answers'>('paper');
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [rev, setRev] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    void api<{ preview: PreviewPayload }>(
      `/export/assessment/${params.assessmentId}/preview?include=${include}`,
      { signal: ctrl.signal },
    )
      .then(async ({ preview }) => {
        setPreview(preview);
        let revNow = rev;
        if (!revNow) {
          // The assessment id + current updatedAt are needed to key the hash.
          const a = await api<{ assessment: { updatedAt: string } }>(
            `/assessments/${params.assessmentId}`,
            { signal: ctrl.signal },
          );
          revNow = a.assessment.updatedAt;
          setRev(revNow);
        }
        try {
          localStorage.setItem(
            previewStorageKey(params.assessmentId, include, revNow),
            preview.hash,
          );
        } catch {
          // storage unavailable — preview still displays, export will 409.
        }
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof ApiError ? err.message : 'Failed to build preview');
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.assessmentId, include]);

  useEffect(() => {
    const cleanup = fetchPreview();
    return () => cleanup?.();
  }, [fetchPreview]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/assessments/${params.assessmentId}`}>
            <ArrowLeft className="mr-1 size-4" /> Back to assessment
          </Link>
        </Button>
        <Tabs
          value={include}
          onValueChange={(v) => setInclude(v === 'answers' ? 'answers' : 'paper')}
        >
          <TabsList>
            <TabsTrigger value="paper">
              <ClipboardList className="mr-1.5 size-3.5" /> Student paper
            </TabsTrigger>
            <TabsTrigger value="answers">
              <FileKey2 className="mr-1.5 size-3.5" /> Teacher answer key
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading && <PageLoader />}

      {!loading && error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && !preview && (
        <EmptyState
          icon={<Eye className="size-8" />}
          title="Paper not found"
          description="This assessment may have been deleted."
        />
      )}

      {!loading && !error && preview && (
        <>
          {include === 'paper' ? (
            <>
              <PageHeader title={preview.document.title ?? 'Assessment'} />
              <Badge variant="outline" className="mb-4 gap-1">
                <ClipboardList className="size-3" /> Student paper — no answers shown
              </Badge>
            </>
          ) : (
            <>
              <PageHeader title={`${preview.document.title ?? 'Assessment'} — Answer Key`} />
              <Badge variant="outline" className="mb-4 gap-1 text-amber-700">
                <FileKey2 className="size-3" /> Teacher answer key — answers and marks shown
              </Badge>
            </>
          )}

          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-xs text-muted-foreground">
                Preview #{preview.hash.slice(0, 8)} — the exported {'pdf'} {'/'} {'docx'} will
                match this exactly.
              </p>
              <DocBlocks model={preview.document} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}