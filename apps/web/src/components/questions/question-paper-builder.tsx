'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Dice5, Loader2, PenLine, ShieldCheck, Clock, Wand2, Sparkles } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import type {
  PaperPattern,
  QuestionListItem,
  QuestionBankBatchResponse,
  GenerateMoreQuestionsResponse,
  QuestionDifficulty,
} from '@catlium/contracts';
import { PaperPatternStructureSchema, flattenPatternRules } from '@catlium/contracts';
import { useTenant, canManage } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function QuestionPaperBuilder({
  subjectId,
  questions,
  onGeneratePaper,
  onGenerated,
}: {
  subjectId: string;
  questions: QuestionListItem[];
  onGeneratePaper: (patternId: string, title: string) => Promise<void>;
  onGenerated?: () => void;
}) {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [patterns, setPatterns] = useState<PaperPattern[]>([]);
  const [patternId, setPatternId] = useState('');
  const [loadingPatterns, setLoadingPatterns] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);

  /* Shortage wizard state */
  const [shortagePreview, setShortagePreview] = useState<GenerateMoreQuestionsResponse | null>(null);
  const [checkingShortage, setCheckingShortage] = useState(false);
  const [generatingShortage, setGeneratingShortage] = useState(false);
  const [batch, setBatch] = useState<QuestionBankBatchResponse | null>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoadingPatterns(true);
    api<{ patterns: PaperPattern[] }>('/paper-patterns', { signal: ctrl.signal })
      .then(({ patterns }) => setPatterns(patterns))
      .catch(() => setPatterns([]))
      .finally(() => setLoadingPatterns(false));
    return () => ctrl.abort();
  }, []);

  const availablePatterns = useMemo(
    () =>
      patterns
        .filter(
          (p) =>
            p.status === 'APPROVED' &&
            (p.subjectIds.length === 0 || p.subjectIds.includes(subjectId)),
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
    [patterns, subjectId],
  );

  const pattern = patterns.find((p) => p.id === patternId) ?? null;

  const structure = useMemo(() => {
    if (!pattern?.structure) return null;
    const parsed = PaperPatternStructureSchema.safeParse(pattern.structure);
    return parsed.success ? parsed.data : null;
  }, [pattern]);

  /* Flat per-question-type rules — selection/shortage math operates on these. */
  const sections = useMemo(
    () => (structure ? flattenPatternRules(structure) : []),
    [structure],
  );

  const usableQuestions = useMemo(
    () =>
      questions.filter(
        (q) =>
          q.approvalStatus === 'APPROVED' && q.status !== 'ARCHIVED' && q.subjectId === subjectId,
      ),
    [questions, subjectId],
  );

  /* Questions scalable to a section: same question type; if the section
   * declares a difficulty split, only difficulties with a share count here. */
  const sectionPool = (section: (typeof sections)[number]) =>
    usableQuestions.filter((q) => {
      if (section.questionType && q.questionType !== section.questionType) return false;
      const dist = section.difficultyDistribution;
      if (dist) return (dist[q.difficulty as keyof typeof dist] ?? 0) > 0;
      return true;
    });

  /* Shortage targets per section: split the per-section deficit across the
   * section's difficulty split (difficultyDistribution percentages). Bullet
   * loans the same bucketing the bank panel uses per scope. */
  const shortSections = useMemo(() => {
    if (!structure) return [];
    return sections
      .map((section) => {
        const required = section.count ?? 0;
        const available = sectionPool(section).length;
        return { section, shortage: Math.max(0, required - available) };
      })
      .filter((s) => s.shortage > 0);
  }, [structure, usableQuestions]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalShortage = shortSections.reduce((sum, s) => sum + s.shortage, 0);

  function shortageBuckets() {
    if (!structure) return [];
    return sections.flatMap((section) => {
      const required = section.count ?? 0;
      const available = sectionPool(section).length;
      const shortage = required - available;
      if (shortage <= 0 || !section.questionType) return [];
      const dist = (section.difficultyDistribution ?? {}) as Record<QuestionDifficulty, number>;
      const share = (
        ['EASY', 'MEDIUM', 'HARD'] as QuestionDifficulty[]
      ).filter((d) => (dist[d] ?? 0) > 0);
      if (share.length === 0) return [{ questionType: section.questionType, difficulty: 'MEDIUM' as QuestionDifficulty, count: shortage }];
      return share.map((difficulty) => {
        const n = Math.round((shortage * (dist[difficulty] ?? 0)) / 100);
        return {
          questionType: section.questionType!,
          difficulty,
          count: Math.max(1, n),
        };
      });
    });
  }

  async function previewShortage() {
    setCheckingShortage(true);
    setShortagePreview(null);
    try {
      const resp = await api<GenerateMoreQuestionsResponse>('/questions/generate-more', {
        method: 'POST',
        body: { subjectId, buckets: shortageBuckets(), dryRun: true },
      });
      setShortagePreview(resp);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to check bank');
    } finally {
      setCheckingShortage(false);
    }
  }

  async function runShortageGeneration() {
    if (!shortagePreview) return;
    setGeneratingShortage(true);
    try {
      const resp = await api<GenerateMoreQuestionsResponse>('/questions/generate-more', {
        method: 'POST',
        body: {
          subjectId,
          buckets: shortagePreview.buckets
            .filter((b) => b.deficit > 0)
            .map((b) => ({
              questionType: b.questionType,
              difficulty: b.difficulty,
              count: b.requested,
            })),
        },
      });
      if (resp.batchId) {
        const batchResp = await api<QuestionBankBatchResponse>(
          `/questions/bank/batches/${resp.batchId}`,
        );
        setBatch(batchResp);
        pollBatch(resp.batchId);
        toast.success('Question generation queued');
      } else if (resp.status === 'NO_ACTION') {
        toast.info('No generation needed');
      }
      setShortagePreview(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to queue generation');
    } finally {
      setGeneratingShortage(false);
    }
  }

  const pollBatch = async (batchId: string) => {
    try {
      const resp = await api<QuestionBankBatchResponse>(`/questions/bank/batches/${batchId}`);
      if (unmounted.current) return;
      setBatch(resp);
      if (resp.active > 0) {
        setTimeout(() => void pollBatch(batchId), 3000);
      } else {
        toast.success(resp.failed === 0 ? 'Missing questions generated' : `${resp.failed} generation job(s) failed`);
        onGenerated?.();
      }
    } catch {
      if (unmounted.current) return;
      setTimeout(() => void pollBatch(batchId), 3000);
    }
  };

  if (!isTeacher) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PenLine className="size-4" /> Question Paper Builder
        </CardTitle>
        <CardDescription>
          Pick an approved Paper Pattern to structure a paper from the Question Bank. Each section
          shows how many approved bank questions are available versus how many the paper requires.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <Label>Paper Pattern (template)</Label>
            <Select value={patternId} onValueChange={setPatternId} disabled={!subjectId}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    loadingPatterns
                      ? 'Loading patterns…'
                      : subjectId
                        ? 'Select an approved paper pattern'
                        : 'Select a subject first'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availablePatterns.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
                {subjectId && availablePatterns.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No approved patterns for this subject yet.
                  </p>
                )}
              </SelectContent>
            </Select>
          </div>
          {pattern && (
            <Button size="sm" variant="ghost" asChild className="self-end">
              <Link href={`/paper-patterns/${pattern.id}`}>View pattern</Link>
            </Button>
          )}
        </div>

        {!pattern && (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
            {subjectId
              ? 'Select an approved Paper Pattern for this subject to see its structure and bank availability.'
              : 'Select a subject above to load its approved paper patterns.'}
          </p>
        )}

        {pattern && structure && (
          <div className="space-y-4">
            {/* Pattern summary */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="size-4 text-emerald-600" /> {pattern.title}
              </span>
              <span className="text-muted-foreground">
                {sections.length} section{sections.length !== 1 ? 's' : ''}
              </span>
              <span className="text-muted-foreground">Max marks: {structure.totalMarks}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3.5" /> {structure.durationMinutes} minutes
              </span>
              <span className="text-muted-foreground">
                {usableQuestions.length} approved bank question
                {usableQuestions.length !== 1 ? 's' : ''} in scope
              </span>
            </div>

            {/* Section cards with available · required */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map((section) => {
                const pool = sectionPool(section);
                const required = section.count ?? 0;
                const available = pool.length;
                const shortage = required - available;
                return (
                  <div key={section.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{section.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {section.questionType ?? 'Mixed'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {section.compulsory
                        ? 'Compulsory'
                        : `Attempt ${section.attemptCount ?? required} of ${required}`}{' '}
                      · {section.marksPerQuestion ?? '—'} marks each
                    </p>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span>
                        <span className="font-semibold tabular-nums">{available}</span>{' '}
                        <span className="text-muted-foreground">available</span>
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span>
                        <span className="font-semibold tabular-nums">{required}</span>{' '}
                        <span className="text-muted-foreground">required for paper</span>
                      </span>
                    </div>
                    {shortage > 0 ? (
                      <p className="mt-1 text-xs text-amber-600">
                        {shortage} more needed — generate or add matching questions.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-emerald-600">Bank covers this section.</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Shortage wizard — surface at pattern level only when
                bank-approved questions fall short of the paper requirements */}
            {totalShortage > 0 ? (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-3 text-sm">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-medium">
                        {totalShortage} question{totalShortage !== 1 ? 's' : ''} short
                        {shortSections.length > 1
                          ? ` across ${shortSections.length} sections`
                          : ` in "${shortSections[0]?.section.name}"`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        AI can generate missing questions from the pattern before you build the
                        paper. You approve the exact deficit first.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void previewShortage()}
                    disabled={checkingShortage || generatingShortage || !subjectId}
                  >
                    {checkingShortage && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                    Review shortage to generate
                  </Button>
                </div>
              </div>
            ) : (
              pattern && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <ShieldCheck className="size-3.5" /> Bank-approved questions cover every section.
                </p>
              )
            )}

            {/* Generate Question Paper — primary action */}
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3 text-sm">
                  <Wand2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium">Generate Question Paper</p>
                    <p className="text-xs text-muted-foreground">
                      Creates a draft paper and randomly selects questions from each section,
                      preserving the required counts and structure. The paper can then be edited or
                      built into an online assessment.
                    </p>
                  </div>
                </div>
                <Button onClick={() => setConfirmGenerate(true)} disabled={generating}>
                  {generating ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Dice5 className="mr-1 size-3.5" />
                  )}
                  {generating ? 'Generating…' : 'Generate Question Paper'}
                </Button>
              </div>
            </div>

            {/* Questions grouped under sections */}
            <Accordion type="multiple" className="space-y-2">
              {sections.map((section) => {
                const pool = sectionPool(section);
                if (pool.length === 0) return null;
                return (
                  <AccordionItem
                    key={section.id}
                    value={section.id}
                    className="rounded-lg border px-1"
                  >
                    <AccordionTrigger className="px-3 text-sm">
                      {section.name}{' '}
                      <span className="text-xs text-muted-foreground">
                        · {pool.length} available
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-1 px-3 pb-3">
                      {pool.map((q) => (
                        <div key={q.id} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary">{q.questionType}</Badge>
                            <span>{q.difficulty}</span>
                          </div>
                          <p className="mt-1 line-clamp-2">{q.stem}</p>
                        </div>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        )}
      </CardContent>

      {/* Confirm dialog with the randomness note */}
      <Dialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Question Paper</DialogTitle>
            <DialogDescription>
              {pattern?.title}. Questions will be randomly selected from each Paper Pattern section
              while preserving the required counts and structure.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {sections.map((s) => (
              <p key={s.id} className="flex justify-between py-0.5">
                <span>{s.name}</span>
                <span className="tabular-nums">
                  {s.count ?? 0} questions · {s.marksPerQuestion ?? '—'} marks each
                </span>
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmGenerate(false)} disabled={generating}>
              Cancel
            </Button>
            <Button
              disabled={generating}
              onClick={() => {
                setGenerating(true);
                void onGeneratePaper(pattern!.id, `${pattern!.title} — Question Paper`).finally(() => {
                  setGenerating(false);
                  setConfirmGenerate(false);
                });
              }}
            >
              {generating && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shortage preview / confirm dialog */}
      <Dialog
        open={shortagePreview !== null || generatingShortage}
        onOpenChange={(open) => {
          if (!open && !generatingShortage) setShortagePreview(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Missing Questions (AI)</DialogTitle>
            <DialogDescription>
              Once queued, the AI generates questions only for the deficient buckets. Each new
              question requires your approval before it enters the Question Bank.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
            {shortagePreview?.buckets.map((b, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-xs">
                  {b.questionType} · {b.difficulty}
                </span>
                <span className="tabular-nums text-xs">
                  {b.requested} requested · {b.existing} exist · {b.pending > 0 ? `${b.pending} pending · ` : ''}
                  {b.deficit > 0 ? (
                    <span className="font-semibold text-amber-600">{b.deficit} to generate</span>
                  ) : (
                    <span className="text-muted-foreground">0 — covered</span>
                  )}
                </span>
              </div>
            ))}
            {shortagePreview && shortagePreview.totalDeficit === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                The bank already covers every bucket — no generation needed.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShortagePreview(null)}
              disabled={generatingShortage}
            >
              Cancel
            </Button>
            <Button
              disabled={
                generatingShortage || !shortagePreview || shortagePreview.totalDeficit === 0
              }
              onClick={() => void runShortageGeneration()}
            >
              {generatingShortage && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {generatingShortage ? 'Generating…' : 'Queue generation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Active generation badge */}
      {batch && batch.active > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Generating batch… {batch.completed + batch.failed}/{batch.total}
        </div>
      )}
    </Card>
  );
}