"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  MoreHorizontal,
  Play,
  RefreshCw,
  Archive,
  Eye,
  CheckCircle2,
  X,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import {
  CreateTextMaterialRequestSchema,
  type CreateTextMaterialRequest,
  type MaterialResponse,
  type SubjectResponse,
  type ChapterResponse,
  type TopicResponse,
} from "@catlium/contracts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { ResourceCard } from "@/components/app/resource-card";
import { StatusBadge } from "@/components/app/status-badge";
import { SkeletonCards } from "@/components/app/loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type DialogMode = null | "text" | "upload";

interface ScopeState {
  subjects: SubjectResponse[];
  chapters: ChapterResponse[];
  topics: TopicResponse[];
  subjectId: string;
  chapterId: string;
  topicId: string;
}

function materialTypeLabel(m: MaterialResponse): string {
  if (m.fileName) {
    const ext = m.fileName.split(".").pop()?.toUpperCase();
    if (ext) return ext;
  }
  return m.materialType;
}

export default function MaterialsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scopeFilter, setScopeFilter] = useState(() => ({
    subjectId: searchParams.get("subject") ?? "",
    chapterId: searchParams.get("chapter") ?? "",
    topicId: searchParams.get("topic") ?? "",
  }));

  const [hierarchy, setHierarchy] = useState<{
    chapters: ChapterResponse[];
    topics: TopicResponse[];
  }>({ chapters: [], topics: [] });

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [submitting, setSubmitting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [processingFilter, setProcessingFilter] = useState<string>("all");

  const [scope, setScope] = useState<ScopeState>({
    subjects: [],
    chapters: [],
    topics: [],
    subjectId: "",
    chapterId: "",
    topicId: "",
  });

  const uploadFileRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const textForm = useForm<CreateTextMaterialRequest>({
    resolver: zodResolver(CreateTextMaterialRequestSchema),
    defaultValues: { title: "", text: "" },
  });

  const fetchSubjects = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal })
      .then(({ subjects }) => setScope((s) => ({ ...s, subjects })))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    return fetchSubjects();
  }, [fetchSubjects]);

  useEffect(() => {
    if (scope.subjects.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      scope.subjects.map((s) =>
        api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${s.id}/chapters`, {
          signal: ctrl.signal,
        }),
      ),
    )
      .then(async (results) => {
        const chapters = results.flatMap((r) => r.chapters);
        setHierarchy((h) => ({ ...h, chapters }));
        return Promise.all(
          chapters.map((c) =>
            api<{ topics: TopicResponse[] }>(`/academic/chapters/${c.id}/topics`, {
              signal: ctrl.signal,
            }),
          ),
        );
      })
      .then((topicsResults) => {
        setHierarchy((h) => ({ ...h, topics: topicsResults.flatMap((r) => r.topics) }));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [scope.subjects]);

  const fetchChapters = useCallback(
    (subjectId: string) => {
      if (!subjectId) {
        setScope((s) => ({ ...s, chapters: [], topics: [], chapterId: "", topicId: "" }));
        return;
      }
      const ctrl = new AbortController();
      api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${subjectId}/chapters`, {
        signal: ctrl.signal,
      })
        .then(({ chapters }) =>
          setScope((s) => ({ ...s, chapters, topics: [], chapterId: "", topicId: "" })),
        )
        .catch(() => {});
      return () => ctrl.abort();
    },
    [],
  );

  const fetchTopics = useCallback(
    (chapterId: string) => {
      if (!chapterId) {
        setScope((s) => ({ ...s, topics: [], topicId: "" }));
        return;
      }
      const ctrl = new AbortController();
      api<{ topics: TopicResponse[] }>(`/academic/chapters/${chapterId}/topics`, {
        signal: ctrl.signal,
      })
        .then(({ topics }) => setScope((s) => ({ ...s, topics, topicId: "" })))
        .catch(() => {});
      return () => ctrl.abort();
    },
    [],
  );

  const refresh = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (processingFilter !== "all") params.set("processingStatus", processingFilter);
    if (scopeFilter.topicId) params.set("topicId", scopeFilter.topicId);
    else if (scopeFilter.chapterId) params.set("chapterId", scopeFilter.chapterId);
    else if (scopeFilter.subjectId) params.set("subjectId", scopeFilter.subjectId);
    const qs = params.toString();
    api<{ materials: MaterialResponse[] }>(`/materials${qs ? `?${qs}` : ""}`, {
      signal: ctrl.signal,
    })
      .then(({ materials }) => setMaterials(materials))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Failed to load materials");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, statusFilter, processingFilter, scopeFilter]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  useEffect(() => {
    if (materials.length === 0) return;
    const polling = materials.filter(
      (m) => m.processingStatus === "QUEUED" || m.processingStatus === "PROCESSING",
    );
    if (polling.length === 0) return;
    const ctrl = new AbortController();
    const id = setInterval(() => {
      api<{ materials: MaterialResponse[] }>("/materials", { signal: ctrl.signal })
        .then(({ materials }) => setMaterials(materials))
        .catch(() => {});
    }, 3000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [materials]);

  const scopeId = scope.topicId || scope.chapterId || scope.subjectId;

  const subjectNames = new Map(scope.subjects.map((s) => [s.id, s.name]));
  const chapterNames = new Map(hierarchy.chapters.map((c) => [c.id, c.name]));
  const topicNames = new Map(hierarchy.topics.map((t) => [t.id, t.name]));

  function materialScopeLabel(m: MaterialResponse): string {
    if (m.topicId) return topicNames.get(m.topicId) ?? m.topicId.slice(0, 8);
    if (m.chapterId) return chapterNames.get(m.chapterId) ?? m.chapterId.slice(0, 8);
    if (m.subjectId) return subjectNames.get(m.subjectId) ?? m.subjectId.slice(0, 8);
    return "Unscoped";
  }

  const filterLabel =
    (scopeFilter.topicId && topicNames.get(scopeFilter.topicId)) ||
    (scopeFilter.chapterId && chapterNames.get(scopeFilter.chapterId)) ||
    (scopeFilter.subjectId && subjectNames.get(scopeFilter.subjectId)) ||
    "selected scope";

  function clearScopeFilter() {
    setScopeFilter({ subjectId: "", chapterId: "", topicId: "" });
  }

  function applyScope(field: "subjectId" | "chapterId" | "topicId", value: string) {
    textForm.setValue(field, value);
    if (field !== "subjectId") textForm.setValue("subjectId", undefined);
    if (field !== "chapterId") textForm.setValue("chapterId", undefined);
    if (field !== "topicId") textForm.setValue("topicId", undefined);
  }

  async function onCreateText(values: CreateTextMaterialRequest) {
    if (!scopeId) {
      toast.error("Select a subject, chapter, or topic");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, string> = { title: values.title, text: values.text };
      if (values.topicId) body.topicId = values.topicId;
      else if (values.chapterId) body.chapterId = values.chapterId;
      else body.subjectId = values.subjectId!;
      await api<{ material: MaterialResponse }>("/materials/text", {
        method: "POST",
        body,
      });
      toast.success("Text material created");
      setDialogMode(null);
      textForm.reset();
      setScope((s) => ({ ...s, subjectId: "", chapterId: "", topicId: "" }));
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create material");
    } finally {
      setSubmitting(false);
    }
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    if (uploadFile.size > 20 * 1024 * 1024) {
      toast.error("File exceeds 20 MB limit");
      return;
    }
    if (!scopeId) {
      toast.error("Select a subject, chapter, or topic");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      if (scope.topicId) form.append("topicId", scope.topicId);
      else if (scope.chapterId) form.append("chapterId", scope.chapterId);
      else form.append("subjectId", scope.subjectId);
      await api<{ material: MaterialResponse }>("/materials/upload", {
        method: "POST",
        body: form,
      });
      toast.success("File uploaded");
      setDialogMode(null);
      setUploadFile(null);
      if (uploadFileRef.current) uploadFileRef.current.value = "";
      setScope((s) => ({ ...s, subjectId: "", chapterId: "", topicId: "" }));
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to upload file");
    } finally {
      setSubmitting(false);
    }
  }

  async function processMaterial(materialId: string) {
    try {
      await api(`/materials/${materialId}/process`, { method: "POST" });
      toast.success("Processing started");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start processing");
    }
  }

  async function retryMaterial(materialId: string) {
    try {
      await api(`/materials/${materialId}/retry`, { method: "POST" });
      toast.success("Retry started");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to retry");
    }
  }

  async function archiveMaterial(materialId: string) {
    try {
      await api(`/materials/${materialId}/archive`, { method: "POST" });
      toast.success("Material archived");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to archive");
    }
  }

  async function activateMaterial(materialId: string) {
    try {
      await api(`/materials/${materialId}/activate`, { method: "POST" });
      toast.success("Material activated");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to activate");
    }
  }

  function scopeSelects() {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label>Subject</Label>
          <Select
            value={scope.subjectId}
            onValueChange={(v) => {
              setScope((s) => ({ ...s, subjectId: v }));
              applyScope("subjectId", v);
              fetchChapters(v);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              {scope.subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Chapter</Label>
          <Select
            value={scope.chapterId}
            onValueChange={(v) => {
              setScope((s) => ({ ...s, chapterId: v }));
              applyScope("chapterId", v);
              fetchTopics(v);
            }}
            disabled={!scope.subjectId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select chapter" />
            </SelectTrigger>
            <SelectContent>
              {scope.chapters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Topic</Label>
          <Select
            value={scope.topicId}
            onValueChange={(v) => {
              setScope((s) => ({ ...s, topicId: v }));
              applyScope("topicId", v);
            }}
            disabled={!scope.chapterId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select topic" />
            </SelectTrigger>
            <SelectContent>
              {scope.topics.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Materials" />
        <ErrorState description={error} onRetry={refresh} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Materials"
        description={`${materials.length} material${materials.length !== 1 ? "s" : ""}`}
        actions={
          isTeacher && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDialogMode("text")}>
                <FileText className="mr-1 size-3.5" /> Text material
              </Button>
              <Button size="sm" onClick={() => setDialogMode("upload")}>
                <Upload className="mr-1 size-3.5" /> Upload file
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(scopeFilter.subjectId || scopeFilter.chapterId || scopeFilter.topicId) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
            <p className="text-sm">Showing materials for:</p>
            <span className="text-sm font-medium">{filterLabel}</span>
            <Button size="sm" variant="ghost" onClick={clearScopeFilter}>
              <X className="mr-1 size-3.5" /> Clear
            </Button>
          </div>
        )}
        <Tabs value={processingFilter} onValueChange={setProcessingFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="UPLOADED">Uploaded</TabsTrigger>
            <TabsTrigger value="QUEUED">Queued</TabsTrigger>
            <TabsTrigger value="PROCESSING">Processing</TabsTrigger>
            <TabsTrigger value="READY">Ready</TabsTrigger>
            <TabsTrigger value="FAILED">Failed</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <SkeletonCards count={6} />
      ) : materials.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="No materials yet"
          description="Upload a learning material or paste text to get started."
        >
          {isTeacher && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDialogMode("text")}>
                Text material
              </Button>
              <Button size="sm" onClick={() => setDialogMode("upload")}>
                Upload file
              </Button>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {materials.map((m) => {
            const isProcessing = m.processingStatus === "QUEUED" || m.processingStatus === "PROCESSING";
            const menuItems: { label: string; icon: React.ReactNode; onClick: () => void; destructive?: boolean }[] = [];

            if (m.sourceType === "UPLOAD" && m.processingStatus === "UPLOADED") {
              menuItems.push({ label: "Process", icon: <Play className="size-4" />, onClick: () => processMaterial(m.id) });
            }
            if (m.processingStatus === "FAILED") {
              menuItems.push({ label: "Retry", icon: <RefreshCw className="size-4" />, onClick: () => retryMaterial(m.id) });
            }
            if (m.status === "ACTIVE") {
              menuItems.push({ label: "Archive", icon: <Archive className="size-4" />, onClick: () => archiveMaterial(m.id), destructive: true });
            } else {
              menuItems.push({ label: "Activate", icon: <CheckCircle2 className="size-4" />, onClick: () => activateMaterial(m.id) });
            }
            menuItems.push({ label: "View details", icon: <Eye className="size-4" />, onClick: () => router.push(`/materials/${m.id}`) });

            return (
              <ResourceCard
                key={m.id}
                icon={<FileText className="size-4" />}
                title={m.title}
                subtitle={`${materialTypeLabel(m)} · ${materialScopeLabel(m)} · ${formatDate(m.createdAt)}`}
                badges={
                  <>
                    <StatusBadge status={m.processingStatus} />
                    <StatusBadge status={m.status} />
                    {isProcessing && (
                      <span className="text-xs text-muted-foreground animate-pulse">updating…</span>
                    )}
                  </>
                }
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {menuItems.map((item) => (
                        <DropdownMenuItem
                          key={item.label}
                          onClick={item.onClick}
                          className={item.destructive ? "text-destructive" : undefined}
                        >
                          {item.icon}
                          <span className="ml-2">{item.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
                onClick={() => router.push(`/materials/${m.id}`)}
              />
            );
          })}
        </div>
      )}

      <Dialog open={dialogMode === "text"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Text Material</DialogTitle>
            <DialogDescription>Paste or type content directly.</DialogDescription>
          </DialogHeader>
          <Form {...textForm}>
            <form onSubmit={textForm.handleSubmit(onCreateText)} className="space-y-4">
              <FormField
                control={textForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Material title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={textForm.control}
                name="text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content *</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Paste or type content" className="min-h-32" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {scopeSelects()}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDialogMode(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !scopeId}>
                  {submitting ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "upload"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload File</DialogTitle>
            <DialogDescription>
              PDF, image, or document. Max 20 MB.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onUpload} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="upload-file">File *</Label>
              <Input
                id="upload-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.rtf,.doc,.docx,.xls,.xlsx"
                ref={uploadFileRef}
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                required
              />
              <p className="text-xs text-muted-foreground">Max 20 MB</p>
            </div>
            {scopeSelects()}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogMode(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !uploadFile || !scopeId}>
                {submitting ? "Uploading…" : "Upload"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
