'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  Sparkles,
} from 'lucide-react';

import { api, ApiError, downloadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/app/empty-state';
import { ScopeCascade as ScopeCascadeFields } from '@/components/app/scope-cascade';
import type { ScopeCascade } from '@/components/app/scope-cascade';
import {
  ExportPreviewDialog,
  type ExportPreviewValue,
} from '@/components/export/export-preview-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  QuestionDifficulty,
  PaperPattern,
  GenerateMoreQuestionsResponse,
  GenerateBankBucket,
  QuestionBankBatchResponse,
} from '@catlium/contracts';

const DIFFICULTIES: QuestionDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const STEPS = ['Scope', 'Source', 'Generate', 'Preview & Export'] as const;

type Mode = 'pattern' | 'manual';

interface WizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: SubjectResponse[];
  chapters: ChapterResponse[];
  topics: TopicResponse[];
  onChanged: () => void;
}

/* Equal percentage split so manual buckets sum to the requested per-type count. */
function splitDifficulties(difficulties: QuestionDifficulty[]): Record<QuestionDifficulty, number> {
  const dist: Record<QuestionDifficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
  if (difficulties.length === 0) return dist;
  const each = Math.floor(100 / difficulties.length);
  let remainder = 100;
  for (const d of difficulties) {
    dist[d] = each;
    remainder -= each;
  }
  dist[difficulties[0]!] += remainder;
  return dist;
}

/* Percentage split for a type's difficulty distribution (pattern sections) —
 * falls back to all-MEDIUM when the section has no distribution. */
function patternDifficultySplit(
  structure: PaperPattern['structure'] | null,
  questionType: string,
): Record<QuestionDifficulty, number> {
  const section = structure?.sections.find((s) => s.questionType === questionType);
  const dist = section?.difficultyDistribution;
  const total = dist ? dist.EASY + dist.MEDIUM + dist.HARD : 0;
  if (dist && total > 0) {
    return { EASY: dist.EASY, MEDIUM: dist.MEDIUM, HARD: dist.HARD };
  }
  return { EASY: 0, MEDIUM: 100, HARD: 0 };
}

/* Type × difficulty targets shared by both modes. The Source step only decides
 * WHICH types: pattern mode takes the pattern's section types, manual mode
 * the chosen types. The per-type count comes from the Generate step and is
 * split across difficulties by the pattern's distribution (pattern mode) or an
 * equal split (manual mode). */
function buildTargets(
  mode: Mode,
  structure: PaperPattern['structure'] | null,
  selectedTypes: string[],
  selectedDifficulties: QuestionDifficulty[],
  counts: Record<string, number>,
): GenerateBankBucket[] {
  const types =
    mode === 'manual'
      ? selectedTypes
      : [...new Set((structure?.sections ?? []).flatMap((s) => (s.questionType ? [s.questionType] : [])))];
  const out: GenerateBankBucket[] = [];
  for (const questionType of types) {
    const dist =
      mode === 'manual'
        ? splitDifficulties(selectedDifficulties)
        : patternDifficultySplit(structure, questionType);
    const target = counts[questionType] ?? 0;
    if (target <= 0) continue;
    for (const difficulty of DIFFICULTIES) {
      const pct = dist[difficulty] ?? 0;
      if (pct <= 0) continue;
      const n = Math.round((target * pct) / 100);
      if (n > 0) out.push({ questionType, difficulty, count: n });
    }
  }
  return out;
}

/* Merge duplicate (questionType, difficulty) keys by summing counts. */
function mergeBuckets(buckets: GenerateBankBucket[]): GenerateBankBucket[] {
  const map = new Map<string, GenerateBankBucket>();
  for (const b of buckets) {
    const key = `${b.questionType}|${b.difficulty}`;
    const existing = map.get(key);
    map.set(key, {
      questionType: b.questionType,
      difficulty: b.difficulty,
      count: (existing?.count ?? 0) + b.count,
    });
  }
  return [...map.values()];
}

