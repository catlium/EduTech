"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Play,
  RefreshCw,
  Archive,
  CheckCircle2,
  Loader2,
  Sparkles,
  Pencil,
  AlertTriangle,
  Eye,
  FileText,
  FileUp,
  BookOpen,
  Square,
  Undo2,
} from "lucide-react";

import { api, ApiError, waitForJob } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import type {
  MaterialResponse,
  MaterialProcessingStatus,
  ContentGenerationStatus,
  ContentGenerationStatusResponse,
  GenerationBatchResponse,
  GenerateBatchJobIds,
} from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import {
  ScopeBreadcrumb,
  ScopeCascade,
  type ScopeCascade as ScopeCascadeState,
  emptyCascade,
} from "@/components/app/scope-cascade";
import { ErrorState } from "@/components/app/error-state";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type JobState =
  | { status: "idle" }
  | { status: "running"; jobId: string; operation: string }
  | { status: "done"; contentId: string; operation: string }
  | { status: "error"; message: string };

const PROCESSING_STEPS: { status: MaterialProcessingStatus; label: string }[] = [
  { status: "UPLOADED", label: "Uploaded" },
  { status: "QUEUED", label: "Queued" },
  { status: "PROCESSING", label: "Processing" },
  { status: "READY", label: "Ready" },
];

const RESOURCE_TYPES: { type: string; label: string }[] = [
  { type: "NOTE", label: "Notes" },
  { type: "SUMMARY", label: "Summary" },
  { type: "FLASHCARD_SET", label: "Flashcards" },
  { type: "IMPORTANT_CONCEPTS", label: "Concepts" },
  { type: "CORNELL_NOTE", label: "Cornell Notes" },
];

const CONTENT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  RESOURCE_TYPES.map((t) => [t.type, t.label]),
);

