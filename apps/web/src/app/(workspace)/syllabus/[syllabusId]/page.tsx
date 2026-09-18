'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Play,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Pencil,
  Archive,
  Trash2,
  Loader2,
  AlertTriangle,
  Lock,
  Unlock,
} from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import type {
  SyllabusResponse,
  SyllabusVersion,
  SyllabusConfirmReport,
  SyllabusContext,
  SyllabusStructure,
} from '@catlium/contracts';
import { PageHeader } from '@/components/app/page-header';
import { StatusBadge } from '@/components/app/status-badge';
import { SectionHeader } from '@/components/app/section-header';
import { ErrorState } from '@/components/app/error-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ContextBlock({ context }: { context: SyllabusContext }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Extracted context</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {(context.program ?? context.course ?? context.academicYear) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
            {context.program && (
              <span>
                <span className="font-medium text-foreground">Program:</span> {context.program}
              </span>
            )}
            {context.course && (
              <span>
                <span className="font-medium text-foreground">Course:</span> {context.course}
              </span>
            )}
            {context.academicYear && (
              <span>
                <span className="font-medium text-foreground">Year:</span> {context.academicYear}
              </span>
            )}
          </div>
        )}
        {context.objectives && context.objectives.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Objectives</p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              {context.objectives.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}
        {context.learningOutcomes && context.learningOutcomes.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Learning outcomes</p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              {context.learningOutcomes.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}
        {context.scope && (
          <div className="space-y-1">
            <p className="font-medium">Scope</p>
            <p className="text-muted-foreground">{context.scope}</p>
          </div>
        )}
        {context.units && context.units.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Units</p>
            <ul className="space-y-2">
              {context.units.map((unit, i) => (
                <li key={i}>
                  <p className="font-medium">{unit.title}</p>
                  {unit.description && <p className="text-muted-foreground">{unit.description}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StructureBlock({ structure }: { structure: SyllabusStructure }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Analyzed structure</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {structure.chapters.map((chapter, ci) => (
          <div key={ci} className="space-y-1">
            <p className="font-medium">
              {ci + 1}. {chapter.name}
            </p>
            {chapter.description && (
              <p className="text-sm text-muted-foreground">{chapter.description}</p>
            )}
            {chapter.topics.length > 0 && (
              <ul className="ml-4 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                {chapter.topics.map((topic, ti) => (
                  <li key={ti}>{topic.name}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function SyllabusDetailPage() {
  const { syllabusId } = useParams<{ syllabusId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [syllabus, setSyllabus] = useState<SyllabusResponse | null>(null);
  const [versions, setVersions] = useState<SyllabusVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [report, setReport] = useState<SyllabusConfirmReport | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editProgram, setEditProgram] = useState('');
  const [editAcademicYear, setEditAcademicYear] = useState('');

  const load = useCallback(async () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    try {
      const [{ syllabus }, { versions }] = await Promise.all([
        api<{ syllabus: SyllabusResponse }>(`/syllabus/${syllabusId}`),
        api<{ versions: SyllabusVersion[] }>(`/syllabus/${syllabusId}/versions`),
      ]);
      setSyllabus(syllabus);
      setVersions(versions);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Failed to load syllabus. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [institute, syllabusId]);

  useEffect(() => {
    void load();
  }, [load]);

  const processing =
    syllabus?.processingStatus === 'QUEUED' || syllabus?.processingStatus === 'PROCESSING';
  const analyzing = syllabus?.analysisStatus === 'PROCESSING';

  useEffect(() => {
    if (!processing && !analyzing) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [processing, analyzing, load]);

  async function run(action: string, fn: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(action);
    try {
      await fn();
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function processSyllabus() {
    await run(
      'process',
      () => api(`/syllabus/${syllabusId}/process`, { method: 'POST' }),
      'Processing started',
    );
  }

  async function retrySyllabus() {
    await run(
      'retry',
      () => api(`/syllabus/${syllabusId}/retry`, { method: 'POST' }),
      'Retry started',
    );
  }

  async function analyzeSyllabus() {
    await run(
      'analyze',
      () => api(`/syllabus/${syllabusId}/analyze`, { method: 'POST' }),
      'Analysis started',
    );
  }

  async function setLock(locked: boolean) {
    await run(
      locked ? 'lock' : 'unlock',
      () => api(`/syllabus/${syllabusId}/${locked ? 'lock' : 'unlock'}`, { method: 'POST' }),
      locked ? 'Syllabus locked' : 'Syllabus unlocked — edits are now allowed',
    );
  }

  async function confirmSyllabus() {
    try {
      const { report } = await api<{ report: SyllabusConfirmReport }>(
        `/syllabus/${syllabusId}/confirm`,
        {
          method: 'POST',
        },
      );
      setReport(report);
      setConfirmOpen(false);
      toast.success('Structure confirmed');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Confirmation failed');
    }
  }

  function openEdit() {
    if (!syllabus) return;
    setEditTitle(syllabus.title);
    setEditProgram(syllabus.program ?? '');
    setEditAcademicYear(syllabus.academicYear ?? '');
    setEditOpen(true);
  }

  async function saveEdit() {
    if (busy || !editTitle.trim()) return;
    setBusy('edit');
    try {
      const body: Record<string, string | null> = {
        title: editTitle.trim(),
        ...(editProgram.trim() ? { program: editProgram.trim() } : { program: null }),
        ...(editAcademicYear.trim()
          ? { academicYear: editAcademicYear.trim() }
          : { academicYear: null }),
      };
      await api(`/syllabus/${syllabusId}`, { method: 'PATCH', body });
      setEditOpen(false);
      toast.success('Syllabus updated');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function archiveSyllabus() {
    await run(
      'archive',
      () => api(`/syllabus/${syllabusId}/archive`, { method: 'POST' }),
      'Syllabus archived',
    );
  }

  async function deleteSyllabus() {
    if (busy) return;
    setBusy('delete');
    try {
      await api(`/syllabus/${syllabusId}`, { method: 'DELETE' });
      toast.success('Syllabus deleted');
      router.replace('/syllabus');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed');
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading syllabus…</span>
        </div>
      </div>
    );
  }
  if (error || !syllabus) {
    return <ErrorState description={error ?? 'Syllabus not found.'} onRetry={() => void load()} />;
  }

  const locked = syllabus.isLocked;
  const actionable = isTeacher && !locked;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {syllabus.status === 'PROPOSED' && syllabus.processingStatus === 'UPLOADED' && (
        <Button size="sm" onClick={() => void processSyllabus()} disabled={busy !== null}>
          {busy === 'process' ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Play className="mr-1 size-3.5" />
          )}
          Process
        </Button>
      )}
      {syllabus.status === 'PROPOSED' &&
        (syllabus.processingStatus === 'FAILED' || syllabus.processingStatus === 'QUEUED') && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void retrySyllabus()}
            disabled={busy !== null}
          >
            {busy === 'retry' ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 size-3.5" />
            )}
            Retry
          </Button>
        )}
      {actionable &&
        syllabus.processingStatus === 'READY' &&
        (syllabus.analysisStatus === 'PENDING' || syllabus.analysisStatus === 'FAILED') && (
          <Button size="sm" onClick={() => void analyzeSyllabus()} disabled={busy !== null}>
            {busy === 'analyze' ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 size-3.5" />
            )}
            Analyze
          </Button>
        )}
      {actionable && syllabus.status === 'PROPOSED' && syllabus.analysisStatus === 'READY' && syllabus.structure && (
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
          <CheckCircle2 className="mr-1 size-3.5" /> Confirm structure
        </Button>
      )}
      {isTeacher && locked && (
        <Button
          size="sm"
          onClick={() => void setLock(false)}
          disabled={busy !== null || processing || analyzing}
        >
          <Unlock className="mr-1 size-3.5" /> Unlock
        </Button>
      )}
      {isTeacher && !locked && !processing && !analyzing && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void setLock(true)}
          disabled={busy !== null}
        >
          <Lock className="mr-1 size-3.5" /> Lock
        </Button>
      )}
      {actionable && !processing && !analyzing && (
        <Button size="sm" variant="outline" onClick={openEdit} disabled={busy !== null}>
          <Pencil className="mr-1 size-3.5" /> Edit
        </Button>
      )}
      {actionable && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setArchiveOpen(true)}
          disabled={busy !== null}
        >
          <Archive className="mr-1 size-3.5" /> Archive
        </Button>
      )}
      {actionable && (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => setDeleteOpen(true)}
          disabled={busy !== null}
        >
          <Trash2 className="mr-1 size-3.5" /> Delete
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={syllabus.title}
        description={syllabus.subjectName}
        actions={
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" onClick={() => router.push('/syllabus')}>
              <ArrowLeft className="size-4" />
            </Button>
            {actions}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">v{syllabus.version}</span>
          <StatusBadge status={syllabus.status} />
          <StatusBadge status={syllabus.processingStatus} />
          <StatusBadge status={syllabus.analysisStatus} />
        </div>
      </PageHeader>

      {syllabus.analysisStatus === 'PROCESSING' && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Deep-analyzing the syllabus… this runs asynchronously.
        </div>
      )}
      {syllabus.analysisStatus === 'FAILED' && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          {syllabus.analysisError ?? 'Analysis failed'}
        </div>
      )}
      {syllabus.processingStatus === 'FAILED' && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          {syllabus.processingError ?? 'Processing failed'}
        </div>
      )}
      {syllabus.isLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <Lock className="size-4 shrink-0" />
          This syllabus is locked — unlock it before editing, archiving or deleting.
        </div>
      )}
      {syllabus.status === 'CONFIRMED' && !syllabus.isLocked && isTeacher && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-700 dark:text-violet-400">
          <Unlock className="size-4 shrink-0" />
          Confirmed but unlocked — edits, archive and delete are allowed until you lock it again.
        </div>
      )}
      {syllabus.status === 'CONFIRMED' && (
        <div className="flex items-center gap-2 rounded-lg border bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0" />
          Confirmed{syllabus.confirmedAt ? ` on ${formatDateTime(syllabus.confirmedAt)}` : ''} — the
          chapters and topics are live in the subject hierarchy.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div>
              <span className="text-muted-foreground">Subject:</span> {syllabus.subjectName}
            </div>
            {syllabus.program && (
              <div>
                <span className="text-muted-foreground">Program:</span> {syllabus.program}
              </div>
            )}
            {syllabus.academicYear && (
              <div>
                <span className="text-muted-foreground">Year:</span> {syllabus.academicYear}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Source:</span> {syllabus.sourceType}
            </div>
            {syllabus.fileName && (
              <div>
                <span className="text-muted-foreground">File:</span> {syllabus.fileName} (
                {formatBytes(syllabus.fileSize)})
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Created:</span>{' '}
              {formatDateTime(syllabus.createdAt)}
            </div>
            <div>
              <span className="text-muted-foreground">Updated:</span>{' '}
              {formatDateTime(syllabus.updatedAt)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">v{v.version}</span>
                  <StatusBadge status={v.status} />
                  <StatusBadge status={v.processingStatus} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(v.createdAt)}
                  {v.isCurrent ? ' · current' : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Syllabus text</CardTitle>
        </CardHeader>
        <CardContent>
          {syllabus.textContent ? (
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-relaxed">
              {syllabus.textContent}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              {syllabus.processingStatus === 'UPLOADED'
                ? 'File uploaded. Run Process to extract the text.'
                : 'No text extracted yet.'}
            </p>
          )}
        </CardContent>
      </Card>

      {syllabus.context && <ContextBlock context={syllabus.context} />}
      {syllabus.structure && <StructureBlock structure={syllabus.structure} />}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm syllabus structure?"
        description="The analyzed chapters and topics are reconciled into the subject hierarchy — matching items are reused, new ones created, anything removed is archived. This cannot be undone for this version."
        confirmLabel="Confirm"
        onConfirm={confirmSyllabus}
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this syllabus?"
        description="The syllabus is hidden but its structure stays linked."
        confirmLabel="Archive"
        onConfirm={archiveSyllabus}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this syllabus?"
        description="This permanently deletes the syllabus row."
        confirmLabel="Delete"
        destructive
        onConfirm={deleteSyllabus}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit syllabus</DialogTitle>
            <DialogDescription>Update the syllabus details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Title *</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-program">Program</Label>
              <Input
                id="edit-program"
                value={editProgram}
                placeholder="e.g. B.Sc. Computer Science"
                onChange={(e) => setEditProgram(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-year">Academic year</Label>
              <Input
                id="edit-year"
                value={editAcademicYear}
                placeholder="e.g. 2026-27"
                onChange={(e) => setEditAcademicYear(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void saveEdit()}
                disabled={busy === 'edit' || !editTitle.trim()}
              >
                {busy === 'edit' ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {report && (
        <Dialog open onOpenChange={(o) => !o && setReport(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Structure confirmed</DialogTitle>
              <DialogDescription>
                Reconciliation report — created, reused, removed, or left uncertain.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div>
                Chapters: {report.createdChapters.length} created, {report.reusedChapters.length}{' '}
                reused, {report.removedChapters.length} removed
              </div>
              <div>
                Topics: {report.createdTopics.length} created, {report.reusedTopics.length} reused,{' '}
                {report.removedTopics.length} removed
              </div>
              {report.uncertain.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                  Uncertain matches: {report.uncertain.join(', ')}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setReport(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
