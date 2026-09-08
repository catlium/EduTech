"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ArrowLeft } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { ChapterTree } from "@/components/app/chapter-tree";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import type { SubjectResponse, ChapterResponse } from "@catlium/contracts";

export default function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [newChapterName, setNewChapterName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    Promise.all([
      api<{ subject: SubjectResponse }>(`/academic/subjects/${subjectId}`, { signal: ctrl.signal }),
      api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${subjectId}/chapters`, { signal: ctrl.signal }),
    ])
      .then(([s, c]) => {
        setSubject(s.subject);
        setChapters(c.chapters);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          toast.error("Failed to load subject");
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, subjectId]);

  async function addChapter() {
    if (!newChapterName.trim()) return;
    setAdding(true);
    try {
      const slug = newChapterName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const { chapter } = await api<{ chapter: ChapterResponse }>(
        `/academic/subjects/${subjectId}/chapters`,
        { method: "POST", body: { name: newChapterName.trim(), slug } },
      );
      setChapters((prev) => [...prev, chapter]);
      setNewChapterName("");
      toast.success("Chapter added");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to add chapter");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>;
  }
  if (!subject) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Subject not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.replace("/subjects")}>
          <ArrowLeft className="mr-1 size-3.5" /> Subjects
        </Button>
        <PageHeader
          title={subject.name}
        />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge status={subject.status} />
          <span>{subject.description ?? subject.slug}</span>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            Chapters ({chapters.length})
          </h2>
        </div>

        {isTeacher && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newChapterName}
              onChange={(e) => setNewChapterName(e.target.value)}
              placeholder="New chapter name..."
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addChapter();
                }
              }}
            />
            <Button size="sm" disabled={adding || !newChapterName.trim()} onClick={addChapter}>
              <Plus className="mr-1 size-3.5" /> Add
            </Button>
          </div>
        )}

        <ChapterTree
          subjectId={subjectId}
          isTeacher={isTeacher}
          chapters={chapters.sort((a, b) => a.sortOrder - b.sortOrder)}
        />
      </section>
    </div>
  );
}