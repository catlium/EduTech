'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ClipboardList, Eye } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { PageLoader } from '@/components/app/loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  AssessmentResponse,
  AssessmentQuestion,
  PatternCoverageResponse,
  McqPayload,
} from '@catlium/contracts';

/* Student-facing paper preview. Renders exactly what a student sees: no
 * answers, no difficulty, no correct-choice markers, no explanations. */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function paperQuestion(q: AssessmentQuestion['question']) {
  const payload = (q.payload ?? {}) as Record<string, unknown>;
  switch (q.questionType) {
    case 'MCQ': {
      const mcq = payload as unknown as McqPayload;
      const choices = Array.isArray(mcq.choices) ? mcq.choices : [];
      return (
        <div className="mt-2 space-y-1.5">
          {choices.map((choice, i) => (
            <div
              key={choice.id}
              className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="mt-0.5 size-4 shrink-0 text-xs font-medium text-muted-foreground">
                {LETTERS[i] ?? '•'}.
              </span>
              <span>{choice.text}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'TRUE_FALSE':
    case 'FILL_IN_BLANK':
    case 'NUMERICAL':
    case 'MATCHING':
    default:
      return null;
  }
}

export default function AssessmentPreviewPage() {
  const params = useParams<{ assessmentId: string }>();
  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [coverage, setCoverage] = useState<PatternCoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      api<{ assessment: AssessmentResponse }>(`/assessments/${params.assessmentId}`, {
        signal: ctrl.signal,
      }),
      api<{ questions: AssessmentQuestion[] }>(`/assessments/${params.assessmentId}/questions`, {
        signal: ctrl.signal,
      }),
      api<{ coverage: PatternCoverageResponse | null }>(
        `/assessments/${params.assessmentId}/pattern-coverage`,
        { signal: ctrl.signal },
      ).catch(() => ({ coverage: null })),
    ])
      .then(([a, q, c]) => {
        setAssessment(a.assessment);
        setQuestions(q.questions);
        setCoverage(c.coverage);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof ApiError ? err.message : 'Failed to load paper preview');
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [params.assessmentId]);

  useEffect(() => {
    const cleanup = fetchPreview();
    return () => cleanup?.();
  }, [fetchPreview]);

  const groups = useMemo(() => {
    const map = new Map<string, AssessmentQuestion[]>();
    for (const q of questions) {
      const section = q.section || 'General';
      const arr = map.get(section) ?? [];
      arr.push(q);
      map.set(section, arr);
    }
    return [...map.entries()].map(([name, items]) => ({
      name,
      items: items.sort((a, b) => a.sortOrder - b.sortOrder),
      coverageRow: coverage?.sections.find((s) => s.name === name),
    }));
  }, [questions, coverage]);

  if (loading) return <PageLoader />;

  if (error) {
    return (
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/assessments/${params.assessmentId}`}>
            <ArrowLeft className="mr-1 size-4" /> Back
          </Link>
        </Button>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!assessment) {
    return (
      <EmptyState
        icon={<Eye className="size-8" />}
        title="Paper not found"
        description="This assessment may have been deleted."
      />
    );
  }

  const attemptLine = (n: number, m: number) =>
    n < m ? `Attempt any ${n} of ${m} questions in this section.` : null;
  const instructions = (assessment.instructions as { text?: string } | null)?.text;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/assessments/${params.assessmentId}`}>
            <ArrowLeft className="mr-1 size-4" /> Back to assessment
          </Link>
        </Button>
        <Badge variant="outline" className="gap-1">
          <ClipboardList className="size-3" /> Preview — no answers shown
        </Badge>
      </div>

      <PageHeader title={assessment.title} description={assessment.description ?? undefined} />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="text-sm">
            {assessment.durationMinutes && (
              <span className="text-muted-foreground">
                Duration: {formatDuration(assessment.durationMinutes)}
              </span>
            )}{' '}
            {assessment.maxMarks && (
              <span className="text-muted-foreground"> · Max Marks: {assessment.maxMarks}</span>
            )}
          </div>
          {instructions && (
            <div className="mt-3 rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">Instructions</p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{instructions}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="No questions yet"
          description="Add questions from the Question Bank (or auto-select from the pattern) before previewing."
        />
      ) : (
        groups.map(({ name, items, coverageRow }) => {
          const line = coverageRow
            ? attemptLine(coverageRow.attemptCount, coverageRow.requiredCount)
            : null;
          return (
            <Card key={name} className="mb-6">
              <CardContent className="pt-5">
                <h3 className="text-sm font-semibold">{name}</h3>
                {line && <p className="mt-0.5 text-xs text-muted-foreground">{line}</p>}
                <div className="mt-3 space-y-4">
                  {items.map(({ id, marks, question }, i) => (
                    <div key={id} className="border-b pb-3 last:border-b-0 last:pb-0">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-sm font-medium">
                          {i + 1}.
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="whitespace-pre-wrap">{question.stem}</p>
                          {paperQuestion(question)}
                        </div>
                      </div>
                      <p className="ml-6 mt-1 text-xs text-muted-foreground">{marks} mark{marks !== 1 ? 's' : ''}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}