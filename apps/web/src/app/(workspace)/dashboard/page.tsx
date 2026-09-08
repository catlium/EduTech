"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, FileText, HelpCircle, ClipboardList, Plus } from "lucide-react";

import { api } from "@/lib/api";
import { canManage, useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { SubjectCard } from "@/components/app/subject-card";
import { EmptyState } from "@/components/app/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  SubjectResponse,
  MaterialResponse,
  QuestionListItem,
  AssessmentListItem,
} from "@catlium/contracts";

export default function DashboardPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [questions, setQuestions] = useState<QuestionListItem[]>([]);
  const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    void Promise.all([
      api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal }),
      api<{ materials: MaterialResponse[] }>("/materials", { signal: ctrl.signal }),
      api<{ questions: QuestionListItem[] }>("/questions", { signal: ctrl.signal }),
      api<{ assessments: AssessmentListItem[] }>("/assessments", { signal: ctrl.signal }),
    ]).then(([s, m, q, a]) => {
      setSubjects(s.subjects);
      setMaterials(m.materials);
      setQuestions(q.questions);
      setAssessments(a.assessments);
    });
    return () => ctrl.abort();
  }, [institute]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          isTeacher && (
            <div className="flex gap-2">
              <Button size="sm" asChild>
                <Link href="/subjects/new">
                  <Plus className="mr-1 size-3.5" /> New Subject
                </Link>
              </Button>
            </div>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard icon={BookOpen} label="Subjects" count={subjects.length} href={isTeacher ? "/subjects" : undefined} />
        <StatCard icon={FileText} label="Materials" count={materials.length} />
        <StatCard icon={HelpCircle} label="Questions" count={questions.length} />
        <StatCard icon={ClipboardList} label="Assessments" count={assessments.length} />
      </div>

      {isTeacher && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Recent Subjects</h2>
          {subjects.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-8" />}
              title="No subjects yet"
              description="Create your first subject to get started."
            >
              <Button size="sm" asChild>
                <Link href="/subjects/new">Create Subject</Link>
              </Button>
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.slice(0, 6).map((subject) => (
                <SubjectCard key={subject.id} subject={subject} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  count,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  href?: string;
}) {
  const inner = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{count}</div>
      </CardContent>
    </Card>
  );
  if (href) {
    return (
      <Link href={href} className="group block transition-shadow hover:shadow-md">
        {inner}
      </Link>
    );
  }
  return inner;
}