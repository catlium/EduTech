'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';

import { api, ApiError, waitForBankBatch } from '@/lib/api';
import type { PaperPattern, SubjectResponse, ChapterResponse, TopicResponse } from '@catlium/contracts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScopeCascade, emptyCascade, type ScopeCascade as Scope } from '@/components/app/scope-cascade';

type CreateFromPatternResponse =
  | { paper: { id: string } }
  | { assessment: { id: string } }
  | { status: 'GENERATING'; batchId: string | null; totalDeficit: number };

export function NewQuestionPaperDialog({
  open,
  onOpenChange,
  kind = 'paper',
  title = 'New Question Paper',
  description = 'Choose the question scope (subject required) and an approved Paper Pattern — the paper is created and populated from your bank within that scope.',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: 'paper' | 'assessment';
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [patterns, setPatterns] = useState<PaperPattern[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [cascade, setCascade] = useState<Scope>(emptyCascade);
  const [patternId, setPatternId] = useState('');
  const [creating, setCreating] = useState(false);
  const isAssessment = kind === 'assessment';
  const hasScope = !!cascade.subjectId;

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api<{ patterns: PaperPattern[] }>('/paper-patterns', { signal: ctrl.signal })
      .then(({ patterns }) => setPatterns(patterns))
      .catch(() => setPatterns([]));
    api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch(() => setSubjects([]));
    setCascade(emptyCascade());
    setPatternId('');
    return () => ctrl.abort();
  }, [open]);

  useEffect(() => {
    if (!open || !cascade.subjectId) {
      setChapters([]);
      setTopics([]);
      return;
    }
    const ctrl = new AbortController();
    api<{ chapters: ChapterResponse[] }>(
      `/academic/subjects/${cascade.subjectId}/chapters`,
      { signal: ctrl.signal },
    )
      .then(({ chapters }) => setChapters(chapters))
      .catch(() => setChapters([]));
    return () => ctrl.abort();
  }, [open, cascade.subjectId]);

  useEffect(() => {
    if (!open || !cascade.chapterId) {
      setTopics([]);
      return;
    }
    const ctrl = new AbortController();
    api<{ topics: TopicResponse[] }>(`/academic/chapters/${cascade.chapterId}/topics`, {
      signal: ctrl.signal,
    })
      .then(({ topics }) => setTopics(topics))
      .catch(() => setTopics([]));
    return () => ctrl.abort();
  }, [open, cascade.chapterId]);

  const handleCascadeChange = useCallback((next: Scope) => {
    setCascade(next);
  }, []);

  const available = patterns
    .filter(
      (p) =>
        p.status === 'APPROVED' &&
        (p.subjectIds.length === 0 || !cascade.subjectId || p.subjectIds.includes(cascade.subjectId)),
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  const scopeBody = {
    subjectId: cascade.subjectId || undefined,
    chapterId: cascade.chapterId || undefined,
    topicId: cascade.topicId || undefined,
  };

  async function createPaper() {
    if (!patternId || !hasScope) return;
    setCreating(true);
    try {
      if (isAssessment) {
        // The API only creates when the bank fully covers the pattern within
        // the scope; on a shortfall it queues generation and returns the batch.
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const res = await api<CreateFromPatternResponse>(
            `/paper-patterns/${patternId}/assessment`,
            { method: 'POST', body: scopeBody },
          );
          if ('assessment' in res) {
            await api(`/assessments/${res.assessment.id}/select-from-pattern`, { method: 'POST' });
            toast.success('Assessment created from pattern — questions selected');
            onOpenChange(false);
            router.push(`/assessments/${res.assessment.id}`);
            return;
          }
          if ('status' in res && res.status === 'GENERATING') {
            if (res.batchId) await waitForBankBatch(res.batchId);
            continue;
          }
          break;
        }
        toast.error('Question generation is taking longer than expected — try again shortly.');
      } else {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const res = await api<CreateFromPatternResponse>('/question-papers', {
            method: 'POST',
            body: { patternId, ...scopeBody },
          });
          if ('paper' in res) {
            await api(`/question-papers/${res.paper.id}/select-from-pattern`, { method: 'POST' });
            toast.success('Question paper generated — questions left fixed');
            onOpenChange(false);
            router.push(`/question-papers/${res.paper.id}`);
            return;
          }
          if ('status' in res && res.status === 'GENERATING') {
            if (res.batchId) await waitForBankBatch(res.batchId);
            continue;
          }
          break;
        }
        toast.error('Question generation is taking longer than expected — try again shortly.');
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : isAssessment
            ? 'Failed to create assessment'
            : 'Failed to generate question paper',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ScopeCascade
            cascade={cascade}
            subjects={subjects}
            chapters={chapters}
            topics={topics}
            onChange={handleCascadeChange}
          />
          <div className="grid gap-2">
            <Label>Approved paper pattern</Label>
            <Select value={patternId} onValueChange={setPatternId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a pattern" />
              </SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
                {available.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No approved patterns for this scope.
                  </p>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void createPaper()} disabled={!patternId || !hasScope || creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : isAssessment ? 'Create Assessment' : 'Create Question Paper'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}