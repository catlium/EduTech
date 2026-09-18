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
import { ScopeBreadcrumb } from '@/components/app/scope-cascade';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
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

  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeSubjects, setScopeSubjects] = useState<SubjectResponse[]>([]);
  const [scopeChapters, setScopeChapters] = useState<ChapterResponse[]>([]);
  const [scopeTopics, setScopeTopics] = useState<TopicResponse[]>([]);
  const [scopeCascade, setScopeCascade] = useState({ subjectId: '', chapterId: '', topicId: '' });

  const hasScope = !!paper?.subjectId;

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

  async function openSetScope() {
    setScopeOpen(true);
    setScopeCascade({ subjectId: '', chapterId: '', topicId: '' });
    try {
      const { subjects } = await api<{ subjects: SubjectResponse[] }>('/academic/subjects');
      setScopeSubjects(subjects);
    } catch {
      setScopeSubjects([]);
    }
  }

  useEffect(() => {
    if (!scopeOpen || !scopeCascade.subjectId) {
      setScopeChapters([]);
      setScopeTopics([]);
      return;
    }
    const ctrl = new AbortController();
    api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${scopeCascade.subjectId}/chapters`, {
      signal: ctrl.signal,
    })
      .then(({ chapters }) => setScopeChapters(chapters))
      .catch(() => setScopeChapters([]));
    return () => ctrl.abort();
  }, [scopeOpen, scopeCascade.subjectId]);

  useEffect(() => {
    if (!scopeOpen || !scopeCascade.chapterId) {
      setScopeTopics([]);
      return;
    }
    const ctrl = new AbortController();
    api<{ topics: TopicResponse[] }>(`/academic/chapters/${scopeCascade.chapterId}/topics`, {
      signal: ctrl.signal,
    })
      .then(({ topics }) => setScopeTopics(topics))
      .catch(() => setScopeTopics([]));
    return () => ctrl.abort();
  }, [scopeOpen, scopeCascade.chapterId]);

  async function onSaveScope() {
    if (!scopeCascade.subjectId) return;
    setScopeSaving(true);
    try {
      await api(`/question-papers/${params.paperId}/scope`, {
        method: 'PATCH',
        body: {
          subjectId: scopeCascade.subjectId,
          chapterId: scopeCascade.chapterId || undefined,
          topicId: scopeCascade.topicId || undefined,
        },
      });
      toast.success('Question scope saved');
      setScopeOpen(false);
      await fetchPaper();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to set question scope');
    } finally {
      setScopeSaving(false);
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
          hasScope
            ? 'Scope: '
            : 'No question scope set yet',
          paper.durationMinutes && `${paper.durationMinutes} min`,
          paper.maxMarks && `${paper.maxMarks} marks`,
          `${questions.length} question${questions.length !== 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        children={
          hasScope ? (
            <ScopeBreadcrumb subjectId={paper.subjectId} chapterId={paper.chapterId} topicId={paper.topicId} />
          ) : null
        }
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
                  disabled={coverage === null || patternSections.length === 0 || !hasScope}
                  title={hasScope ? undefined : 'Set a question scope first'}
                >
                  <Wand2 className="mr-1 size-3.5" /> Generate Missing
                </Button>
              )}
              {isPatternBased && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onAutoSelect()}
                  disabled={autoSelecting || !hasScope}
                  title={hasScope ? undefined : 'Set a question scope first'}
                >
                  <Wand2 className="mr-1 size-3.5" />
                  {autoSelecting ? 'Shuffling…' : 'Shuffle / Regenerate'}
                </Button>
              )}
              {!hasScope && (
                <Button variant="outline" size="sm" onClick={() => void openSetScope()}>
                  <Wand2 className="mr-1 size-3.5" /> Set Question Scope
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <Download className="mr-1 size-3.5" /> Export
              </Button>
              <Button
                size="sm"
                onClick={() => setCreateAssessOpen(true)}
                disabled={!hasScope}
                title={hasScope ? undefined : 'Set a question scope first'}
              >
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

      {/* ── Set Question Scope dialog ── */}
      <Dialog open={scopeOpen} onOpenChange={setScopeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set Question Scope</DialogTitle>
            <DialogDescription>
              The scope is the authoritative source of questions — subject required, chapter/topic
              optional. This paper was created before scopes existed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Subject</Label>
              <Select value={scopeCascade.subjectId} onValueChange={(v) => setScopeCascade({ subjectId: v, chapterId: '', topicId: '' })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {scopeSubjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Chapter</Label>
              <Select
                value={scopeCascade.chapterId}
                onValueChange={(v) => setScopeCascade({ ...scopeCascade, chapterId: v, topicId: '' })}
                disabled={!scopeCascade.subjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select chapter" />
                </SelectTrigger>
                <SelectContent>
                  {scopeChapters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Topic</Label>
              <Select
                value={scopeCascade.topicId}
                onValueChange={(v) => setScopeCascade({ ...scopeCascade, topicId: v })}
                disabled={!scopeCascade.chapterId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select topic" />
                </SelectTrigger>
                <SelectContent>
                  {scopeTopics.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScopeOpen(false)}>Cancel</Button>
            <Button onClick={() => void onSaveScope()} disabled={!scopeCascade.subjectId || scopeSaving}>
              {scopeSaving ? 'Saving…' : 'Save Scope'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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