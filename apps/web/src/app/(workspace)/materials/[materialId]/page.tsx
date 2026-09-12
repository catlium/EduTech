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
} from "lucide-react";

import { api, ApiError, waitForJob } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import type {
  MaterialResponse,
  ContentGenerationStatus,
  ContentGenerationStatusResponse,
} from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ErrorState } from "@/components/app/error-state";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type JobState =
  | { status: "idle" }
  | { status: "running"; jobId: string; operation: string }
  | { status: "done"; contentId: string; operation: string }
  | { status: "error"; message: string };

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
  const [genStatus, setGenStatus] = useState<ContentGenerationStatus[] | null>(null);

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

  useEffect(() => {
    return refresh();
  }, [refresh]);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<ContentGenerationStatusResponse>(`/content/generation-status?materialId=${materialId}`, {
      signal: ctrl.signal,
    })
      .then((resp) => setGenStatus(resp.items))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute, materialId, packageJob.status, job.status]);

  const isProcessing = material?.processingStatus === "QUEUED" || material?.processingStatus === "PROCESSING";

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
      const resp = await api<{ generation: { jobId: string; operation: string } }>(
        "/content/generate",
        {
          method: "POST",
          body: { operation, sourceType: "MATERIAL", sourceId: materialId },
        },
      );
      const jobId = resp.generation.jobId;
      setJob({ status: "running", jobId, operation });
      const done = await waitForJob(() =>
        api<{ job: { status: string; result?: { contentId?: string } } }>(`/jobs/${jobId}`),
      );
      const contentId = done.job.result?.contentId ?? "";
      setJob({ status: "done", contentId, operation });
      toast.success(`${operationLabel(operation)} created`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Generation failed";
      setJob({ status: "error", message: msg });
      toast.error(msg);
    }
  }

  async function startGeneratePackage() {
    setPackageJob({ status: "running", jobId: "", operation: "AI_GENERATE_CONTENT_PACKAGE" });
    try {
      const resp = await api<{ generation: { jobId: string } }>("/content/generate-package", {
        method: "POST",
        body: { sourceType: "MATERIAL", sourceId: materialId },
      });
      const jobId = resp.generation.jobId;
      setPackageJob({ status: "running", jobId, operation: "AI_GENERATE_CONTENT_PACKAGE" });
      await waitForJob(() =>
        api<{ job: { status: string } }>(`/jobs/${jobId}`),
      );
      setPackageJob({ status: "done", contentId: "", operation: "AI_GENERATE_CONTENT_PACKAGE" });
      toast.success("Content package created");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Package generation failed";
      setPackageJob({ status: "error", message: msg });
      toast.error(msg);
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

  const typeLabel =
    material.fileName?.split(".").pop()?.toUpperCase() ?? material.materialType;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.push("/materials")}>
          <ArrowLeft className="mr-1 size-3.5" /> Materials
        </Button>
        <PageHeader title={material.title} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Type:</span>
            <StatusBadge status={typeLabel} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Processing:</span>
            <StatusBadge status={material.processingStatus} />
            {isProcessing && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          {material.processingStatus === "FAILED" && material.processError && (
            <p className="text-sm text-destructive">Error: {material.processError}</p>
          )}
          {material.processStartedAt && (
            <p className="text-muted-foreground">
              Started: {formatDateTime(material.processStartedAt)}
            </p>
          )}
          {material.processCompletedAt && (
            <p className="text-muted-foreground">
              Completed: {formatDateTime(material.processCompletedAt)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <StatusBadge status={material.status} />
          </div>
          {material.description && (
            <p className="text-muted-foreground">{material.description}</p>
          )}
          <p className="text-muted-foreground">Created: {formatDateTime(material.createdAt)}</p>
          <p className="text-muted-foreground">Updated: {formatDateTime(material.updatedAt)}</p>
        </div>

        {isTeacher && (
          <div className="flex flex-wrap gap-2">
            {material.sourceType === "UPLOAD" && material.processingStatus === "UPLOADED" && (
              <Button size="sm" onClick={processMaterial}>
                <Play className="mr-1 size-3.5" /> Process
              </Button>
            )}
            {(material.processingStatus === "FAILED" || material.processingStatus === "QUEUED") && (
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
        )}
      </div>

      <Separator />

      {material.processingStatus === "READY" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">AI Learning Content</h2>
          <p className="text-sm text-muted-foreground">
            Generate notes, summaries, flashcards, or concept maps from this material.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["AI_GENERATE_NOTE", "AI_GENERATE_SUMMARY", "AI_GENERATE_FLASHCARDS", "AI_GENERATE_CONCEPTS"] as const).map(
              (op) => (
                <Button
                  key={op}
                  size="sm"
                  variant="outline"
                  disabled={job.status === "running" || packageJob.status === "running"}
                  onClick={() => startGenerate(op)}
                >
                  {job.status === "running" && job.operation === op ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 size-3.5" />
                  )}
                  {operationLabel(op)}
                </Button>
              ),
            )}
            <Button
              size="sm"
              disabled={packageJob.status === "running" || job.status === "running"}
              onClick={() => startGeneratePackage()}
            >
              {packageJob.status === "running" ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 size-3.5" />
              )}
              Generate All
            </Button>
          </div>
          {packageJob.status === "running" && (
            <p className="text-sm text-muted-foreground animate-pulse">
              Generating package (notes, summary, flashcards, concepts)…
            </p>
          )}
          {packageJob.status === "error" && (
            <p className="text-sm text-destructive">{packageJob.message}</p>
          )}
          {genStatus && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {genStatus.map((item) => (
                <GenStatusLine key={item.type} item={item} />
              ))}
            </div>
          )}
          {job.status === "running" && (
            <p className="text-sm text-muted-foreground animate-pulse">
              Generating {operationLabel(job.operation)}…
            </p>
          )}
          {job.status === "done" && job.contentId && (
            <Button size="sm" onClick={() => router.push(`/content/${job.contentId}`)}>
              View {operationLabel(job.operation)}
            </Button>
          )}
          {job.status === "error" && (
            <p className="text-sm text-destructive">{job.message}</p>
          )}
        </div>
      )}

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
    default:
      return op;
  }
}

function GenStatusLine({ item }: { item: ContentGenerationStatus }) {
  const label = item.type.replace(/_/g, " ");
  const state =
    item.state === "not_generated"
      ? { text: "Not generated", className: "text-muted-foreground" }
      : item.state === "stale"
        ? { text: "Stale (regenerate)", className: "text-amber-600" }
        : item.state === "generated"
          ? { text: "Generated", className: "text-emerald-600" }
          : { text: item.state.replace(/_/g, " "), className: "text-muted-foreground" };
  return (
    <span className="inline-flex items-center gap-1.5 capitalize">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      <span className={state.className}>{label}</span>
      <span className="text-muted-foreground">·</span>
      <span className={state.className}>{state.text}</span>
      {item.contentId && (
        <span className="text-muted-foreground">v{item.version}</span>
      )}
    </span>
  );
}
