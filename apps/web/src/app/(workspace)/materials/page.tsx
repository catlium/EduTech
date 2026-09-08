"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ materials: MaterialResponse[] }>("/materials", { signal: ctrl.signal })
      .then(({ materials }) => setMaterials(materials))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

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
    </div>
  );
}
