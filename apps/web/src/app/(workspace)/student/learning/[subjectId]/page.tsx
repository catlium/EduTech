"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen, ChevronRight } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCards, SkeletonRows } from "@/components/app/loading";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
} from "@catlium/contracts";

export default function SubjectExplorerPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const { institute } = useTenant();
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [topicsByChapter, setTopicsByChapter] = useState<
    Record<string, TopicResponse[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!institute) return;
      setLoading(true);
      setLoadingTopics(false);
      setError(null);
      setNotFound(false);
      try {
        const [subj, chs] = await Promise.all([
          api<{ subject: SubjectResponse }>(`/academic/subjects/${subjectId}`, { signal }),
          api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${subjectId}/chapters`, {
            signal,
          }),
        ]);
        setSubject(subj.subject);
        setChapters(chs.chapters);
        setTopicsByChapter({});

        setLoadingTopics(true);
        try {
          const settled = await Promise.allSettled(
            chs.chapters.map((ch) =>
              api<{ topics: TopicResponse[] }>(`/academic/chapters/${ch.id}/topics`, { signal }),
            ),
          );
          const map: Record<string, TopicResponse[]> = {};
          chs.chapters.forEach((ch, i) => {
            map[ch.id] = settled[i]?.status === "fulfilled"
              ? settled[i].value.topics
              : [];
          });
          setTopicsByChapter(map);
        } finally {
          setLoadingTopics(false);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError("Failed to load subject. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    },
    [institute, subjectId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (!institute) return null;

  if (loading) {
    return <SkeletonCards count={2} />;
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <PageHeader title="Subject" />
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="Subject not found"
          description="This subject may have been removed or you don't have access to it."
        >
          <Button size="sm" asChild>
            <Link href="/student/learning">Back to My Subjects</Link>
          </Button>
        </EmptyState>
      </div>
    );
  }

  if (error && !subject) {
    return <ErrorState description={error} onRetry={() => void load()} />;
  }

  if (!subject) {
    return <ErrorState description="Subject not found." onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
          <Link href="/student/learning">
            <ArrowLeft className="mr-1.5 size-3.5" /> My Subjects
          </Link>
        </Button>
        <PageHeader title={subject.name} description={subject.description ?? undefined} />
      </div>

      {chapters.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No chapters yet"
          description="Check back when your teachers add chapters for this subject."
        >
          <Button size="sm" asChild>
            <Link href="/student/learning">Back to My Subjects</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {chapters.map((chapter) => {
            const topics = topicsByChapter[chapter.id];
            return (
              <Card key={chapter.id}>
                <CardHeader className="py-4">
                  <CardTitle className="text-base">{chapter.name}</CardTitle>
                  {chapter.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{chapter.description}</p>
                  )}
                </CardHeader>
                {loadingTopics ? (
                  <CardContent className="py-0 pb-4">
                    <SkeletonRows rows={2} />
                  </CardContent>
                ) : topics && topics.length > 0 ? (
                  <CardContent className="space-y-1 py-0 pb-4">
                    {topics.map((topic) => (
                      <Link
                        key={topic.id}
                        href={`/student/learning/${subjectId}/topics/${topic.id}`}
                        className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <span className="min-w-0 truncate">{topic.name}</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    ))}
                  </CardContent>
                ) : (
                  <CardContent className="py-0 pb-4">
                    <p className="px-3 py-2 text-sm text-muted-foreground">No topics yet</p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}