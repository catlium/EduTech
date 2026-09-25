'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  CircleCheck,
  FileSearch,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import { api, ApiError, waitForJob } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { hasValidQuestionAnswer, isSupportedQuestionAnswerFormat } from '@/lib/question-answer';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState } from '@/components/app/error-state';
import { SkeletonRows } from '@/components/app/loading';
import { AnswerText } from '@/components/export/answer-text';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
  QuestionTypeDefinition,
  GenerateQuestionAnswerResponse,
  JobResponse,
  QuestionExtractionCandidate,
  QuestionExtractionCandidatesResponse,
  QuestionExtractionStatus,
} from '@catlium/contracts';

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const NULL_SCOPE = '__none__';

interface Draft {
  stem: string;
  difficulty: string;
  explanation: string;
  chapterId: string;
  topicId: string;
  payload: Record<string, unknown>;
}

interface AnswerGenerationState {
  status: 'requesting' | 'queued' | 'processing' | 'failed';
  jobId?: string;
  message?: string;
  retryable: boolean;
}

/* Seed the editable draft from a candidate row. */
function draftOf(c: QuestionExtractionCandidate): Draft {
  return {
    stem: c.stem,
    difficulty: c.difficulty,
    explanation: c.explanation ?? '',
    chapterId: c.chapterId ?? NULL_SCOPE,
    topicId: c.topicId ?? NULL_SCOPE,
    payload: structuredClone(c.payload),
  };
}

function issuesOf(
  c: QuestionExtractionCandidate,
  hasAnswer: boolean,
): { code: string; message: string }[] {
  return (c.provenance.issues ?? []).filter(
    (issue) => issue.code !== 'ANSWER_MISSING' || !hasAnswer,
  );
}

function answerActionLabel(state: AnswerGenerationState | undefined): string {
  if (!state) return 'Generate answer';
  if (state.status === 'requesting') return 'Starting…';
  if (state.status === 'queued') return 'Queued';
  if (state.status === 'processing') return 'Generating…';
  return state.retryable ? 'Retry answer' : 'Unavailable';
}

