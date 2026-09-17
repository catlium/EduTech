'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';

import { api, ApiError, waitForBankBatch } from '@/lib/api';
import type { PaperPattern, SubjectResponse } from '@catlium/contracts';
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

type CreateFromPatternResponse =
  | { paper: { id: string } }
  | { assessment: { id: string } }
  | { status: 'GENERATING'; batchId: string | null; totalDeficit: number };

export function NewQuestionPaperDialog({
  open,
  onOpenChange,
  kind = 'paper',
  title = 'New Question Paper',
  description = 'Pick an approved Paper Pattern — the paper is created and populated from your question bank in one step.',
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
  const [subjectId, setSubjectId] = useState('');
  const [patternId, setPatternId] = useState('');
  const [creating, setCreating] = useState(false);
  const isAssessment = kind === 'assessment';

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api<{ patterns: PaperPattern[] }>('/paper-patterns', { signal: ctrl.signal })
      .then(({ patterns }) => setPatterns(patterns))
      .catch(() => setPatterns([]));
    api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch(() => setSubjects([]));
    setSubjectId('');
    setPatternId('');
    return () => ctrl.abort();
  }, [open]);

  const available = patterns
    .filter(
      (p) =>
        p.status === 'APPROVED' &&
        (p.subjectIds.length === 0 || !subjectId || p.subjectIds.includes(subjectId)),
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  async function createPaper() {
    if (!patternId) return;
    setCreating(true);
    try {
      if (isAssessment) {
        // The API only creates when the bank fully covers the pattern; on a
        // shortfall it queues generation and returns the batch to wait on.
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const res = await api<CreateFromPatternResponse>(
            `/paper-patterns/${patternId}/assessment`,
            { method: 'POST', body: {} },
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
            body: { patternId },
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
          <div className="grid gap-2">
            <Label>Subject</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All subjects</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <Button onClick={() => void createPaper()} disabled={!patternId || creating}>
            {creating ? 'Creating…' : isAssessment ? 'Create Assessment' : 'Create Question Paper'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}