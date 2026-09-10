"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Plus } from "lucide-react";

import { api } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { SubjectCard } from "@/components/app/subject-card";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCards } from "@/components/app/loading";
import { ErrorState } from "@/components/app/error-state";
import { Button } from "@/components/ui/button";
import type { SubjectResponse } from "@catlium/contracts";

export default function SubjectsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Failed to load subjects. Please try again.");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  };

  useEffect(() => {
    const cleanup = load();
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institute]);

  const subjectExamples =
    subjects.length > 0
      ? subjects
          .slice(0, 3)
          .map((s) => s.name)
          .join(", ")
      : "";

  return (
    <div>
      <PageHeader
        title="Subjects"
        description={
          subjects.length > 0
            ? `${subjects.length} subject${subjects.length !== 1 ? "s" : ""} \u00b7 ${subjectExamples}`
            : undefined
        }
        actions={
          isTeacher && (
            <Button size="sm" asChild>
              <Link href="/subjects/new">
                <Plus className="mr-1 size-3.5" /> New Subject
              </Link>
            </Button>
          )
        }
      />
      {loading ? (
        <SkeletonCards />
      ) : error ? (
        <ErrorState onRetry={() => load()} />
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No subjects yet"
          description="Create your first subject to start organizing your curriculum."
        >
          {isTeacher && (
            <Button size="sm" asChild>
              <Link href="/subjects/new">Create Subject</Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <SubjectCard key={subject.id} subject={subject} />
          ))}
        </div>
      )}
    </div>
  );
}