function PayloadPreview({ payload }: { payload: Record<string, unknown> }) {
  const mcq = payload as { choices: { id: string; text: string }[]; correctChoiceId?: string };
  if (Array.isArray(mcq.choices)) {
    return (
      <div className="space-y-1.5">
        {mcq.choices.map((choice) => {
          const correct = choice.id === mcq.correctChoiceId;
          return (
            <div
              key={choice.id}
              className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
                correct && 'border-emerald-500/50 bg-emerald-500/5',
              )}
            >
              {correct ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={cn(correct && 'font-medium')}>{choice.text}</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (typeof payload['correctAnswer'] === 'boolean') {
    return (
      <p className="text-sm">
        Answer: <span className="font-medium">{payload['correctAnswer'] ? 'True' : 'False'}</span>
      </p>
    );
  }
  if (Array.isArray(payload['acceptableAnswers'])) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(payload['acceptableAnswers'] as string[]).map((a, i) => (
          <Badge key={i} variant="secondary">
            {a}
          </Badge>
        ))}
      </div>
    );
  }
  if (typeof payload['modelAnswer'] === 'string') {
    return <AnswerText text={payload['modelAnswer'] as string} className="text-sm" />;
  }
  if (typeof payload['modelAnswer'] === 'number') {
    return (
      <p className="text-sm">
        Answer: <span className="font-medium">{payload['modelAnswer'] as number}</span>
      </p>
    );
  }
  if (Array.isArray(payload['left'])) {
    const right = new Map(
      (payload['right'] as { id: string; text: string }[]).map((r) => [r.id, r.text]),
    );
    const matches = payload['matches'] as Record<string, string>;
    return (
      <div className="space-y-1.5">
        {(payload['left'] as { id: string; text: string }[]).map((l) => (
          <div key={l.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <span>{l.text}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium">{right.get(matches[l.id]) ?? '—'}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-sm text-muted-foreground">Answer stored in payload.</span>;
}

export default function QuestionExtractionReviewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [status, setStatus] = useState<QuestionExtractionStatus['extraction'] | null>(null);
  const [meta, setMeta] = useState<QuestionExtractionCandidatesResponse['extraction'] | null>(null);
  const [candidates, setCandidates] = useState<QuestionExtractionCandidate[]>([]);
  const [types, setTypes] = useState<QuestionTypeDefinition[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [answerGeneration, setAnswerGeneration] = useState<Record<string, AnswerGenerationState>>({});
  const [importing, setImporting] = useState(false);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const finished =
    status?.status === 'completed' ||
    status?.status === 'failed' ||
    status?.status === 'cancelled';

  /* ── types / academic lists ── */
  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ types: QuestionTypeDefinition[] }>('/question-types', { signal: ctrl.signal })
      .then(({ types }) => setTypes(types))
      .catch(() => setTypes([]));
    api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch(() => setSubjects([]));
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    if (subjects.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      subjects.map((s) =>
        api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${s.id}/chapters`, {
          signal: ctrl.signal,
        }),
      ),
    )
      .then((results) => setChapters(results.flatMap((r) => r.chapters)))
      .catch(() => setChapters([]));
    return () => ctrl.abort();
  }, [subjects]);

  useEffect(() => {
    if (chapters.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      chapters.map((c) =>
        api<{ topics: TopicResponse[] }>(`/academic/chapters/${c.id}/topics`, {
          signal: ctrl.signal,
        }),
      ),
    )
      .then((results) => setTopics(results.flatMap((r) => r.topics)))
      .catch(() => setTopics([]));
    return () => ctrl.abort();
  }, [chapters]);

  /* ── poll the job status ── */
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await api<QuestionExtractionStatus>(`/questions/extraction/${jobId}`);
        if (cancelled) return;
        setStatus(resp.extraction);
        if (
          resp.extraction.status === 'completed' ||
          resp.extraction.status === 'failed' ||
          resp.extraction.status === 'cancelled'
        ) {
          clearInterval(interval);
        }
      } catch (err) {
        if (cancelled) return;
        if (
          err instanceof ApiError &&
          (err.status === 401 || err.status === 403 || err.status === 404)
        ) {
          setError(err.message);
          setLoading(false);
          clearInterval(interval);
        }
      }
    };
    void tick();
    const interval = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  /* ── load candidates once the job completes (or earlier if reused) ── */
  const loadCandidates = useCallback(
    async (initial = false, resetDraftId?: string) => {
      if (!jobId) return undefined;
      if (initial && !finished) return undefined;
      try {
        const resp = await api<QuestionExtractionCandidatesResponse>(
          `/questions/extraction/${jobId}/candidates`,
        );
        setMeta(resp.extraction);
        setCandidates(resp.candidates);
        setDrafts((prev) => {
          const next = { ...prev };
          for (const c of resp.candidates) {
            if (c.id === resetDraftId || !next[c.id]) next[c.id] = draftOf(c);
          }
          return next;
        });
        setLoading(false);
        setError(null);
        return resp.candidates;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load candidates');
        setLoading(false);
        return undefined;
      }
    },
    [jobId, finished],
  );

  useEffect(() => {
    void loadCandidates(true);
  }, [loadCandidates]);

  const answerGenerating = Object.values(answerGeneration).some(
    (state) => state.status !== 'failed',
  );
  const busy =
    savingId !== null || acceptingId !== null || discardingId !== null || importing || answerGenerating || !finished;

  const draft = (id: string): Draft =>
    drafts[id] ?? { stem: '', difficulty: 'MEDIUM', explanation: '', chapterId: '', topicId: '', payload: {} };

  const setDraftField = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...draft(id), ...patch } }));

  function updateFromPatch(id: string, patched: QuestionExtractionCandidate) {
    setCandidates((prev) => prev.map((c) => (c.id === id ? patched : c)));
    setDrafts((prev) => ({ ...prev, [id]: draftOf(patched) }));
  }

  function clearAnswerGeneration(id: string) {
    setAnswerGeneration((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /* ── actions ── */
  const payloadFor = (id: string): Record<string, unknown> => draft(id).payload;

  function setPayload(id: string, patch: Record<string, unknown>) {
    setDraftField(id, { payload: { ...payloadFor(id), ...patch } });
  }

  function setMcqChoiceText(id: string, choiceId: string, text: string) {
    const choices = (payloadFor(id)['choices'] as { id: string; text: string }[]).map((c) =>
      c.id === choiceId ? { ...c, text } : c,
    );
    setPayload(id, { choices });
  }

  function addMcqChoice(id: string) {
    const choices = payloadFor(id)['choices'] as { id: string; text: string }[];
    setPayload(id, { choices: [...choices, { id: crypto.randomUUID(), text: '' }] });
  }

  function removeMcqChoice(id: string, choiceId: string) {
    const choices = (payloadFor(id)['choices'] as { id: string; text: string }[]).filter(
      (c) => c.id !== choiceId,
    );
    const next: Record<string, unknown> = { choices };
    if (payloadFor(id)['correctChoiceId'] === choiceId) {
      next['correctChoiceId'] = choices[0]?.id;
    }
    setPayload(id, next);
  }

  const unchanged = useCallback(
    (id: string) => {
      const c = candidates.find((x) => x.id === id);
      if (!c) return false;
      const d = draft(id);
      return (
        c.stem === d.stem &&
        c.difficulty === d.difficulty &&
        (c.explanation ?? '') === d.explanation &&
        (c.chapterId ?? NULL_SCOPE) === d.chapterId &&
        (c.topicId ?? NULL_SCOPE) === d.topicId &&
        JSON.stringify(c.payload) === JSON.stringify(d.payload)
      );
    },
    [candidates, drafts],
  );
  const hasDirtyDrafts = candidates.some((c) => !unchanged(c.id));

  async function saveCandidate(c: QuestionExtractionCandidate) {
    setSavingId(c.id);
    const d = draft(c.id);
    try {
      const resp = await api<{ question: QuestionExtractionCandidate }>(
        `/questions/extraction/${jobId}/candidates/${c.id}`,
        {
          method: 'PATCH',
          body: {
            ...(d.stem !== c.stem ? { stem: d.stem } : {}),
            ...(d.difficulty !== c.difficulty ? { difficulty: d.difficulty } : {}),
            ...(d.explanation !== (c.explanation ?? '') ? { explanation: d.explanation } : {}),
            chapterId: d.chapterId === NULL_SCOPE ? null : d.chapterId,
            topicId: d.topicId === NULL_SCOPE ? null : d.topicId,
            ...(JSON.stringify(d.payload) !== JSON.stringify(c.payload)
              ? { payload: d.payload }
              : {}),
          },
        },
      );
      updateFromPatch(c.id, resp.question);
      if (hasValidQuestionAnswer(resp.question.answerFormat, resp.question.payload)) {
        clearAnswerGeneration(c.id);
      }
      toast.success('Candidate updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update candidate');
    } finally {
      setSavingId(null);
    }
  }

  async function generateAnswer(c: QuestionExtractionCandidate) {
    if (!isSupportedQuestionAnswerFormat(c.answerFormat)) {
      toast.error('Answer generation is not supported for this question format.');
      return;
    }
    if (!unchanged(c.id)) {
      toast.error('Save candidate edits before generating an answer.');
      return;
    }
    setAnswerGeneration((prev) => ({
      ...prev,
      [c.id]: { status: 'requesting', retryable: false },
    }));
    try {
      const response = await api<GenerateQuestionAnswerResponse>(
        `/questions/extraction/${jobId}/candidates/${c.id}/generate-answer`,
        { method: 'POST' },
      );
      const { jobId: answerJobId } = response.answer;
      setAnswerGeneration((prev) => ({
        ...prev,
        [c.id]: { status: 'queued', jobId: answerJobId, retryable: false },
      }));

      await waitForJob(async () => {
        const jobResponse = await api<{ job: JobResponse }>(`/jobs/${answerJobId}`);
        const jobStatus = jobResponse.job.status;
        if (jobStatus === 'queued' || jobStatus === 'processing') {
          setAnswerGeneration((prev) => ({
            ...prev,
            [c.id]: { status: jobStatus, jobId: answerJobId, retryable: false },
          }));
        }
        return jobResponse;
      });

      const refreshed = (await loadCandidates(false, c.id))?.find((row) => row.id === c.id);
      if (!refreshed)
        throw new Error('Generation finished, but the candidate could not be refreshed.');
      if (!hasValidQuestionAnswer(refreshed.answerFormat, refreshed.payload)) {
        throw new Error('Generation finished without a valid answer. Retry or edit it manually.');
      }
      clearAnswerGeneration(c.id);
      toast.success('Answer generated — review and save any edits');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const refreshed = (await loadCandidates(false, c.id))?.find((row) => row.id === c.id);
        if (refreshed && hasValidQuestionAnswer(refreshed.answerFormat, refreshed.payload)) {
          clearAnswerGeneration(c.id);
          toast.success('Answer is already available — review and save any edits');
          return;
        }
      }
      const denied =
        err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404);
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'Answer generation failed';
      setAnswerGeneration((prev) => ({
        ...prev,
        [c.id]: { status: 'failed', message, retryable: !denied },
      }));
      toast.error(message);
    }
  }

  async function acceptCandidate(c: QuestionExtractionCandidate) {
    setAcceptingId(c.id);
    try {
      await api<{ question: QuestionExtractionCandidate }>(
        `/questions/extraction/${jobId}/candidates/${c.id}/accept`,
        { method: 'POST' },
      );
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      clearAnswerGeneration(c.id);
      toast.success('Accepted into the bank');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Accept failed');
    } finally {
      setAcceptingId(null);
    }
  }

  async function discardCandidate(c: QuestionExtractionCandidate) {
    setDiscardingId(c.id);
    try {
      await api(`/questions/extraction/${jobId}/candidates/${c.id}/discard`, {
        method: 'POST',
      });
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      clearAnswerGeneration(c.id);
      toast.success('Candidate discarded');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Discard failed');
    } finally {
      setDiscardingId(null);
    }
  }

  async function importAll() {
    setImporting(true);
    try {
      const resp = await api<{ imported: number; skipped: { questionId: string; reason: string }[] }>(
        `/questions/extraction/${jobId}/import`,
        { method: 'POST' },
      );
      toast.success(`Imported ${resp.imported} question${resp.imported !== 1 ? 's' : ''}`);
      if (resp.skipped.length > 0) {
        toast.error(
          `${resp.skipped.length} skipped — fix them first: ${resp.skipped[0]?.reason ?? ''}`,
          { duration: 6000 },
        );
      }
      await loadCandidates();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function discardAll() {
    setImporting(true);
    try {
      await api(`/questions/extraction/${jobId}/discard`, { method: 'POST' });
      setCandidates([]);
      toast.success('All candidates discarded');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Discard failed');
    } finally {
      setImporting(false);
    }
    setDiscardAllOpen(false);
  }

  const pending =
    status?.status === 'queued' ||
    status?.status === 'processing' ||
    status?.status === 'cancelling'
      ? status.status
      : null;

  const chapterOptions = useMemo(
    () => chapters.filter((c) => c.subjectId === meta?.subjectId),
    [chapters, meta],
  );

  const subjectName = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const chapterName = useMemo(() => new Map(chapters.map((c) => [c.id, c.name])), [chapters]);
  const topicName = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);

  if (!isTeacher) {
    return (
      <ErrorState
        description="You need a teacher role to review extracted questions."
        onRetry={undefined}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Extracted Questions"
        description={
          meta ? (meta.paperTitle ?? meta.materialTitle ?? 'Reviewing extraction') : 'Reviewing extraction'
        }
        actions={
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link href={meta?.paperId ? `/question-papers/${meta.paperId}` : '/questions'}>
                <ArrowLeft className="mr-1 size-3.5" /> {meta?.paperId ? 'Back to paper' : 'Back to questions'}
              </Link>
            </Button>
            {!loading && meta && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || candidates.length === 0}
                  onClick={() => setDiscardAllOpen(true)}
                >
                  <Trash2 className="mr-1 size-3.5" /> Discard all
                </Button>
                <Button
                  size="sm"
                  disabled={busy || hasDirtyDrafts || candidates.length === 0}
                  onClick={() => void importAll()}
                  title={hasDirtyDrafts ? 'Save candidate edits before importing' : undefined}
                >
                  {importing ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-1 size-3.5" />
                  )}
                  Accept & import all
                </Button>
              </>
            )}
          </>
        }
      />

      {pending && (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Extraction is {pending} — results appear automatically.
        </div>
      )}

      {status?.status === 'failed' && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Extraction failed: {status.error?.message ?? 'unknown error'}
        </div>
      )}

      {status?.status === 'cancelled' && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          Extraction was cancelled.
        </div>
      )}

      {!meta && !error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
          <FileSearch className="mb-2 size-8" />
          {status?.status === 'completed'
            ? 'No candidates were detected for this source.'
            : status?.status === 'cancelled'
              ? 'The extraction was cancelled before candidates were available.'
              : `Waiting for the extraction job (${status?.status ?? 'queued'}).`}
        </div>
      )}

      {!meta && loading && <SkeletonRows rows={4} />}

      {meta && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{formatDate(meta.createdAt)}</Badge>
          {meta.source && (
            <Badge variant="secondary">
              {meta.source === 'ENHANCEMENT'
                ? 'Enhanced text'
                : meta.source === 'OCR'
                  ? 'OCR text'
                  : 'Raw text'}
            </Badge>
          )}
          {meta.materialRevision && <Badge variant="outline">revision {meta.materialRevision}</Badge>}
          {meta.subjectId && subjectName.get(meta.subjectId) && (
            <Badge variant="outline">{subjectName.get(meta.subjectId)}</Badge>
          )}
          <span>
            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} · review, edit, accept
            or discard before importing
          </span>
        </div>
      )}

      {error && <ErrorState description={error} onRetry={() => void loadCandidates()} />}

      <div className="space-y-3">
        {candidates.map((c) => {
          const d = draft(c.id);
          const isDirty = !unchanged(c.id);
          const answerValid = hasValidQuestionAnswer(c.answerFormat, c.payload);
          const draftAnswerValid = hasValidQuestionAnswer(c.answerFormat, d.payload);
          const canGenerate = isSupportedQuestionAnswerFormat(c.answerFormat);
          const generationState = answerGeneration[c.id];
          const isGenerating =
            generationState?.status !== undefined && generationState.status !== 'failed';
          const issues = issuesOf(c, answerValid || (isDirty && draftAnswerValid));
          const typeName =
            types.find((t) => t.code === c.questionType)?.name ?? c.questionType;
          return (
            <Card key={c.id}>
              <CardContent className="space-y-3 pt-5">
                <fieldset disabled={isGenerating} className="min-w-0 space-y-3 disabled:opacity-70">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{typeName}</Badge>
                  <Badge variant="secondary">{c.difficulty}</Badge>
                   {answerValid && !isDirty && (
                     <Badge
                      variant="outline"
                      className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                    >
                      Answer ready
                    </Badge>
                  )}
                  {c.provenance.originalNumber && (
                    <Badge variant="outline">№ {c.provenance.originalNumber}</Badge>
                  )}
                  {c.provenance.page !== null && (
                    <Badge variant="outline">page {c.provenance.page}</Badge>
                  )}
                  {issues.map((issue) => (
                    <Badge
                      key={issue.code}
                      variant={issue.code.startsWith('SCOPE') ? 'secondary' : 'destructive'}
                      title={issue.message}
                      className="max-w-[280px] truncate"
                    >
                      {issue.code}
                    </Badge>
                  ))}
                </div>

                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label>Question</Label>
                    <Textarea
                      value={d.stem}
                      onChange={(e) => setDraftField(c.id, { stem: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="grid gap-2">
                      <Label>Difficulty</Label>
                      <Select
                        value={d.difficulty}
                        onValueChange={(v) => setDraftField(c.id, { difficulty: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DIFFICULTIES.map((x) => (
                            <SelectItem key={x} value={x}>
                              {x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Chapter</Label>
                      <Select
                        value={d.chapterId}
                        onValueChange={(v) =>
                          setDraftField(c.id, { chapterId: v, topicId: NULL_SCOPE })
                        }
                        disabled={!meta?.subjectId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Subject-level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NULL_SCOPE}>Subject-level</SelectItem>
                          {chapterOptions.map((ch) => (
                            <SelectItem key={ch.id} value={ch.id}>
                              {ch.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Topic</Label>
                      <Select
                        value={d.topicId}
                        onValueChange={(v) => setDraftField(c.id, { topicId: v })}
                        disabled={d.chapterId === NULL_SCOPE || d.chapterId === ''}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Chapter-level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NULL_SCOPE}>Chapter-level</SelectItem>
                          {chapterName.has(d.chapterId) &&
                            topics
                              .filter((t) => t.chapterId === d.chapterId)
                              .map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {c.answerFormat === 'MCQ' && (
                    <PayloadMcqEditor
                      payload={d.payload}
                      setPayload={(p) => setPayload(c.id, p)}
                      setChoiceText={(choiceId, text) => setMcqChoiceText(c.id, choiceId, text)}
                      addChoice={() => addMcqChoice(c.id)}
                      removeChoice={(choiceId) => removeMcqChoice(c.id, choiceId)}
                    />
                  )}
                  {c.answerFormat === 'TRUE_FALSE' && (
                    <PayloadTfEditor
                      payload={d.payload}
                      setPayload={(p) => setPayload(c.id, p)}
                    />
                  )}
                  {c.answerFormat === 'FILL_IN_BLANK' && (
                    <PayloadFibEditor
                      payload={d.payload}
                      setPayload={(p) => setPayload(c.id, p)}
                    />
                  )}
                  {c.answerFormat === 'TEXT' && (
                    <PayloadTextEditor
                      payload={d.payload}
                      setPayload={(p) => setPayload(c.id, p)}
                    />
                  )}
                  {c.answerFormat === 'NUMERICAL' && (
                    <PayloadNumericalEditor
                      payload={d.payload}
                      setPayload={(p) => setPayload(c.id, p)}
                    />
                  )}
                  {c.answerFormat === 'MATCHING' && (
                    <PayloadMatchingEditor
                      payload={d.payload}
                      setPayload={(p) => setPayload(c.id, p)}
                    />
                  )}
                  {![
                    'MCQ',
                    'TRUE_FALSE',
                    'FILL_IN_BLANK',
                    'TEXT',
                    'NUMERICAL',
                    'MATCHING',
                  ].includes(c.answerFormat) && (
                    <div className="grid gap-2">
                      <Label>Answer</Label>
                      <PayloadPreview payload={d.payload} />
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label>Explanation</Label>
                    <Textarea
                      value={d.explanation}
                      onChange={(e) => setDraftField(c.id, { explanation: e.target.value })}
                      rows={2}
                    />
                  </div>
                </div>
                {!answerValid && generationState?.status === 'failed' && (
                  <p className="text-sm text-destructive" role="alert">
                    {generationState.message ?? 'Answer generation failed.'}
                  </p>
                )}
                </fieldset>
              </CardContent>
              <CardFooter className="justify-between">
                <p className="text-xs text-muted-foreground">
                  {chapterName.get(d.chapterId) ?? 'Subject-level'}
                  {d.topicId !== NULL_SCOPE && d.topicId && topicName.get(d.topicId)
                    ? ` / ${topicName.get(d.topicId)}`
                    : ''}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                   {!answerValid && canGenerate && (
                     <Button
                       size="sm"
                       variant="outline"
                       disabled={
                         isDirty ||
                         isGenerating ||
                         (generationState?.status === 'failed' && !generationState.retryable)
                       }
                       onClick={() => void generateAnswer(c)}
                       title={
                         isDirty ? 'Save candidate edits before generating' : generationState?.message
                       }
                     >
                      {isGenerating ? (
                        <Loader2 className="mr-1 size-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 size-3.5" />
                      )}
                      {answerActionLabel(generationState)}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isGenerating || savingId === c.id}
                    onClick={() => void saveCandidate(c)}
                  >
                    {savingId === c.id ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1 size-3.5" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isGenerating || discardingId === c.id}
                    onClick={() => void discardCandidate(c)}
                  >
                    {discardingId === c.id ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1 size-3.5" />
                    )}
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    disabled={isDirty || !answerValid || isGenerating || acceptingId === c.id}
                    onClick={() => void acceptCandidate(c)}
                    title={
                      isDirty
                        ? 'Save your edits first'
                        : !answerValid
                          ? 'Add and save a valid answer first'
                          : 'Accept into the bank'
                    }
                  >
                    {acceptingId === c.id ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 size-3.5" />
                    )}
                    Accept
                  </Button>
                </div>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={discardAllOpen}
        onOpenChange={setDiscardAllOpen}
        title="Discard all candidates?"
        description={`This permanently removes all ${candidates.length} review candidate${candidates.length !== 1 ? 's' : ''} for this extraction. This cannot be undone.`}
        confirmLabel="Discard all"
        onConfirm={() => void discardAll()}
      />
    </div>
  );
}

function PayloadMcqEditor({
  payload,
  setPayload,
  setChoiceText,
  addChoice,
  removeChoice,
}: {
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
  setChoiceText: (choiceId: string, text: string) => void;
  addChoice: () => void;
  removeChoice: (choiceId: string) => void;
}) {
  const choices = (payload['choices'] as { id: string; text: string }[]) ?? [];
  const correct = payload['correctChoiceId'] as string | undefined;
  return (
    <div className="space-y-2">
      <Label>Choices</Label>
      {choices.map((choice, i) => (
        <div key={choice.id} className="flex items-center gap-2">
          <input
            type="radio"
            name={`mcq-${choice.id}`}
            className="size-4 shrink-0 accent-primary"
            checked={correct === choice.id}
            onChange={() => setPayload({ correctChoiceId: choice.id })}
            aria-label={`Mark choice ${i + 1} as correct`}
          />
          <Input
            value={choice.text}
            placeholder={`Choice ${i + 1}`}
            onChange={(e) => setChoiceText(choice.id, e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => removeChoice(choice.id)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={addChoice}>
        Add choice
      </Button>
    </div>
  );
}

function PayloadTfEditor({
  payload,
  setPayload,
}: {
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>Correct answer</Label>
      <Select
        value={String(!!payload['correctAnswer'])}
        onValueChange={(v) => setPayload({ correctAnswer: v === 'true' })}
      >
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function PayloadFibEditor({
  payload,
  setPayload,
}: {
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
}) {
  const answers = (payload['acceptableAnswers'] as string[]) ?? [''];
  return (
    <div className="space-y-2">
      <Label>Acceptable answers</Label>
      {answers.map((answer, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={answer}
            placeholder={`Answer ${i + 1}`}
            onChange={(e) =>
              setPayload({
                acceptableAnswers: answers.map((a, j) => (j === i ? e.target.value : a)),
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() =>
              setPayload({ acceptableAnswers: answers.filter((_, j) => j !== i) })
            }
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setPayload({ acceptableAnswers: [...answers, ''] })}
      >
        Add answer
      </Button>
    </div>
  );
}

function PayloadMatchingEditor({
  payload,
  setPayload,
}: {
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
}) {
  const left = (payload['left'] as { id: string; text: string }[] | undefined) ?? [];
  const right = (payload['right'] as { id: string; text: string }[] | undefined) ?? [];
  const matches = (payload['matches'] as Record<string, string> | undefined) ?? {};

  return (
    <div className="space-y-2">
      <Label>Matches</Label>
      {left.map((item) => (
        <div key={item.id} className="grid items-center gap-2 sm:grid-cols-2">
          <span className="text-sm">{item.text}</span>
          <Select
            value={matches[item.id] ?? ''}
            onValueChange={(id) => setPayload({ matches: { ...matches, [item.id]: id } })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose the matching item" />
            </SelectTrigger>
            <SelectContent>
              {right.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

function PayloadTextEditor({
  payload,
  setPayload,
}: {
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>Model answer</Label>
      <Textarea
        value={(payload['modelAnswer'] as string) ?? ''}
        onChange={(e) => setPayload({ modelAnswer: e.target.value })}
        rows={2}
      />
    </div>
  );
}

function PayloadNumericalEditor({
  payload,
  setPayload,
}: {
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label>Model answer</Label>
        <Input
          type="number"
          step="any"
          value={(payload['modelAnswer'] as string | number) ?? ''}
          onChange={(e) =>
            setPayload({ modelAnswer: e.target.value === '' ? 0 : Number(e.target.value) })
          }
        />
      </div>
      <div className="grid gap-2">
        <Label>Tolerance (±)</Label>
        <Input
          type="number"
          step="any"
          value={(payload['tolerance'] as string | number) ?? ''}
          onChange={(e) =>
            setPayload({
              ...(e.target.value === '' ? {} : { tolerance: Number(e.target.value) }),
            })
          }
        />
      </div>
    </div>
  );
}