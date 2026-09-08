"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Plus } from "lucide-react";

import { api } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { SubjectCard } from "@/components/app/subject-card";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import type { SubjectResponse } from "@catlium/contracts";

export default function SubjectsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  return (
    <div>
      <PageHeader
        title="Subjects"
        description={`${subjects.length} subject${subjects.length !== 1 ? "s" : ""}`}
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
        <p className="text-sm text-muted-foreground">Loading...</p>
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