"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SubjectResponse } from "@catlium/contracts";

const SOURCE_TYPES = ["MANUAL", "TEXT", "MATERIAL", "PREVIOUS_YEAR_PAPER"] as const;

export default function NewPaperPatternPage() {
  const router = useRouter();
  const { institute } = useTenant();
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<string>("MANUAL");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!institute || !subjectId) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { subjectId };
      if (title.trim()) body.title = title.trim();
      if (description.trim()) body.description = description.trim();
      if (sourceType !== "MANUAL") body.sourceType = sourceType;
      const { pattern } = await api<{ pattern: { id: string } }>("/paper-patterns", {
        method: "POST",
        body,
      });
      toast.success("Pattern created");
      router.push(`/paper-patterns/${pattern.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create pattern");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/paper-patterns">
            <ArrowLeft className="mr-1 size-3.5" /> Paper Patterns
          </Link>
        </Button>
      </div>
      <PageHeader title="New Paper Pattern" description="Create a new exam blueprint." />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid gap-2">
              <Label>Subject *</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g. Midterm Blueprint"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Optional description"
                className="resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Source type</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !subjectId}>
                {submitting ? "Creating..." : "Create Pattern"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
