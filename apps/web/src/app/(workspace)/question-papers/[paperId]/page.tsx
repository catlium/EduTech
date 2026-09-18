'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  FileText,
  ListOrdered,
  Trash2,
  Download,
  Eye,
  Wand2,
  ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError, downloadFile } from '@/lib/api';
import {
  ExportPreviewDialog,
  type ExportPreviewValue,
} from '@/components/export/export-preview-dialog';
import { formatDate } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ErrorState } from '@/components/app/error-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { PageLoader } from '@/components/app/loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type {
  QuestionPaperResponse,
  QuestionPaperQuestion,
  PatternCoverageResponse,
} from '@catlium/contracts';

interface PaperWithSubjects extends QuestionPaperResponse {
  subjects: string[];
}

interface ShortageBucket {
  questionType: string;
  difficulty: string;
  requested: number;
  existing: number;
  pending: number;
  deficit: number;
}

interface GenerateMissingResult {
  generated: boolean;
  status: 'NO_ACTION' | 'QUEUED';
  batchId: string | null;
  jobIds: string[] | null;
  buckets: ShortageBucket[];
  totalExisting: number;
  totalDeficit: number;
}

export default function QuestionPaperDetailPage() {
  const router = useRouter();
  const params = useParams<{ paperId: string }>();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [paper, setPaper] = useState<PaperWithSubjects | null>(null);
  const [questions, setQuestions] = useState<QuestionPaperQuestion[]>([]);
  const [coverage, setCoverage] = useState<PatternCoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [autoSelecting, setAutoSelecting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createAssessOpen, setCreateAssessOpen] = useState(false);
  const [creatingAssess, setCreatingAssess] = useState(false);

  const [genOpen, setGenOpen] = useState(false);
  const [genPreview, setGenPreview] = useState<GenerateMissingResult | null>(null);
  const [genEffect, setGenEffect] = useState<GenerateMissingResult | null>(null);
  const [generating, setGenerating] = useState(false);

  const [exportDate, setExportDate] = useState('');
  const [exportTime, setExportTime] = useState('');

  const isPatternBased = !!paper?.blueprintId;
  const patternSections = (coverage?.sections ?? []).filter((s) => s.requiredCount > 0);
  const uncoveredSections = patternSections.filter((s) => s.status !== 'OK');

  /* ── data fetching ── */
  const fetchPaper = useCallback(async () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    try {
      const [{ paper: p }, { questions: q }, { coverage: c }] = await Promise.all([
        api<{ paper: PaperWithSubjects }>(`/question-papers/${params.paperId}`),
        api<{ questions: QuestionPaperQuestion[] }>(
          `/question-papers/${params.paperId}/questions`,
        ),
        api<{ coverage: PatternCoverageResponse | null }>(
          `/question-papers/${params.paperId}/pattern-coverage`,
        ),
      ]);
      setPaper(p);
      setQuestions(q);
      setCoverage(c);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load question paper');
    } finally {
      setLoading(false);
    }
  }, [institute, params.paperId]);

  useEffect(() => {
    void fetchPaper();
  }, [fetchPaper]);

  /* ── actions ── */
  async function onAutoSelect() {
    setAutoSelecting(true);
    try {
      await api(`/question-papers/${params.paperId}/select-from-pattern`, { method: 'POST' });
      toast.success('Selection regenerated');
      await fetchPaper();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to shuffle');
    } finally {
      setAutoSelecting(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await api(`/question-papers/${params.paperId}`, { method: 'DELETE' });
      toast.success('Question paper deleted');
      router.push('/question-papers');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  async function onCreateAssessment() {
    setCreatingAssess(true);
    try {
      const { assessment } = await api<{ assessment: { id: string } }>(
        `/question-papers/${params.paperId}/assessment`,
        { method: 'POST' },
      );
      toast.success('Assessment created — edit and publish in the assessment workflow');
      router.push(`/assessments/${assessment.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create assessment');
    } finally {
      setCreatingAssess(false);
      setCreateAssessOpen(false);
    }
  }

  const dateTimeQuery = () =>
    exportDate || exportTime ? `&date=${encodeURIComponent(exportDate)}&time=${encodeURIComponent(exportTime)}` : '';

  async function onExport(format: 'pdf' | 'docx') {
    setExporting(true);
    try {
      await downloadFile(
        `/export/question-paper/${params.paperId}?format=${format}${dateTimeQuery()}`,
        `question-paper-${params.paperId}.${format}`,
      );
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const loadPreview = useCallback(async (): Promise<ExportPreviewValue> => {
    const { preview } = await api<{ preview: ExportPreviewValue }>(
      `/export/question-paper/${params.paperId}/preview${dateTimeQuery()}`,
    );
    return preview;
  }, [params.paperId, exportDate, exportTime]);

  /* ── generate missing (shortage fill) ── */
  async function previewGenerateMissing() {
    setGenPreview(null);
    setGenerating(true);
    try {
      const { result } = await api<{ result: GenerateMissingResult }>(
        `/question-papers/${params.paperId}/generate-missing`,
        {
          method: 'POST',
          body: { dryRun: true },
        },
      );
      setGenPreview(result);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to preview shortages');
    } finally {
      setGenerating(false);
    }
  }

  async function onGenerateMissing() {
    setGenerating(true);
    try {
      const { result } = await api<{ result: GenerateMissingResult }>(
        `/question-papers/${params.paperId}/generate-missing`,
        {
          method: 'POST',
          body: { dryRun: false },
        },
      );
      setGenEffect(result);
      if (result.totalDeficit === 0) {
        toast.success('All sections fully covered — nothing to generate');
      } else if (result.batchId) {
        toast.success('Generation queued — questions will appear once approved');
      }
      await fetchPaper();
      setGenOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to generate questions');
    } finally {
      setGenerating(false);
    }
  }

  /* ── render ── */
  if (loading) return <PageLoader />;
  if (error || !paper) {
    return (
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/question-papers">
            <ArrowLeft className="mr-1 size-3.5" /> Question Papers
          </Link>
        </Button>
        <ErrorState description={error ?? 'Question paper not found'} onRetry={() => void fetchPaper()} />
      </div>
    );
  }

  const bySection = (name: string) =>
    questions.filter((q) => (q.section || 'General') === name).sort((a, b) => a.sortOrder - b.sortOrder);
  const unsectioned = questions.filter(
    (q) => !patternSections.some((s) => s.name === (q.section || 'General')),
  );

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link href="/question-papers">
          <ArrowLeft className="mr-1 size-3.5" /> Question Papers
        </Link>
      </Button>

      <PageHeader
        title={paper.title}
        description={[
          paper.subjectId && paper.subjects?.length > 0
            ? `Subject: ${paper.subjects.join(', ')}`
            : paper.subjects?.length > 0
              ? `${paper.subjects.join(', ')}`
              : null,
          paper.durationMinutes && `${paper.durationMinutes} min`,
          paper.maxMarks && `${paper.maxMarks} marks`,
          `${questions.length} question${questions.length !== 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          isTeacher && (
            <div className="flex flex-wrap gap-2">
              {isPatternBased && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGenPreview(null);
                    setGenEffect(null);
                    setGenOpen(true);
                  }}
                  disabled={coverage === null || patternSections.length === 0}
                >
                  <Wand2 className="mr-1 size-3.5" /> Generate Missing
                </Button>
              )}
              {isPatternBased && (
                <Button variant="outline" size="sm" onClick={() => void onAutoSelect()} disabled={autoSelecting}>
                  <Wand2 className="mr-1 size-3.5" />
                  {autoSelecting ? 'Shuffling…' : 'Shuffle / Regenerate'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <Download className="mr-1 size-3.5" /> Export
              </Button>
              <Button size="sm" onClick={() => setCreateAssessOpen(true)}>
                <ClipboardList className="mr-1 size-3.5" /> Create Assessment
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )
        }
      />

      {/* Coverage panel */}
      {isPatternBased && patternSections.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="size-4" /> Pattern Coverage
            </CardTitle>
            <CardDescription>
              {uncoveredSections.length === 0
                ? 'All sections fully covered.'
                : `${uncoveredSections.length} section${uncoveredSections.length !== 1 ? 's' : ''} with shortages — Generate Missing creates the shortfall automatically.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {patternSections.map((s) => (
                <div key={s.name} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <Badge variant={s.status === 'OK' ? 'secondary' : 'destructive'} className="text-xs">
                      {s.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.presentCount} / {s.requiredCount} questions · {s.presentMarks} / {s.requiredMarks} marks
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Questions by section */}
      {questions.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="No questions selected"
          description="Use Shuffle / Regenerate to select questions from the Question Bank."
        />
      ) : (
        <div className="space-y-4">
          {patternSections.map((sec) => {
            const sectionQuestions = bySection(sec.name);
            if (sectionQuestions.length === 0) return null;
            return (
              <Card key={sec.name}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {sec.name}
                    <span className="ml-2 text-sm text-muted-foreground">
                      {sectionQuestions.length} question{sectionQuestions.length !== 1 ? 's' : ''}
                      {' · '}
                      {sec.presentMarks} marks
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {sectionQuestions.map((l, i) => (
                    <div key={l.id} className="flex items-start gap-3 rounded-md border px-3 py-2">
                      <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                        {i + 1}.
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm">{l.question.stem}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="secondary">{l.question.questionType}</Badge>
                          <span>{l.question.difficulty}</span>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{l.marks} mark{l.marks !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}

          {unsectioned.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">General</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {unsectioned.map((l, i) => (
                  <div key={l.id} className="flex items-start gap-3 rounded-md border px-3 py-2">
                    <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                      {i + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm">{l.question.stem}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="secondary">{l.question.questionType}</Badge>
                        <span>{l.question.difficulty}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{l.marks} mark{l.marks !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Export dialog ── */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Question Paper</DialogTitle>
            <DialogDescription>
              The student paper never includes answers or difficulty labels.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium">
              Date
              <input
                type="date"
                value={exportDate}
                onChange={(e) => setExportDate(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium">
              Time
              <input
                type="time"
                value={exportTime}
                onChange={(e) => setExportTime(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void onExport('pdf')}
              disabled={exporting}
            >
              <Eye className="mr-1 size-3.5" /> PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => void onExport('docx')}
              disabled={exporting}
            >
              <Download className="mr-1 size-3.5" /> DOCX
            </Button>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setExportOpen(false); setPreviewOpen(true); }}>
              Preview
            </Button>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Generate Missing dialog ── */}
      <Dialog open={genOpen} onOpenChange={(open) => { setGenOpen(open); if (!open) setGenPreview(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Missing Questions</DialogTitle>
            <DialogDescription>
              Detects questions the paper pattern requires but that are missing from the bank, and queues AI generation for the shortfall.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-end justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => void previewGenerateMissing()} disabled={generating}>
              {generating ? 'Checking…' : 'Preview shortage'}
            </Button>
          </div>

          {genPreview && (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Bank status</p>
              <p className="text-xs text-muted-foreground">
                {genPreview.totalExisting} existing questions across the pattern scope ·{' '}
                {genPreview.totalDeficit}{' '}
                {genPreview.totalDeficit === 1 ? 'question short' : 'questions short'}
              </p>
              {genPreview.buckets.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {genPreview.buckets.map((b) => (
                    <li key={`${b.questionType}-${b.difficulty}`}>
                      {b.questionType} · {b.difficulty}: {b.existing} existing, {b.pending} pending, {b.deficit} short
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {genEffect && (
            <p className="text-xs text-muted-foreground">
              {genEffect.generated && genEffect.status === 'QUEUED'
                ? 'Generation queued — once approved, use Shuffle / Regenerate to select from the new questions.'
                : genEffect.totalDeficit === 0
                  ? 'All sections fully covered — nothing to generate.'
                  : 'Nothing was queued. Try the preview to see the shortage.'}
            </p>
          )}

          <DialogFooter>
            <Button onClick={() => void onGenerateMissing()} disabled={generating}>
              {generating ? 'Queuing…' : 'Generate Missing'}
            </Button>
            <Button variant="ghost" onClick={() => setGenOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog ── */}
      <ExportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Question Paper Preview"
        load={loadPreview}
      />

      {/* ── Create assessment confirmation ── */}
      <ConfirmDialog
        open={createAssessOpen}
        onOpenChange={setCreateAssessOpen}
        title="Create Assessment from this Paper?"
        description="This will create a new DRAFT Assessment containing these questions. The assessment is a separate entity that can then be scheduled, published and activated for online attempts."
        confirmLabel={creatingAssess ? 'Creating…' : 'Create Assessment'}
        loading={creatingAssess}
        onConfirm={() => void onCreateAssessment()}
      />

      {/* ── Delete confirmation ── */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete this Question Paper?"
        description="This permanently removes the paper and its selected questions. This cannot be undone."
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        loading={deleting}
        destructive
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}