export function QuestionBankWizard({
  open,
  onOpenChange,
  subjects,
  chapters,
  topics,
  onChanged,
}: WizardProps) {
  const [step, setStep] = useState(0);
  const [cascade, setCascade] = useState<ScopeCascade>({
    subjectId: '',
    chapterId: '',
    topicId: '',
  });
  const [mode, setMode] = useState<Mode>('pattern');
  const [patternId, setPatternId] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['MCQ']);
  const [selectedDifficulties, setSelectedDifficulties] = useState<QuestionDifficulty[]>([
    'EASY',
    'MEDIUM',
  ]);
  const [counts, setCounts] = useState<Record<string, number>>({ MCQ: 10 });
  const [include, setInclude] = useState<'paper' | 'answers'>('paper');

  const [patterns, setPatterns] = useState<PaperPattern[]>([]);
  const [types, setTypes] = useState<QuestionTypeDefinition[]>([]);

  const [deficit, setDeficit] = useState<GenerateMoreQuestionsResponse | null>(null);
  const [batch, setBatch] = useState<{ id: string; status: QuestionBankBatchResponse | null } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  /* ── data ── */
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api<{ patterns: PaperPattern[] }>('/paper-patterns', { signal: ctrl.signal })
      .then(({ patterns }) => setPatterns(patterns))
      .catch(() => setPatterns([]));
    api<{ types: QuestionTypeDefinition[] }>('/question-types', { signal: ctrl.signal })
      .then(({ types }) => setTypes(types))
      .catch(() => setTypes([]));
    return () => ctrl.abort();
  }, [open]);

  useEffect(() => {
    if (!batch) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await api<QuestionBankBatchResponse>(`/questions/bank/batches/${batch.id}`);
        if (!cancelled) setBatch((prev) => (prev ? { ...prev, status: resp } : prev));
      } catch {
        /* ignore transient poll errors */
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batch?.id]);

  const availablePatterns = useMemo(
    () =>
      patterns
        .filter(
          (p) =>
            p.status === 'APPROVED' &&
            (p.subjectIds.length === 0 || p.subjectIds.includes(cascade.subjectId)),
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
    [patterns, cascade.subjectId],
  );

  const activePattern = patterns.find((p) => p.id === patternId) ?? null;

  /* The types this wizard run targets: pattern sections (pattern mode) or the
   * manually chosen types. Counts are decided in the Generate step, not here. */
  const activeTypes = useMemo(
    () =>
      mode === 'pattern'
        ? [...new Set((activePattern?.structure?.sections ?? []).flatMap((s) => (s.questionType ? [s.questionType] : [])))]
        : selectedTypes,
    [mode, activePattern, selectedTypes],
  );

  /* Seed per-type counts for the active types so the Generate step has a
   * starting value (pattern total when available, otherwise 10). Keeps any
   * already-entered counts. */
  useEffect(() => {
    setCounts((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const t of activeTypes) {
        if (next[t] === undefined) {
          const total =
            mode === 'pattern'
              ? (activePattern?.structure?.sections ?? [])
                  .filter((s) => s.questionType === t)
                  .reduce((sum, s) => sum + (s.count ?? 0), 0)
              : 10;
          next[t] = Math.max(1, total);
        }
      }
      return next;
    });
  }, [activeTypes, mode, activePattern]);

  const buckets = useMemo<GenerateBankBucket[]>(
    () =>
      buildTargets(mode, activePattern?.structure ?? null, selectedTypes, selectedDifficulties, counts),
    [mode, activePattern, selectedTypes, selectedDifficulties, counts],
  );

  const mergedBuckets = useMemo(() => mergeBuckets(buckets), [buckets]);

  const scopePayload = useMemo(
    () => ({
      ...(cascade.subjectId ? { subjectId: cascade.subjectId } : {}),
      ...(cascade.chapterId ? { chapterId: cascade.chapterId } : {}),
      ...(cascade.topicId ? { topicId: cascade.topicId } : {}),
    }),
    [cascade],
  );

  const exportParams = useMemo(() => {
    const p = new URLSearchParams();
    if (cascade.subjectId) p.set('subjectId', cascade.subjectId);
    if (cascade.chapterId) p.set('chapterId', cascade.chapterId);
    if (cascade.topicId) p.set('topicId', cascade.topicId);
    if (mode === 'pattern' && patternId) p.set('patternId', patternId);
    if (mergedBuckets.length > 0) p.set('buckets', JSON.stringify(mergedBuckets));
    p.set('include', include);
    return p.toString();
  }, [cascade, mode, patternId, include, mergedBuckets]);

  const reset = useCallback(() => {
    setStep(0);
    setCascade({ subjectId: '', chapterId: '', topicId: '' });
    setMode('pattern');
    setPatternId('');
    setSelectedTypes(['MCQ']);
    setSelectedDifficulties(['EASY', 'MEDIUM']);
    setCounts({ MCQ: 10 });
    setInclude('paper');
    setDeficit(null);
    setBatch(null);
  }, []);

  const canLeaveScope = !!cascade.subjectId;
  const canLeaveSource =
    mode === 'manual'
      ? selectedTypes.length > 0 && selectedDifficulties.length > 0
      : !!patternId || availablePatterns.length === 0;
  const canLeaveGenerate = buckets.length > 0 && !!cascade.subjectId;

  /* ── actions ── */
  async function checkBank() {
    if (buckets.length === 0) {
      toast.error('Add at least one question target');
      return;
    }
    setChecking(true);
    setDeficit(null);
    try {
      const resp = await api<GenerateMoreQuestionsResponse>('/questions/generate-more', {
        method: 'POST',
        body: { ...scopePayload, buckets: mergedBuckets, dryRun: true },
      });
      setDeficit(resp);
      if (resp.totalDeficit === 0) toast.info('The bank already covers these targets');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to check the bank');
    } finally {
      setChecking(false);
    }
  }

  async function generateMissing() {
    if (!deficit) {
      toast.error('Check the bank first to see what is missing');
      return;
    }
    const target = deficit.buckets
      .filter((b) => b.deficit > 0)
      .map((b) => ({ questionType: b.questionType, difficulty: b.difficulty, count: b.deficit }));
    if (target.length === 0) {
      toast.info('Nothing to generate — the bank covers these targets');
      return;
    }
    setGenerating(true);
    try {
      const resp = await api<GenerateMoreQuestionsResponse>('/questions/generate-more', {
        method: 'POST',
        body: { ...scopePayload, buckets: target },
      });
      if (resp.batchId) setBatch({ id: resp.batchId, status: null });
      toast.success('Generation queued — questions arrive as PENDING approval');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start generation');
    } finally {
      setGenerating(false);
    }
  }

  const loadPreview = useCallback(async (): Promise<ExportPreviewValue> => {
    const { preview } = await api<{ preview: ExportPreviewValue }>(
      `/export/questions/preview?${exportParams}`,
    );
    return preview;
  }, [exportParams]);

  async function onExport(format: 'pdf' | 'docx') {
    setExporting(true);
    try {
      await downloadFile(`/export/questions?${exportParams}&format=${format}`, `question-bank.${format}`);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const batchStatus = batch?.status;
  const batchDone = batchStatus ? batchStatus.active === 0 : false;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Question Bank Wizard
            </DialogTitle>
            <DialogDescription>
              Pick a scope, choose a paper pattern or manual targets, generate any shortage, then
              preview and export exactly what you see.
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <ol className="flex flex-wrap items-center gap-2 text-xs">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border',
                    i < step
                      ? 'border-primary bg-primary text-primary-foreground'
                      : i === step
                        ? 'border-primary text-primary'
                        : 'text-muted-foreground',
                  )}
                >
                  {i < step ? <Check className="size-3" /> : i + 1}
                </span>
                <span className={i === step ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
                {i < STEPS.length - 1 && <span className="text-muted-foreground">·</span>}
              </li>
            ))}
          </ol>

          {/* ── Step 0: Scope ── */}
          {step === 0 && (
            <div className="space-y-3">
              <ScopeCascadeFields
                cascade={cascade}
                subjects={subjects}
                chapters={chapters}
                topics={topics}
                onChange={setCascade}
              />
              <p className="text-xs text-muted-foreground">
                Subject is required; pick a chapter or topic to narrow the bank.
              </p>
            </div>
          )}

          {/* ── Step 1: Source ── */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMode('pattern')}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    mode === 'pattern'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground',
                  )}
                >
                  Paper pattern
                </button>
                <button
                  type="button"
                  onClick={() => setMode('manual')}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    mode === 'manual'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground',
                  )}
                >
                  Manual selection
                </button>
              </div>

              {mode === 'pattern' ? (
                availablePatterns.length > 0 ? (
                  <div className="grid gap-2">
                    <Label>Approved pattern</Label>
                    <Select value={patternId} onValueChange={setPatternId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a pattern" />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePatterns.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activePattern?.structure && (
                      <p className="text-xs text-muted-foreground">
                        {activePattern.structure.sections.length} sections ·{' '}
                        {activePattern.structure.totalMarks} marks — the pattern sets the
                        question types.
                      </p>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    icon={<FileText className="size-6" />}
                    title="No approved patterns"
                    description="Approve a paper pattern for this subject, or switch to manual selection."
                  />
                )
              ) : (
                <>
                  <div className="grid gap-2">
                    <Label>Question types</Label>
                    <div className="flex flex-wrap gap-2">
                      {types.map((t) => (
                        <button
                          key={t.code}
                          type="button"
                          onClick={() =>
                            setSelectedTypes((prev) =>
                              prev.includes(t.code)
                                ? prev.filter((x) => x !== t.code)
                                : [...prev, t.code],
                            )
                          }
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium',
                            selectedTypes.includes(t.code)
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'text-muted-foreground',
                          )}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Difficulty</Label>
                    <div className="flex flex-wrap gap-2">
                      {DIFFICULTIES.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() =>
                            setSelectedDifficulties((prev) =>
                              prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                            )
                          }
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium',
                            selectedDifficulties.includes(d)
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'text-muted-foreground',
                          )}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Generate ── */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Questions per type</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={checking || buckets.length === 0}
                  onClick={() => void checkBank()}
                >
                  {checking ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <FileText className="mr-1 size-3.5" />
                  )}
                  Check bank
                </Button>
              </div>
              <div className="flex flex-wrap gap-3">
                {activeTypes.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-xs">
                    {types.find((x) => x.code === t)?.name ?? t}
                    <Input
                      type="number"
                      min={1}
                      className="w-20"
                      value={counts[t] ?? 1}
                      onChange={(e) =>
                        setCounts((prev) => ({
                          ...prev,
                          [t]: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>

              {deficit && (
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="text-sm font-medium">
                    {deficit.totalExisting} existing · {deficit.totalDeficit} missing
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {deficit.buckets.map((b) => (
                      <li
                        key={`${b.questionType}-${b.difficulty}`}
                        className="flex items-center justify-between"
                      >
                        <span>
                          {b.questionType} · {b.difficulty}
                        </span>
                        <span className="text-muted-foreground">
                          have {b.existing} / want {b.requested}
                          {b.pending > 0 && <span className="text-amber-600"> · {b.pending} pending</span>}
                          {b.deficit > 0 && (
                            <span className="ml-1 font-medium text-destructive">
                              · need {b.deficit}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {batch && (
                <div className="rounded-md border p-3 text-xs">
                  <div className="flex items-center gap-2 font-medium">
                    {batchDone ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    Generation {batchDone ? 'complete' : 'running'}
                  </div>
                  {batchStatus && (
                    <p className="mt-1 text-muted-foreground">
                      {batchStatus.completed} done · {batchStatus.failed} failed ·{' '}
                      {batchStatus.active} running
                    </p>
                  )}
                  {batchDone && (
                    <p className="mt-1 text-muted-foreground">
                      New questions are PENDING approval — approve them to include them in the export.
                    </p>
                  )}
                </div>
              )}

              <Button onClick={() => void generateMissing()} disabled={generating || !deficit}>
                {generating ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 size-3.5" />
                )}
                Generate missing
              </Button>
            </div>
          )}

          {/* ── Step 3: Preview & Export ── */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="grid gap-2">
                <Label>Include</Label>
                <Select
                  value={include}
                  onValueChange={(v) => setInclude(v as 'paper' | 'answers')}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paper">Student paper</SelectItem>
                    <SelectItem value="answers">Teacher answer key</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                The preview is built from the server and shows the exact document the export
                produces.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                  <Eye className="mr-1 size-3.5" /> Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => void onExport('pdf')}
                >
                  <Download className="mr-1 size-3.5" /> PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => void onExport('docx')}
                >
                  <Download className="mr-1 size-3.5" /> DOCX
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="justify-between sm:justify-between">
            <Button
              variant="ghost"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              <ArrowLeft className="mr-1 size-3.5" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                disabled={
                  (step === 0 && !canLeaveScope) ||
                  (step === 1 && !canLeaveSource) ||
                  (step === 2 && !canLeaveGenerate)
                }
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                Next <ArrowRight className="ml-1 size-3.5" />
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Question Bank Export Preview"
        description="This is exactly what the exported file will contain."
        load={loadPreview}
      />
    </>
  );
}
