"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { ProcessingStatus } from "@/components/app/processing-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MaterialResponse } from "@catlium/contracts";

export default function MaterialsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSubjectId, setUploadSubjectId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ materials: MaterialResponse[] }>("/materials", { signal: ctrl.signal })
      .then(({ materials }) => setMaterials(materials))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!institute || !uploadFile) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      if (uploadSubjectId) form.append("subjectId", uploadSubjectId);
      await api<{ material: MaterialResponse }>("/materials/upload", {
        method: "POST",
        body: form,
      });
      toast.success("File uploaded — processing started");
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadSubjectId("");
      refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to upload file");
    } finally {
      setUploading(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!institute) return;
    setSubmitting(true);
    try {
      const body: Record<string, string> = { title, text };
      if (subjectId) body.subjectId = subjectId;
      await api<{ material: MaterialResponse }>("/materials/text", {
        method: "POST",
        body,
      });
      toast.success("Material created");
      setCreating(false);
      setTitle("");
      setText("");
      setSubjectId("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to create material");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Materials"
        description={`${materials.length} material${materials.length !== 1 ? "s" : ""}`}
        actions={
          isTeacher && (
            <Button size="sm" onClick={() => setCreating((v) => !v)}>
              <Plus className="mr-1 size-3.5" /> New Material
            </Button>
          )
        }
      />

      {creating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New Text Material</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Material title"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="text">Text</Label>
                <Textarea
                  id="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste or type content"
                  className="min-h-32"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="subjectId">Subject ID</Label>
                <Input
                  id="subjectId"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  placeholder="Optional subject id"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : materials.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="No materials yet"
          description="Create your first material to start organizing content."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {materials.map((material) => (
            <Card key={material.id}>
              <CardHeader>
                <CardTitle className="text-base">{material.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusBadge status={material.materialType} />
                  <ProcessingStatus processingStatus={material.processingStatus} />
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={material.status} />
                  <span className="text-muted-foreground">
                    Subject: {material.subjectId?.slice(0, 8)}
                  </span>
                </div>
                <p className="text-muted-foreground">{formatDate(material.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Upload File</CardTitle>
            <p className="text-sm text-muted-foreground">
              PDF, image or text file — processed locally (PyMuPDF + PaddleOCR),
              then ready for AI generation.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onUpload} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="file">File</Label>
                <Input
                  id="file"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown"
                  ref={fileInputRef}
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="uploadSubjectId">Subject ID</Label>
                <Input
                  id="uploadSubjectId"
                  value={uploadSubjectId}
                  onChange={(e) => setUploadSubjectId(e.target.value)}
                  placeholder="Optional subject id"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setUploadFile(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={uploading}>
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
