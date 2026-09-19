'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowUpRight,
  Play,
  RefreshCw,
  Archive,
  CheckCircle2,
  Loader2,
  Pencil,
  AlertTriangle,
  Eye,
  FileText,
  FileUp,
  BookOpen,
  Sparkles,
  Ban,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

import { api, ApiError, waitForJob } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import type {
  MaterialResponse,
  MaterialProcessingStatus,
  ContentGenerationStatus,
  ContentGenerationStatusResponse,
  MaterialEnhancementResponse,
  MaterialResolvedSegment,
} from '@catlium/contracts';
import { PageHeader } from '@/components/app/page-header';
import { StatusBadge } from '@/components/app/status-badge';
import {
  ScopeBreadcrumb,
  ScopeCascade,
  type ScopeCascade as ScopeCascadeState,
  emptyCascade,
} from '@/components/app/scope-cascade';
import { ErrorState } from '@/components/app/error-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { OcrInspection } from '@/components/app/ocr-inspection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const PROCESSING_STEPS: { status: MaterialProcessingStatus; label: string }[] = [
  { status: 'UPLOADED', label: 'Uploaded' },
  { status: 'QUEUED', label: 'Queued' },
  { status: 'PROCESSING', label: 'Processing' },
  { status: 'READY', label: 'Ready' },
];

