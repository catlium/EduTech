"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import {
  BookOpen,
  FileText,
  HelpCircle,
  ClipboardList,
  Plus,
  Upload,
  Sparkles,
  FileCheck,
  ChevronRight,
} from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canManage, useTenant } from "@/lib/tenant";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { SubjectCard } from "@/components/app/subject-card";
import { EmptyState } from "@/components/app/empty-state";
import { SectionHeader } from "@/components/app/section-header";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { SkeletonCards, SkeletonRows } from "@/components/app/loading";
import { ErrorState } from "@/components/app/error-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type {
  SubjectResponse,
  MaterialResponse,
  QuestionListItem,
  AssessmentListItem,
} from "@catlium/contracts";

const PROCESSING_STATUSES = new Set(["UPLOADED", "QUEUED", "PROCESSING", "FAILED"]);

export default function DashboardPage() {
  const { institute } = useTenant();
  const { user } = useAuth();
  const isTeacher = canManage(institute);

  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [questions, setQuestions] = useState<QuestionListItem[]>([]);
  const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  const fetchData = useCallback(
    (signal?: AbortSignal) => {
      if (!institute) return;
      setLoading(true);
      setError(false);
      void Promise.all([
        api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal }),
        api<{ materials: MaterialResponse[] }>("/materials", { signal }),
        api<{ questions: QuestionListItem[] }>("/questions", { signal }),
        api<{ assessments: AssessmentListItem[] }>("/assessments", { signal }),
      ])
        .then(([s, m, q, a]) => {
          setSubjects(s.subjects);
          setMaterials(m.materials);
          setQuestions(q.questions);
          setAssessments(a.assessments);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(true);
          setLoading(false);
        });
    },
    [institute],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchData]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Loading your workspace…" />
        <SkeletonCards count={4} />
        <div className="mt-8">
          <SkeletonCards count={3} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <ErrorState onRetry={() => fetchData()} />
      </div>
    );
  }

  const processingMaterials = materials.filter((m) =>
    PROCESSING_STATUSES.has(m.processingStatus),
  );
  const hasProcessing = processingMaterials.length > 0;

const pendingQuestions = questions.filter((q) => q.approvalStatus === "PENDING");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${firstName}`}
        actions={
          <Button size="sm" asChild>
            <Link href="/subjects/new">
              <Plus className="mr-1 size-3.5" /> New Subject
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={BookOpen}
          label="Subjects"
          value={subjects.length}
          href="/subjects"
        />
        <StatCard
          icon={FileText}
          label="Materials"
          value={materials.length}
          href="/materials"
        />
        <StatCard
          icon={HelpCircle}
          label="Questions"
          value={questions.length}
          hint={pendingQuestions.length > 0 ? `${pendingQuestions.length} pending` : undefined}
          href="/questions"
        />
        <StatCard
          icon={ClipboardList}
          label="Assessments"
          value={assessments.length}
          href="/assessments"
        />
      </div>

      <section>
        <SectionHeader title="Quick actions" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/materials">
              <Upload className="mr-1.5 size-3.5" /> Upload material
            </Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/questions">
              <Sparkles className="mr-1.5 size-3.5" /> Generate questions
            </Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/assessments">
              <FileCheck className="mr-1.5 size-3.5" /> New assessment
            </Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/subjects/new">
              <Plus className="mr-1.5 size-3.5" /> New subject
            </Link>
          </Button>
        </div>
      </section>

      <Separator />

      <section>
        <SectionHeader
          title="Recent subjects"
          description={subjects.length > 0 ? `${subjects.length} total` : undefined}
        />
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

      <section>
        <SectionHeader
          title="Processing activity"
          description={hasProcessing ? `${processingMaterials.length} active` : undefined}
        />
        {hasProcessing ? (
          <div className="space-y-2">
            {processingMaterials.slice(0, 5).map((material) => (
              <Card key={material.id}>
                <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{material.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(material.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={material.processingStatus} />
                </CardContent>
              </Card>
            ))}
            {processingMaterials.length > 5 && (
              <Link
                href="/materials"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open materials <ChevronRight className="size-3.5" />
              </Link>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No materials currently processing
          </p>
        )}
      </section>

      <section>
        <SectionHeader
          title="Recent assessments"
          description={assessments.length > 0 ? `${assessments.length} total` : undefined}
        />
        {assessments.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-8" />}
            title="No assessments yet"
            description="Create your first assessment to get started."
          >
            <Button size="sm" asChild>
              <Link href="/assessments">Create assessment</Link>
            </Button>
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {assessments.slice(0, 3).map((assessment) => (
              <Card key={assessment.id}>
                <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{assessment.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {assessment.questionCount} question{assessment.questionCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <StatusBadge status={assessment.status} />
                </CardContent>
              </Card>
            ))}
            {assessments.length > 3 && (
              <Link
                href="/assessments"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View all assessments <ChevronRight className="size-3.5" />
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
