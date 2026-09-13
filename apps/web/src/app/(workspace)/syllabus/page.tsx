"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Upload, Library } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCards } from "@/components/app/loading";
import { ErrorState } from "@/components/app/error-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SubjectResponse, SyllabusResponse } from "@catlium/contracts";

type DialogMode = null | "text" | "upload";

export default function SyllabusListPage() {
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [syllabi, setSyllabi] = useState<SyllabusResponse[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [subjectId, setSubjectId] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ syllabi: SyllabusResponse[] }>("/syllabus"),
      api<{ subjects: SubjectResponse[] }>("/academic/subjects"),
    ])
      .then(([{ syllabi }, { subjects }]) => {
        setSyllabi(syllabi);
        setSubjects(subjects);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Failed to load syllabi. Please try again.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institute]);

  async function onCreateText() {
    if (submitting || !subjectId || !textTitle.trim() || !textBody.trim()) return;
    setSubmitting(true);
    try {
      const { syllabus } = await api<{ syllabus: SyllabusResponse }>("/syllabus/text", {
        method: "POST",
        body: { subjectId, title: textTitle.trim(), text: textBody },
      });
      toast.success("Text syllabus created");
      setDialogMode(null);
      setTextTitle("");
      setTextBody("");
      setSubjectId("");
      router.push(`/syllabus/${syllabus.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create syllabus");
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
    if (!subjectId || !uploadTitle.trim()) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("subjectId", subjectId);
      form.append("title", uploadTitle.trim());
      const { syllabus } = await api<{ syllabus: SyllabusResponse }>("/syllabus/upload", {
        method: "POST",
        body: form,
      });
      toast.success("File uploaded");
      setDialogMode(null);
      setUploadFile(null);
      setUploadTitle("");
      if (uploadFileRef.current) uploadFileRef.current.value = "";
      setSubjectId("");
      router.push(`/syllabus/${syllabus.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to upload file");
    } finally {
      setSubmitting(false);
    }
  }

  const subjectsWithSyllabus = new Set(syllabi.map((s) => s.subjectId));

  if (loading) {
    return <SkeletonCards count={3} />;
  }
  if (error) {
    return (
      <div>
        <PageHeader title="Syllabi" />
        <ErrorState description={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Syllabi"
        description={
          syllabi.length > 0
            ? `${syllabi.length} subject${syllabi.length !== 1 ? "s" : ""} with a syllabus`
            : "A subject never generates a syllabus — paste its text or upload the official document, extract the text, AI deep-analyzes it, and you confirm the structure."
        }
        actions={
          isTeacher && subjects.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDialogMode("text")}>
                <FileText className="mr-1 size-3.5" /> Text syllabus
              </Button>
              <Button size="sm" onClick={() => setDialogMode("upload")}>
                <Upload className="mr-1 size-3.5" /> Upload file
              </Button>
            </>
          )
        }
      />

      {syllabi.length === 0 ? (
        <EmptyState
          icon={<Library className="size-8" />}
          title="No syllabi yet"
          description="Paste the syllabus text or upload the official document. The file is processed to extract its text, then analyzed into a chapter structure you confirm."
        >
          {isTeacher && subjects.length > 0 && (
            <Button size="sm" onClick={() => setDialogMode("text")}>
              Create Syllabus
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {syllabi.map((syllabus) => (
            <Card key={syllabus.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2 text-base leading-snug">
                  <span className="line-clamp-2">{syllabus.title}</span>
                  <Badge variant="secondary" className="shrink-0">
                    v{syllabus.version}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                <div>
                  <p className="text-sm font-medium">{syllabus.subjectName}</p>
                  <p className="text-xs text-muted-foreground">
                    {syllabus.sourceType === "IMPORTED"
                      ? "imported"
                      : syllabus.sourceType === "UPLOAD"
                        ? syllabus.fileName ?? "file"
                        : "text"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge status={syllabus.status} />
                  <StatusBadge status={syllabus.processingStatus} />
                  <StatusBadge status={syllabus.analysisStatus} />
                </div>
              </CardContent>
              <CardFooter>
                <Button size="sm" variant="outline" className="w-full" asChild>
                  <Link href={`/syllabus/${syllabus.id}`}>Open</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}

          {isTeacher &&
            subjects
              .filter((subject) => !subjectsWithSyllabus.has(subject.id))
              .map((subject) => (
                <Card key={subject.id} className="flex flex-col border-dashed">
                  <CardHeader>
                    <CardTitle className="text-base leading-snug">{subject.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <p className="text-xs text-muted-foreground">No syllabus yet</p>
                  </CardContent>
                  <CardFooter>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setSubjectId(subject.id);
                        setDialogMode("text");
                      }}
                    >
                      <FileText className="mr-1 size-3.5" /> Add syllabus
                    </Button>
                  </CardFooter>
                </Card>
              ))}
        </div>
      )}

      <Dialog open={dialogMode === "text"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Text Syllabus</DialogTitle>
            <DialogDescription>
              Paste the official syllabus document text. It is immediately ready to analyze.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="text-subject">Subject *</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger id="text-subject">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="text-title">Title *</Label>
              <Input
                id="text-title"
                value={textTitle}
                placeholder="e.g. B.Sc. Computer Science — Semester I Syllabus"
                onChange={(e) => setTextTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="text-body">Content *</Label>
              <Textarea
                id="text-body"
                value={textBody}
                placeholder="Paste the syllabus text"
                className="min-h-40"
                onChange={(e) => setTextBody(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogMode(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !subjectId || !textTitle.trim() || !textBody.trim()}
                onClick={() => void onCreateText()}
              >
                {submitting ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "upload"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload File</DialogTitle>
            <DialogDescription>
              PDF, image, or document. Max 20 MB. Text is extracted from the file in the process step.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void onUpload(e)} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="upload-subject">Subject *</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger id="upload-subject">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="upload-title">Title *</Label>
              <Input
                id="upload-title"
                value={uploadTitle}
                placeholder="e.g. B.Sc. Computer Science — Semester I Syllabus"
                onChange={(e) => setUploadTitle(e.target.value)}
                required
              />
            </div>
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
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogMode(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !uploadFile || !subjectId || !uploadTitle.trim()}
              >
                {submitting ? "Uploading…" : "Upload"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}