const RESOURCE_TYPES: { type: string; label: string }[] = [
  { type: 'NOTE', label: 'Notes' },
  { type: 'SUMMARY', label: 'Summary' },
  { type: 'FLASHCARD_SET', label: 'Flashcards' },
  { type: 'IMPORTANT_CONCEPTS', label: 'Concepts' },
  { type: 'CORNELL_NOTE', label: 'Cornell Notes' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MaterialDetailPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();

  const [material, setMaterial] = useState<MaterialResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<'archive' | 'activate' | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [genStatus, setGenStatus] = useState<ContentGenerationStatusResponse | null>(null);
  const [enhancement, setEnhancement] = useState<MaterialEnhancementResponse | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [segmentsOpen, setSegmentsOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ material: MaterialResponse }>(`/materials/${materialId}`, { signal: ctrl.signal })
      .then(({ material }) => setMaterial(material))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof ApiError ? err.message : 'Failed to load material');
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, materialId]);

  const loadGenStatus = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ generationStatus: ContentGenerationStatusResponse }>(
      `/content/generation-status?materialId=${materialId}`,
      { signal: ctrl.signal },
    )
      .then(({ generationStatus }) => setGenStatus(generationStatus))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute, materialId]);

  const loadEnhancement = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ material: { id: string }; enhancement: MaterialEnhancementResponse | null }>(
      `/materials/${materialId}/enhancement`,
      { signal: ctrl.signal },
    )
      .then((res) => setEnhancement(res.enhancement))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute, materialId]);

  useEffect(() => {
    return loadEnhancement();
  }, [loadEnhancement]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  useEffect(() => {
    return loadGenStatus();
  }, [loadGenStatus]);

  const isProcessing =
    material?.processingStatus === 'QUEUED' || material?.processingStatus === 'PROCESSING';

  // While a cancel is settling the material flips to QUEUED server-side; drop
  // the transient "Cancelling…" state when the poll sees the move.
  useEffect(() => {
    if (!isProcessing) setCancelling(false);
  }, [isProcessing]);

  async function cancelProcessing() {
    if (!material?.processJobId) return;
    setCancelling(true);
    try {
      const res = await api<{ job: { status: string } }>(
        `/jobs/${material.processJobId}/cancel`,
        { method: 'POST' },
      );
      toast.success(
        res.job.status === 'cancelled'
          ? 'Processing cancelled'
          : 'Cancelling — this finishes at the next chunk boundary',
      );
    } catch (err) {
      setCancelling(false);
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel processing');
    }
  }

  async function enhanceMaterial() {
    if (!material) return;
    try {
      const res = await api<{ jobId: string }>(`/materials/${material.id}/enhancement`, {
        method: 'POST',
      });
      setEnhancing(true);
      toast.success('Enhancement started');
      try {
        await waitForJob(() => api<{ job: { status: string } }>(`/jobs/${res.jobId}`));
        toast.success('Material enhanced');
        loadEnhancement();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Enhancement failed or was cancelled');
      } finally {
        setEnhancing(false);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start enhancement');
    }
  }

  useEffect(() => {
    if (!isProcessing || !material) return;
    const ctrl = new AbortController();
    const id = setInterval(() => {
      api<{ material: MaterialResponse }>(`/materials/${materialId}`, { signal: ctrl.signal })
        .then(({ material }) => setMaterial(material))
        .catch(() => {});
    }, 3000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [isProcessing, materialId, material]);

  async function processMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/process`, { method: 'POST' });
      toast.success('Processing started');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start processing');
    }
  }

  async function retryMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/retry`, { method: 'POST' });
      toast.success('Retry started');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to retry');
    }
  }

  async function archiveMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/archive`, { method: 'POST' });
      toast.success('Material archived');
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to archive');
    }
  }

  async function activateMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/activate`, { method: 'POST' });
      toast.success('Material activated');
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to activate');
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error || !material) {
    return (
      <div>
        <PageHeader title="Material" />
        <ErrorState description={error ?? 'Material not found.'} onRetry={refresh} />
      </div>
    );
  }

  const typeLabel = material.fileName?.split('.').pop()?.toUpperCase() ?? material.materialType;

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => router.push('/materials')}
        >
          <ArrowLeft className="mr-1 size-3.5" /> Materials
        </Button>
        <PageHeader
          title={material.title}
          actions={
            isTeacher && (
              <div className="flex flex-wrap gap-2">
                {material.topicId && material.subjectId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      router.push(`/subjects/${material.subjectId}/topics/${material.topicId}`)
                    }
                  >
                    <ArrowUpRight className="mr-1 size-3.5" /> Open Topic workspace
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1 size-3.5" /> Edit
                </Button>
                {material.sourceType === 'UPLOAD' && material.processingStatus === 'UPLOADED' && (
                  <Button size="sm" onClick={processMaterial}>
                    <Play className="mr-1 size-3.5" /> Process
                  </Button>
                )}
                {(material.processingStatus === 'FAILED' ||
                  material.processingStatus === 'QUEUED') && (
                  <Button size="sm" variant="outline" onClick={retryMaterial}>
                    <RefreshCw className="mr-1 size-3.5" /> Retry
                  </Button>
                )}
                {material.status === 'ACTIVE' ? (
                  <Button size="sm" variant="outline" onClick={() => setConfirmAction('archive')}>
                    <Archive className="mr-1 size-3.5" /> Archive
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setConfirmAction('activate')}>
                    <CheckCircle2 className="mr-1 size-3.5" /> Activate
                  </Button>
                )}
              </div>
            )
          }
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FileText className="size-3.5" /> {material.sourceType}
          </span>
          {material.sourceType === 'GENERATED' && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Starter material
            </span>
          )}
          <StatusBadge status={typeLabel} />
          <span className="flex items-center gap-1.5">
            <BookOpen className="size-3.5" /> Revision {material.revision}
          </span>
          {material.sourceType === 'UPLOAD' && material.fileName && (
            <span className="flex items-center gap-1.5">
              <FileUp className="size-3.5" />
              {material.fileName}
              {material.fileSize != null && <> · {formatBytes(material.fileSize)}</>}
            </span>
          )}
          <span>Created {formatDateTime(material.createdAt)}</span>
          <span>Updated {formatDateTime(material.updatedAt)}</span>
        </div>
        {material.description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{material.description}</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Academic scope</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              <BookOpen className="size-4 shrink-0 text-muted-foreground" />
              <ScopeBreadcrumb
                subjectId={material.subjectId}
                chapterId={material.chapterId}
                topicId={material.topicId}
              />
              {!material.subjectId && !material.chapterId && !material.topicId && (
                <span className="text-muted-foreground">Not attached to any academic scope</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Processing</CardTitle>
          </CardHeader>
          <CardContent>
            <ProcessingLifecycle
              material={material}
              isProcessing={isProcessing}
              enhanced={enhancement !== null}
              cancelling={cancelling}
              onCancel={cancelProcessing}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Source and extracted text</CardTitle>
        </CardHeader>
        <CardContent>
          <SourceContent material={material} onProcess={processMaterial} onRetry={retryMaterial} />
        </CardContent>
      </Card>

      {material.sourceType === 'UPLOAD' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">OCR inspection</CardTitle>
          </CardHeader>
          <CardContent>
            <OcrInspection
              materialId={material.id}
              processingStatus={material.processingStatus}
              canEdit={isTeacher}
              onRetry={retryMaterial}
              onChanged={refresh}
            />
          </CardContent>
        </Card>
      )}

      <MaterialIntelligenceCard
        material={material}
        enhancement={enhancement}
        enhancing={enhancing}
        segmentsOpen={segmentsOpen}
        onToggleSegments={() => setSegmentsOpen((o) => !o)}
        onEnhance={enhanceMaterial}
        isTeacher={isTeacher}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Generated resources</CardTitle>
        </CardHeader>
        <CardContent>
          <GeneratedResources material={material} genStatus={genStatus} />
        </CardContent>
      </Card>

      <EditMaterialDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        material={material}
        onSaved={() => {
          setEditOpen(false);
          refresh();
          loadGenStatus();
        }}
      />

      <ConfirmDialog
        open={confirmAction === 'archive'}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Archive material?"
        description="This material will no longer be available for content generation."
        confirmLabel="Archive"
        destructive
        onConfirm={archiveMaterial}
      />
      <ConfirmDialog
        open={confirmAction === 'activate'}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Activate material?"
        description="This material will be available for content generation."
        confirmLabel="Activate"
        onConfirm={activateMaterial}
      />
    </div>
  );
}

