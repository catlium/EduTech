"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, BookMarked, BookOpen, Hash } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { ChapterTree } from "@/components/app/chapter-tree";
import { StatusBadge } from "@/components/app/status-badge";
import { SectionHeader } from "@/components/app/section-header";
import { StatCard } from "@/components/app/stat-card";
import { SkeletonCards } from "@/components/app/loading";
import { ErrorState } from "@/components/app/error-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SubjectResponse, ChapterResponse } from "@catlium/contracts";

export default function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showChapterDialog, setShowChapterDialog] = useState(false);
  const [newChapterName, setNewChapterName] = useState("");
  const [adding, setAdding] = useState(false);
  const [topicCount, setTopicCount] = useState(0);

  const load = useCallback(async () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        api<{ subject: SubjectResponse }>(`/academic/subjects/${subjectId}`),
        api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${subjectId}/chapters`),
      ]);
      setSubject(s.subject);
      setChapters(c.chapters);
      const total = await Promise.all(
        c.chapters.map((ch) =>
          api<{ topics: unknown[] }>(`/academic/chapters/${ch.id}/topics`).then(
            ({ topics }) => topics.length,
          ),
        ),
      );
      setTopicCount(total.reduce((a, b) => a + b, 0));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Failed to load subject. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [institute, subjectId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load();
    return () => ctrl.abort();
  }, [load]);

  async function addChapter() {
    const name = newChapterName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const { chapter } = await api<{ chapter: ChapterResponse }>(
        `/academic/subjects/${subjectId}/chapters`,
        { method: "POST", body: { name, slug } },
      );
      setChapters((prev) => [...prev, chapter]);
      setNewChapterName("");
      setShowChapterDialog(false);
      toast.success("Chapter added");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to add chapter");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return <SkeletonCards count={2} />;
  }
  if (error || !subject) {
    return <ErrorState description={error ?? "Subject not found."} onRetry={() => void load()} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={subject.name}
        description={subject.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={subject.status} />
            {isTeacher && (
              <Button size="sm" variant="outline" onClick={() => router.push(`/subjects/${subjectId}/syllabus`)}>
                <BookMarked className="mr-1 size-3.5" /> Syllabus
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard icon={BookOpen} label="Chapters" value={chapters.length} />
        <StatCard icon={Hash} label="Topics" value={topicCount} />
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Chapters"
          description={`${chapters.length} chapter${chapters.length !== 1 ? "s" : ""}`}
          actions={
            isTeacher && (
              <Button size="sm" variant="outline" onClick={() => setShowChapterDialog(true)}>
                <Plus className="mr-1 size-3.5" /> Add Chapter
              </Button>
            )
          }
        />
        <ChapterTree
          subjectId={subjectId}
          isTeacher={isTeacher}
          chapters={chapters.sort((a, b) => a.sortOrder - b.sortOrder)}
        />
      </section>

      <Dialog open={showChapterDialog} onOpenChange={setShowChapterDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add chapter</DialogTitle>
            <DialogDescription>
              Chapters organize topics within {subject.name}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newChapterName}
            onChange={(e) => setNewChapterName(e.target.value)}
            placeholder="Chapter name..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addChapter();
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowChapterDialog(false)} disabled={adding}>
              Cancel
            </Button>
            <Button disabled={adding || !newChapterName.trim()} onClick={() => void addChapter()}>
              {adding ? "Adding..." : "Add Chapter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
