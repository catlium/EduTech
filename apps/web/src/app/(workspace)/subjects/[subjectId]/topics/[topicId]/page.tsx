"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, ExternalLink } from "lucide-react";

import { api } from "@/lib/api";
import { AppBreadcrumbs } from "@/components/app/app-breadcrumbs";
import { StatusBadge } from "@/components/app/status-badge";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCards } from "@/components/app/loading";
import { ErrorState } from "@/components/app/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
  MaterialResponse,
} from "@catlium/contracts";

export default function TopicPage() {
  const { subjectId, topicId } = useParams<{
    subjectId: string;
    topicId: string;
  }>();
  const router = useRouter();
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [chapter, setChapter] = useState<ChapterResponse | null>(null);
  const [topic, setTopic] = useState<TopicResponse | null>(null);
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { subject: s } = await api<{ subject: SubjectResponse }>(
        `/academic/subjects/${subjectId}`,
      );
      setSubject(s);

      const { chapters } = await api<{ chapters: ChapterResponse[] }>(
        `/academic/subjects/${subjectId}/chapters`,
      );

      let foundTopic: TopicResponse | null = null;
      let foundChapter: ChapterResponse | null = null;
      for (const ch of chapters) {
        const { topics } = await api<{ topics: TopicResponse[] }>(
          `/academic/chapters/${ch.id}/topics`,
        );
        const match = topics.find((t) => t.id === topicId);
        if (match) {
          foundTopic = match;
          foundChapter = ch;
          break;
        }
      }

      if (!foundTopic || !foundChapter) {
        setError("Topic not found.");
        return;
      }

      setTopic(foundTopic);
      setChapter(foundChapter);

      const { materials: mats } = await api<{ materials: MaterialResponse[] }>(
        `/materials?topicId=${topicId}`,
      );
      setMaterials(mats);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Failed to load topic. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [subjectId, topicId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load();
    return () => ctrl.abort();
  }, [load]);

  if (loading) {
    return <SkeletonCards count={2} />;
  }
  if (error || !topic || !subject || !chapter) {
    return <ErrorState description={error ?? "Topic not found."} onRetry={() => void load()} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => router.replace(`/subjects/${subjectId}`)}
        >
          <ArrowLeft className="mr-1 size-3.5" /> {subject.name}
        </Button>
        <AppBreadcrumbs
          items={[
            { label: "Subjects", href: "/subjects" },
            { label: subject.name, href: `/subjects/${subjectId}` },
            { label: chapter.name },
            { label: topic.name },
          ]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{topic.name}</h1>
          <StatusBadge status={topic.status} />
        </div>
        {topic.description && (
          <p className="text-sm text-muted-foreground">{topic.description}</p>
        )}
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Materials"
          description={
            materials.length > 0
              ? `${materials.length} material${materials.length !== 1 ? "s" : ""}`
              : undefined
          }
          actions={
            <Button size="sm" variant="outline" asChild>
              <Link href={`/materials?topic=${topicId}`}>
                Manage materials <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
          }
        />
        {materials.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" />}
            title="No materials yet"
            description="Upload or create materials for this topic from the Materials page."
          >
            <Button size="sm" asChild>
              <Link href={`/materials?topic=${topicId}`}>
                Go to Materials
              </Link>
            </Button>
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {materials.map((mat) => (
              <Card key={mat.id}>
                <CardContent className="p-0">
                  <Link
                    href={`/materials/${mat.id}`}
                    className="flex items-center gap-3 rounded-md p-3 hover:bg-accent/50"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{mat.title}</p>
                      <p className="text-xs text-muted-foreground">{mat.materialType}</p>
                    </div>
                    <StatusBadge status={mat.processingStatus} />
                    <StatusBadge status={mat.status} />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