function ProcessingLifecycle({
  material,
  isProcessing,
  enhanced,
  cancelling,
  onCancel,
}: {
  material: MaterialResponse;
  isProcessing: boolean;
  enhanced: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const currentStep = PROCESSING_STEPS.findIndex((s) => s.status === material.processingStatus);
  const failed = material.processingStatus === 'FAILED';
  const textMaterial = material.sourceType === 'TEXT';

  const description: Record<string, string> = {
    UPLOADED: 'File uploaded. Process it to extract text.',
    QUEUED: 'Waiting for the processing worker.',
    PROCESSING: 'Extracting text from the file…',
    READY: textMaterial
      ? 'Text material — no processing needed.'
      : 'Processing complete. Text is available and content can be generated.',
    FAILED: 'Processing failed. See the error below; retry after resolving the issue.',
  };

  const progress =
    failed || currentStep < 0 ? 100 : (currentStep / (PROCESSING_STEPS.length - 1)) * 100;

  return (
    <div className="space-y-3">
      {textMaterial ? (
        <p className="text-sm text-muted-foreground">
          Created as a text material — text is stored directly and needs no OCR processing.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {PROCESSING_STEPS.map((step, i) => {
              const reached = currentStep >= i && !failed;
              return (
                <span
                  key={step.status}
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    reached
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
              );
            })}
            {failed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                <AlertTriangle className="size-3" /> Failed
              </span>
            )}
            {enhanced && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                <Sparkles className="size-3" /> Enhanced
              </span>
            )}
          </div>
          <Progress value={progress} />
          {isProcessing && material.processJobId && (
            <div className="flex items-center gap-2">
              {cancelling ? (
                <Button size="sm" variant="outline" disabled>
                  <Loader2 className="size-3.5 animate-spin" /> Cancelling…
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={onCancel}>
                  <Ban className="size-3.5" /> Cancel Processing
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Status:</span>
        <StatusBadge status={material.processingStatus} />
        {isProcessing && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>

      {material.processingStatus === 'FAILED' && material.processError && (
        <p className="text-sm text-destructive">Error: {material.processError}</p>
      )}

      <p className="text-sm text-muted-foreground">{description[material.processingStatus]}</p>

      {material.processStartedAt && (
        <p className="text-sm text-muted-foreground">
          Started: {formatDateTime(material.processStartedAt)}
        </p>
      )}
      {material.processCompletedAt && (
        <p className="text-sm text-muted-foreground">
          Completed: {formatDateTime(material.processCompletedAt)}
        </p>
      )}
    </div>
  );
}

function SourceContent({
  material,
  onProcess,
  onRetry,
}: {
  material: MaterialResponse;
  onProcess: () => void;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = material.textContent;
  const isUpload = material.sourceType === 'UPLOAD';

  if (text) {
    const preview = expanded ? text : text.length > 600 ? `${text.slice(0, 600)}…` : text;
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {isUpload
            ? `Extracted plaintext from ${material.fileName ?? 'the uploaded file'} by the processing pipeline.`
            : 'Source text supplied when this material was created.'}
        </p>
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm">
          {preview}
        </pre>
        {text.length > 600 && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show less' : `Show full text (${text.length.toLocaleString()} chars)`}
          </Button>
        )}
      </div>
    );
  }

  if (isUpload && material.processingStatus === 'UPLOADED') {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          The file is uploaded but has not been processed yet. Process it to extract the text.
        </span>
        <Button size="sm" onClick={onProcess}>
          <Play className="mr-1 size-3.5" /> Process
        </Button>
      </div>
    );
  }

  if (isUpload && material.processingStatus === 'FAILED') {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Text extraction failed. Check the error above and retry.
        </span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-1 size-3.5" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {isUpload
        ? 'No extracted text yet — it will appear here once processing completes.'
        : 'No text is available for this material.'}
    </p>
  );
}

function GeneratedResources({
  material,
  genStatus,
}: {
  material: MaterialResponse;
  genStatus: ContentGenerationStatusResponse | null;
}) {
  const ready = material.processingStatus === 'READY' && material.status === 'ACTIVE';
  const router = useRouter();

  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground">
        Learning content can be generated once the material is processed (READY).{' '}
        {material.processingStatus === 'FAILED'
          ? 'Resolve the processing error first.'
          : 'Check the processing section above.'}
      </p>
    );
  }

  const staleCount = (genStatus?.resources ?? []).filter((r) => r.stale).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {genStatus
          ? `Resources generated from this material · revision ${genStatus.materialRevision}. They are owned by the topic — generate new ones or regenerate from the topic page.`
          : 'Loading generated resources…'}
      </p>

      {staleCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {staleCount} generated resource{staleCount > 1 ? 's have' : ' has'} not been regenerated
            after the latest material change — regenerate for accuracy.
          </span>
        </div>
      )}

      {genStatus === null ? null : (
        <>
          {genStatus.questions.total > 0 && (
            <p className="text-sm text-muted-foreground">
              {genStatus.questions.total} question
              {genStatus.questions.total > 1 ? 's' : ''} generated from this material ·{' '}
              <span className="text-amber-600">{genStatus.questions.pending} pending review</span> ·{' '}
              <span className="text-emerald-600">{genStatus.questions.approved} approved</span>
            </p>
          )}
          <ul className="divide-y">
            {RESOURCE_TYPES.map(({ type, label }) => {
              const item = genStatus.items.find((i) => i.type === type);
              const hasContent = Boolean(item?.contentId);
              const rows = genStatus.resources.filter((r) => r.type === type);
              return (
                <li key={type} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-md bg-muted">
                      <BookOpen className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{label}</p>
                      <StateLine item={item} />
                    </div>
                    {hasContent && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => item?.contentId && router.push(`/content/${item.contentId}`)}
                      >
                        <Eye className="mr-1 size-3.5" /> Open
                      </Button>
                    )}
                  </div>

                  {rows.length > 1 && (
                    <ul className="mt-2 space-y-1 border-l pl-6">
                      {rows.map((row) => (
                        <li
                          key={`${row.contentId}-${row.version}`}
                          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                        >
                          <span className="font-mono">v{row.version}</span>
                          <ResourceBadge stale={row.stale} />
                          <span>
                            {row.changeType === 'REGENERATION' ? 'regenerated' : 'generated'}
                            {row.generatedAt ? ` ${formatDateTime(row.generatedAt)}` : ''}
                          </span>
                          <span>source revision {row.sourceRevision ?? '—'}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto px-1.5 py-0.5"
                            onClick={() => router.push(`/content/${row.contentId}`)}
                          >
                            Open
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ResourceBadge({ stale }: { stale: boolean }) {
  return stale ? (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
      STALE
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
      ACTIVE
    </span>
  );
}

function StateLine({ item }: { item: ContentGenerationStatus | undefined }) {
  if (!item) return <p className="text-xs text-muted-foreground">Not generated yet</p>;
  if (item.state === 'generated') {
    return (
      <p className="text-xs text-emerald-600">
        Generated{item.generatedAt ? ` · ${formatDateTime(item.generatedAt)}` : ''} · v
        {item.version}
      </p>
    );
  }
  if (item.state === 'stale') {
    return (
      <p className="text-xs text-amber-600">
        Generated before the latest material change — regenerate for accuracy
      </p>
    );
  }
  if (item.state === 'generating') {
    return (
      <p className="text-xs text-muted-foreground animate-pulse">
        <Loader2 className="mr-1 inline size-3 animate-spin" /> Generating…
      </p>
    );
  }
  if (item.state === 'failed') {
    return <p className="text-xs text-destructive">Generation failed — try again</p>;
  }
  return <p className="text-xs text-muted-foreground">Not generated yet</p>;
}

function EditMaterialDialog({
  open,
  onOpenChange,
  material,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: MaterialResponse;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [cascade, setCascade] = useState<ScopeCascadeState>(emptyCascade());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(material.title);
      setDescription(material.description ?? '');
      setText(material.sourceType === 'TEXT' ? (material.textContent ?? '') : null);
      setCascade({
        subjectId: material.subjectId ?? '',
        chapterId: material.chapterId ?? '',
        topicId: material.topicId ?? '',
      });
    }
  }, [open, material]);

  const scopeChanged =
    cascade.subjectId !== (material.subjectId ?? '') ||
    cascade.chapterId !== (material.chapterId ?? '') ||
    cascade.topicId !== (material.topicId ?? '');
  const textChanged = text !== null && text !== (material.textContent ?? '');
  const sourceChanging = textChanged || scopeChanged;

  async function save() {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { title: title.trim() };
      if (description.trim()) body.description = description.trim();
      if (textChanged) body.text = text;
      if (scopeChanged) {
        body.subjectId = cascade.subjectId || undefined;
        body.chapterId = cascade.chapterId || undefined;
        body.topicId = cascade.topicId || undefined;
      }
      await api(`/materials/${material.id}`, { method: 'PATCH', body });
      toast.success(
        sourceChanging ? 'Material updated — generated resources marked stale' : 'Material updated',
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update material');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit material</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {sourceChanging && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Changing the source scope or text marks existing generated resources as stale.
                Material revision {material.revision} will become {material.revision + 1}.
              </span>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid gap-2">
            <Label>Academic scope</Label>
            <ScopeEditor cascade={cascade} onChange={setCascade} />
          </div>
          {text !== null && (
            <div className="grid gap-2">
              <Label htmlFor="edit-text">Source text</Label>
              <Textarea
                id="edit-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SEGMENT_LEVEL_STYLES: Record<string, string> = {
  relevant: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  uncertain: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  irrelevant: 'border-muted-foreground/30 bg-muted/50 text-muted-foreground',
  unmapped: 'border-muted-foreground/30 bg-muted/50 text-muted-foreground',
};

function MaterialIntelligenceCard({
  material,
  enhancement,
  enhancing,
  segmentsOpen,
  onToggleSegments,
  onEnhance,
  isTeacher,
}: {
  material: MaterialResponse;
  enhancement: MaterialEnhancementResponse | null;
  enhancing: boolean;
  segmentsOpen: boolean;
  onToggleSegments: () => void;
  onEnhance: () => void;
  isTeacher: boolean;
}) {
  const router = useRouter();
  const ready = material.processingStatus === 'READY' && material.status === 'ACTIVE';
  const topicPath =
    material.topicId && material.subjectId
      ? `/subjects/${material.subjectId}/topics/${material.topicId}`
      : null;

  const findings = enhancement?.payload.summary.findings;
  const segCount = enhancement ? enhancement.segments.length : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpen className="size-4 text-muted-foreground" />
          Material intelligence
          {enhancement && (
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              v{enhancement.version}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            Enhancement is available once the material is processed (READY).
          </p>
        ) : enhancing ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Enhancing the material…
          </p>
        ) : !enhancement ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Not enhanced yet. Enhancement detects chapters/sections, quality
              issues, and syllabus relevance as a versioned artifact — the
              source material is never modified.
            </span>
            {isTeacher && (
              <Button size="sm" onClick={onEnhance}>
                <Sparkles className="size-3.5" /> Enhance Material
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                Trigger <span className="capitalize">{enhancement.trigger.toLowerCase()}</span> ·{' '}
                {formatDateTime(enhancement.createdAt)}
              </span>
              {findings && (
                <span className="flex items-center gap-2">
                  {[
                    { level: 'keep', count: findings.keep, cls: 'text-emerald-600' },
                    { level: 'exclude', count: findings.exclude, cls: 'text-red-600' },
                    { level: 'review', count: findings.review, cls: 'text-amber-600' },
                  ].map((f) => (
                    <span key={f.level} className={f.cls}>
                      {f.count} {f.level}
                    </span>
                  ))}
                </span>
              )}
              <span>{segCount} segments</span>
            </div>

            {isTeacher && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={onEnhance} disabled={enhancing}>
                  <RefreshCw className="size-3.5" /> Re-enhance
                </Button>
                <Button size="sm" variant="outline" onClick={onToggleSegments}>
                  {segmentsOpen ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}{' '}
                  {segmentsOpen ? 'Hide segments' : `View segments (${segCount})`}
                </Button>
                {topicPath && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(topicPath)}
                  >
                    <ArrowUpRight className="size-3.5" /> Generate Derived Content
                  </Button>
                )}
              </div>
            )}

            {segmentsOpen && (
              <ul className="divide-y rounded-lg border">
                {enhancement.segments.map(({ segment, mappings }) => (
                  <li key={segment.segmentNo} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {segment.title ?? `Segment ${segment.segmentNo}`}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${
                          SEGMENT_LEVEL_STYLES[segment.level] ?? ''
                        }`}
                      >
                        {segment.level}
                      </span>
                      <span className="text-xs text-muted-foreground">{segment.kind}</span>
                      <span className="text-xs text-muted-foreground">
                        pages {segment.startPage}–{segment.endPage}
                      </span>
                    </div>
                    {segment.preview && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {segment.preview}
                      </p>
                    )}
                    {mappings.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {mappings.map((m, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {m.type === 'topic' && `Topic: ${m.topicName ?? m.topicId}`}
                            {m.type === 'chapter' && `Chapter: ${m.chapterName ?? m.chapterId}`}
                            {m.type === 'subject' && `Subject`}
                            {m.type === 'unit' && `Unit: ${m.unitTitle ?? ''}`}
                            <span className="text-muted-foreground/70">
                              {Math.round((m.confidence ?? 0) * 100)}%
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ScopeEditor({
  cascade,
  onChange,
}: {
  cascade: ScopeCascadeState;
  onChange: (cascade: ScopeCascadeState) => void;
}) {
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [chapters, setChapters] = useState<{ id: string; name: string; subjectId: string }[]>([]);
  const [topics, setTopics] = useState<{ id: string; name: string; chapterId: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ subjects: { id: string; name: string }[] }>('/academic/subjects')
      .then(({ subjects }) => !cancelled && setSubjects(subjects))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cascade.subjectId) {
      setChapters([]);
      return;
    }
    let cancelled = false;
    api<{ chapters: { id: string; name: string; subjectId: string }[] }>(
      `/academic/subjects/${cascade.subjectId}/chapters`,
    )
      .then(({ chapters }) => !cancelled && setChapters(chapters))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cascade.subjectId]);

  useEffect(() => {
    if (!cascade.chapterId) {
      setTopics([]);
      return;
    }
    let cancelled = false;
    api<{ topics: { id: string; name: string; chapterId: string }[] }>(
      `/academic/chapters/${cascade.chapterId}/topics`,
    )
      .then(({ topics }) => !cancelled && setTopics(topics))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cascade.chapterId]);

  return (
    <ScopeCascade
      cascade={cascade}
      subjects={subjects}
      chapters={chapters}
      topics={topics}
      onChange={onChange}
    />
  );
}