const JOB_STATUS_CHIP: Record<string, { label: string; tone: "ok" | "err" | "warn" | "muted" }> = {
  queued: { label: "Queued", tone: "muted" },
  processing: { label: "Generating", tone: "warn" },
  cancelling: { label: "Cancelling…", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  failed: { label: "Failed", tone: "err" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

// CORNELL_NOTE has no single operation: it is generated via the package
// operation restricted to ["cornell"], routed through /content/generate-batch.
const TYPE_TO_OPERATION: Record<string, string | undefined> = {
  NOTE: "AI_GENERATE_NOTE",
  SUMMARY: "AI_GENERATE_SUMMARY",
  FLASHCARD_SET: "AI_GENERATE_FLASHCARDS",
  IMPORTANT_CONCEPTS: "AI_GENERATE_CONCEPTS",
  CORNELL_NOTE: "CORNELL_NOTE",
};

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

  const [job, setJob] = useState<JobState>({ status: "idle" });
  const [packageJob, setPackageJob] = useState<JobState>({ status: "idle" });
  const [confirmAction, setConfirmAction] = useState<"archive" | "activate" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [genStatus, setGenStatus] = useState<ContentGenerationStatusResponse | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<GenerationBatchResponse | null>(null);
  const [batchStarting, setBatchStarting] = useState(false);

  const refresh = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ material: MaterialResponse }>(`/materials/${materialId}`, { signal: ctrl.signal })
      .then(({ material }) => setMaterial(material))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Failed to load material");
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

  useEffect(() => {
    return refresh();
  }, [refresh]);

  useEffect(() => {
    return loadGenStatus();
  }, [loadGenStatus, job.status, packageJob.status, batchStatus?.active]);

  useEffect(() => {
    if (!institute || !batchId) return;
    const ctrl = new AbortController();
    const tick = () => {
      api<{ batch: GenerationBatchResponse }>(`/content/generation-batches/${batchId}`, {
        signal: ctrl.signal,
      })
        .then(({ batch }) => setBatchStatus(batch))
        .catch(() => {});
    };
    const id = setInterval(tick, 2500);
    tick();
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, [institute, batchId]);

  const isProcessing =
    material?.processingStatus === "QUEUED" || material?.processingStatus === "PROCESSING";

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

  async function startGenerate(operation: string) {
    setJob({ status: "running", jobId: "", operation });
    try {
      let jobId = "";
      if (operation === "CORNELL_NOTE") {
        // Cornell is a one-type package run (no single operation exists).
        const { batch } = await api<{ batch: GenerateBatchJobIds }>("/content/generate-batch", {
          method: "POST",
          body: { sourceType: "MATERIAL", sourceId: materialId, types: ["CORNELL_NOTE"] },
        });
        if (batch.jobIds.length === 0) {
          setJob({ status: "error", message: "A Cornell note is already being generated" });
          toast.info("Generated resources are already being generated");
          return;
        }
        jobId = batch.jobIds[0]!;
      } else {
        const resp = await api<{ generation: { jobId: string; operation: string } }>(
          "/content/generate",
          {
            method: "POST",
            body: { operation, sourceType: "MATERIAL", sourceId: materialId },
          },
        );
        jobId = resp.generation.jobId;
      }
      setJob({ status: "running", jobId, operation });
      const done = await waitForJob(() =>
        api<{ job: { status: string; result?: { contentId?: string; contentIds?: Record<string, string> } } }>(
          `/jobs/${jobId}`,
        ),
      );
      const contentId =
        done.job.result?.contentId ?? done.job.result?.contentIds?.["CORNELL_NOTE"] ?? "";
      setJob({ status: "done", contentId, operation });
      toast.success(`${operationLabel(operation)} created`);
      refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Generation failed";
      setJob({ status: "error", message: msg });
      toast.error(msg);
    }
  }

  async function startBatch(types: string[]) {
    setBatchStarting(true);
    try {
      const { batch } = await api<{ batch: GenerateBatchJobIds }>("/content/generate-batch", {
        method: "POST",
        body: { sourceType: "MATERIAL", sourceId: materialId, types },
      });
      setGenerateOpen(false);
      if (batch.jobIds.length === 0) {
        toast.info("Those resources are already being generated");
        return;
      }
      toast.success(
        `Started ${batch.jobIds.length} generation job${batch.jobIds.length > 1 ? "s" : ""}`,
      );
      setBatchId(batch.batchId);
      setBatchStatus(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start generation");
    } finally {
      setBatchStarting(false);
    }
  }

  async function cancelBatch() {
    if (!batchId) return;
    try {
      const { batch } = await api<{ batch: GenerationBatchResponse }>(
        `/content/generation-batches/${batchId}/cancel`,
        { method: "POST" },
      );
      setBatchStatus(batch);
      toast.success("Remaining jobs cancelled");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to cancel jobs");
    }
  }

  async function processMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/process`, { method: "POST" });
      toast.success("Processing started");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start processing");
    }
  }

  async function retryMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/retry`, { method: "POST" });
      toast.success("Retry started");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to retry");
    }
  }

  async function archiveMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/archive`, { method: "POST" });
      toast.success("Material archived");
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to archive");
    }
  }

  async function activateMaterial() {
    if (!material) return;
    try {
      await api(`/materials/${material.id}/activate`, { method: "POST" });
      toast.success("Material activated");
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to activate");
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error || !material) {
    return (
      <div>
        <PageHeader title="Material" />
        <ErrorState description={error ?? "Material not found."} onRetry={refresh} />
      </div>
    );
  }

  const typeLabel = material.fileName?.split(".").pop()?.toUpperCase() ?? material.materialType;

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => router.push("/materials")}
        >
          <ArrowLeft className="mr-1 size-3.5" /> Materials
        </Button>
        <PageHeader
          title={material.title}
          actions={
            isTeacher && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1 size-3.5" /> Edit
                </Button>
                {material.sourceType === "UPLOAD" && material.processingStatus === "UPLOADED" && (
                  <Button size="sm" onClick={processMaterial}>
                    <Play className="mr-1 size-3.5" /> Process
                  </Button>
                )}
                {(material.processingStatus === "FAILED" ||
                  material.processingStatus === "QUEUED") && (
                  <Button size="sm" variant="outline" onClick={retryMaterial}>
                    <RefreshCw className="mr-1 size-3.5" /> Retry
                  </Button>
                )}
                {material.status === "ACTIVE" ? (
                  <Button size="sm" variant="outline" onClick={() => setConfirmAction("archive")}>
                    <Archive className="mr-1 size-3.5" /> Archive
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setConfirmAction("activate")}>
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
          {material.sourceType === "GENERATED" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Starter material
            </span>
          )}
          <StatusBadge status={typeLabel} />
          <span className="flex items-center gap-1.5">
            <BookOpen className="size-3.5" /> Revision {material.revision}
          </span>
          {material.sourceType === "UPLOAD" && material.fileName && (
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
            <ProcessingLifecycle material={material} isProcessing={isProcessing} />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Generated resources</CardTitle>
        </CardHeader>
        <CardContent>
          <GeneratedResources
            material={material}
            genStatus={genStatus}
            job={job}
            packageJob={packageJob}
            batchStatus={batchStatus}
            batchStarting={batchStarting}
            onGenerate={startGenerate}
            onOpenGenerateDialog={() => setGenerateOpen(true)}
            onCancelBatch={cancelBatch}
          />
        </CardContent>
      </Card>

      <GenerateResourcesDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        genStatus={genStatus}
        onGenerate={startBatch}
        starting={batchStarting}
      />

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
        open={confirmAction === "archive"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Archive material?"
        description="This material will no longer be available for content generation."
        confirmLabel="Archive"
        destructive
        onConfirm={archiveMaterial}
      />
      <ConfirmDialog
        open={confirmAction === "activate"}
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
}: {
  material: MaterialResponse;
  isProcessing: boolean;
}) {
  const currentStep = PROCESSING_STEPS.findIndex((s) => s.status === material.processingStatus);
  const failed = material.processingStatus === "FAILED";
  const textMaterial = material.sourceType === "TEXT";

  const description: Record<string, string> = {
    UPLOADED: "File uploaded. Process it to extract text.",
    QUEUED: "Waiting for the processing worker.",
    PROCESSING: "Extracting text from the file…",
    READY: textMaterial
      ? "Text material — no processing needed."
      : "Processing complete. Text is available and content can be generated.",
    FAILED: "Processing failed. See the error below; retry after resolving the issue.",
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
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "text-muted-foreground"
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
          </div>
          <Progress value={progress} />
        </>
      )}

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Status:</span>
        <StatusBadge status={material.processingStatus} />
        {isProcessing && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>

      {material.processingStatus === "FAILED" && material.processError && (
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
  const isUpload = material.sourceType === "UPLOAD";

  if (text) {
    const preview = expanded ? text : text.length > 600 ? `${text.slice(0, 600)}…` : text;
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {isUpload
            ? `Extracted plaintext from ${material.fileName ?? "the uploaded file"} by the processing pipeline.`
            : "Source text supplied when this material was created."}
        </p>
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm">
          {preview}
        </pre>
        {text.length > 600 && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Show less" : `Show full text (${text.length.toLocaleString()} chars)`}
          </Button>
        )}
      </div>
    );
  }

  if (isUpload && material.processingStatus === "UPLOADED") {
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

  if (isUpload && material.processingStatus === "FAILED") {
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
        ? "No extracted text yet — it will appear here once processing completes."
        : "No text is available for this material."}
    </p>
  );
}

function GeneratedResources({
  material,
  genStatus,
  job,
  packageJob,
  batchStatus,
  batchStarting,
  onGenerate,
  onOpenGenerateDialog,
  onCancelBatch,
}: {
  material: MaterialResponse;
  genStatus: ContentGenerationStatusResponse | null;
  job: JobState;
  packageJob: JobState;
  batchStatus: GenerationBatchResponse | null;
  batchStarting: boolean;
  onGenerate: (operation: string) => void;
  onOpenGenerateDialog: () => void;
  onCancelBatch: () => void;
}) {
  const ready = material.processingStatus === "READY" && material.status === "ACTIVE";
  const generating = job.status === "running" || packageJob.status === "running" || batchStarting;
  const router = useRouter();

  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground">
        Learning content can be generated once the material is processed (READY).{" "}
        {material.processingStatus === "FAILED"
          ? "Resolve the processing error first."
          : "Check the processing section above."}
      </p>
    );
  }

  const staleCount = (genStatus?.resources ?? []).filter((r) => r.stale).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Content generated from this {genStatus ? `material · revision ${genStatus.materialRevision}`
            : "material."} Derived resources activate automatically — no approval needed.
        </p>
        <Button size="sm" disabled={generating} onClick={onOpenGenerateDialog}>
          <Sparkles className="mr-1 size-3.5" />
          Generate learning resources
        </Button>
      </div>

      <BatchProgressPanel batchStatus={batchStatus} onCancel={onCancelBatch} />

      {staleCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {staleCount} generated resource{staleCount > 1 ? "s have" : " has"} not been
            regenerated after the latest material change — regenerate for accuracy.
          </span>
        </div>
      )}

      {packageJob.status === "running" && (
        <p className="text-sm text-muted-foreground animate-pulse">
          Generating notes, summary, flashcards, concepts, and a Cornell note…
        </p>
      )}
      {packageJob.status === "error" && (
        <p className="text-sm text-destructive">{packageJob.message}</p>
      )}
      {job.status === "running" && (
        <p className="text-sm text-muted-foreground animate-pulse">
          Generating {operationLabel(job.operation)}…
        </p>
      )}
      {job.status === "error" && <p className="text-sm text-destructive">{job.message}</p>}
      {job.status === "done" && job.contentId && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{operationLabel(job.operation)} generated.</span>
          <Button size="sm" onClick={() => router.push(`/content/${job.contentId}`)}>
            <Eye className="mr-1 size-3.5" /> View
          </Button>
        </div>
      )}

      {genStatus === null ? (
        <p className="text-sm text-muted-foreground">Loading generated resources…</p>
      ) : (
        <>
          {genStatus.questions.total > 0 && (
            <p className="text-sm text-muted-foreground">
              {genStatus.questions.total} question
              {genStatus.questions.total > 1 ? "s" : ""} generated from this material ·{" "}
              <span className="text-amber-600">{genStatus.questions.pending} pending review</span> ·{" "}
              <span className="text-emerald-600">{genStatus.questions.approved} approved</span>
            </p>
          )}
          <ul className="divide-y">
            {RESOURCE_TYPES.map(({ type, label }) => {
              const item = genStatus.items.find((i) => i.type === type);
              const operation = TYPE_TO_OPERATION[type];
              const hasContent = Boolean(item?.contentId);
              const rows = genStatus.resources.filter((r) => r.type === type);
              const busyThis = job.status === "running" && job.operation === operation;
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
                    {!hasContent && item?.state !== "generating" && operation && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={generating}
                        onClick={() => onGenerate(operation)}
                      >
                        {busyThis ? (
                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1 size-3.5" />
                        )}
                        Generate
                      </Button>
                    )}
                    {!hasContent && !operation && (
                      <span className="text-xs text-muted-foreground">
                        Created with Generate all
                      </span>
                    )}
                    {hasContent && item?.state === "stale" && operation && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={generating}
                        onClick={() => onGenerate(operation)}
                      >
                        {busyThis ? (
                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1 size-3.5" />
                        )}
                        Regenerate
                      </Button>
                    )}
                  </div>

                  {rows.length > 1 && (
                    <ul className="mt-2 space-y-1 border-l pl-6">
                      {rows.map((row) => (
                        <li key={`${row.contentId}-${row.version}`} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">v{row.version}</span>
                          <ResourceBadge stale={row.stale} />
                          <span>
                            {row.changeType === "REGENERATION" ? "regenerated" : "generated"}
                            {row.generatedAt ? ` ${formatDateTime(row.generatedAt)}` : ""}
                          </span>
                          <span>source revision {row.sourceRevision ?? "—"}</span>
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

function BatchProgressPanel({
  batchStatus,
  onCancel,
}: {
  batchStatus: GenerationBatchResponse | null;
  onCancel: () => void;
}) {
  if (!batchStatus) return null;
  const active = batchStatus.jobs.filter((j) => j.status !== "completed" && j.status !== "failed" && j.status !== "cancelled");
  const failedJob = batchStatus.jobs.find((j) => j.status === "failed");

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Batch progress</p>
        {active.length > 0 ? (
          <Button size="sm" variant="outline" onClick={onCancel}>
            <Square className="mr-1 size-3.5" /> Cancel remaining
          </Button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {batchStatus.jobs.map((j) => {
          const chip = JOB_STATUS_CHIP[j.status] ?? { label: j.status, tone: "muted" };
          const tone =
            chip.tone === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
              : chip.tone === "err"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : chip.tone === "warn"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
                  : "border-border bg-muted text-muted-foreground";
          return (
            <span key={j.jobId} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>
              {j.status === "processing" || j.status === "cancelling" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : null}
              {CONTENT_TYPE_LABEL[j.type] ?? j.type}: {chip.label}
            </span>
          );
        })}
      </div>
      {failedJob?.error && (
        <p className="mt-2 text-xs text-destructive">{failedJob.error}</p>
      )}
      {active.length === 0 && (
        <p className="mt-2 text-xs text-emerald-600">
          All jobs finished.
          {batchStatus.failed > 0 || batchStatus.cancelled > 0
            ? ` ${batchStatus.failed} failed, ${batchStatus.cancelled} cancelled.`
            : ""}
        </p>
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
  if (item.state === "generated") {
    return (
      <p className="text-xs text-emerald-600">
        Generated{item.generatedAt ? ` · ${formatDateTime(item.generatedAt)}` : ""} · v{item.version}
      </p>
    );
  }
  if (item.state === "stale") {
    return (
      <p className="text-xs text-amber-600">
        Generated before the latest material change — regenerate for accuracy
      </p>
    );
  }
  if (item.state === "generating") {
    return (
      <p className="text-xs text-muted-foreground animate-pulse">
        <Loader2 className="mr-1 inline size-3 animate-spin" /> Generating…
      </p>
    );
  }
  if (item.state === "failed") {
    return <p className="text-xs text-destructive">Generation failed — try again</p>;
  }
  return <p className="text-xs text-muted-foreground">Not generated yet</p>;
}

function GenerateResourcesDialog({
  open,
  onOpenChange,
  genStatus,
  onGenerate,
  starting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  genStatus: ContentGenerationStatusResponse | null;
  onGenerate: (types: string[]) => void;
  starting: boolean;
}) {
  const items = genStatus?.items ?? [];
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      const notGenerated = items.filter((i) => i.state === "not_generated").map((i) => i.type);
      setSelected(notGenerated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (type: string) =>
    setSelected((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate learning resources</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Choose what to generate from this material. Content is derived strictly from what the
          material covers.
        </p>
        <div className="space-y-2">
          {RESOURCE_TYPES.map(({ type, label }) => {
            const item = items.find((i) => i.type === type);
            const already = item && (item.state === "generated" || item.state === "stale");
            return (
              <label
                key={type}
                className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selected.includes(type)}
                  onChange={() => toggle(type)}
                />
                <span className="flex-1 font-medium">{label}</span>
                {already && item && (
                  <span className={item.state === "stale" ? "text-xs text-amber-600" : "text-xs text-emerald-600"}>
                    {item.state === "stale" ? "stale — regenerate" : `v${item.version}`}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onGenerate(RESOURCE_TYPES.map((t) => t.type))} disabled={starting}>
            <Sparkles className="mr-1 size-3.5" /> Generate all
          </Button>
          <Button onClick={() => onGenerate(selected)} disabled={starting || selected.length === 0}>
            {starting ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            Generate {selected.length ? `${selected.length} selected` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [cascade, setCascade] = useState<ScopeCascadeState>(emptyCascade());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(material.title);
      setDescription(material.description ?? "");
      setText(material.sourceType === "TEXT" ? material.textContent ?? "" : null);
      setCascade({
        subjectId: material.subjectId ?? "",
        chapterId: material.chapterId ?? "",
        topicId: material.topicId ?? "",
      });
    }
  }, [open, material]);

  const scopeChanged =
    cascade.subjectId !== (material.subjectId ?? "") ||
    cascade.chapterId !== (material.chapterId ?? "") ||
    cascade.topicId !== (material.topicId ?? "");
  const textChanged = text !== null && text !== (material.textContent ?? "");
  const sourceChanging = textChanged || scopeChanged;

  async function save() {
    if (!title.trim()) {
      toast.error("Title is required");
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
      await api(`/materials/${material.id}`, { method: "PATCH", body });
      toast.success(sourceChanging ? "Material updated — generated resources marked stale" : "Material updated");
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update material");
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
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    api<{ subjects: { id: string; name: string }[] }>("/academic/subjects")
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

  return <ScopeCascade cascade={cascade} subjects={subjects} chapters={chapters} topics={topics} onChange={onChange} />;
}

function operationLabel(op: string): string {
  switch (op) {
    case "AI_GENERATE_NOTE":
      return "Notes";
    case "AI_GENERATE_SUMMARY":
      return "Summary";
    case "AI_GENERATE_FLASHCARDS":
      return "Flashcards";
    case "AI_GENERATE_CONCEPTS":
      return "Concepts";
    case "CORNELL_NOTE":
      return "Cornell Notes";
    default:
      return op;
  }
}