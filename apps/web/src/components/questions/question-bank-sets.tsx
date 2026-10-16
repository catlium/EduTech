'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, History, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { useTenant, hasPermission } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import type { QuestionBankBatchResponse } from '@catlium/contracts';
import { canCancelBatch, canRetryBatch, questionBankBatchPhase } from '@/lib/question-bank-batch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/app/status-badge';

interface BankSet {
  batchId: string;
  createdAt: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  generated: number;
}

// B3: the persistent, server-backed recovery surface. It lists every batch in
// the institute, polls while any is still running (no stale "N running"), and
// offers the same cancel/retry the panel and wizard do.

export function QuestionBankSets({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const { institute } = useTenant();
  // F5.6: this card is pure read — GET /questions/bank/sets and
  // GET /questions/bank/batches/:id are both `questions.read`, so the local
  // gate stops the read before it can 403 rather than hiding a write. The
  // cancel/retry controls are gated by `questions.update`.
  const canRead = hasPermission(institute, 'questions.read');
  const canManage = hasPermission(institute, 'questions.update');
  const [sets, setSets] = useState<BankSet[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [batch, setBatch] = useState<QuestionBankBatchResponse | null>(null);
  const [busyBatch, setBusyBatch] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ sets: BankSet[] }>('/questions/bank/sets');
    setSets(res.sets);
  }, []);

  const loadBatch = useCallback(async (batchId: string) => {
    const res = await api<QuestionBankBatchResponse>(`/questions/bank/batches/${batchId}`);
    setBatch(res);
  }, []);

  useEffect(() => {
    if (!canRead) {
      setSets([]);
      return;
    }
    void load().catch(() => setSets([]));
  }, [canRead, load, refreshSignal]);

  // Poll only while something is still generating; stops once everything
  // settles so an idle page makes no requests.
  const anyActive =
    (sets ?? []).some((s) => s.active > 0) || (open !== null && (batch?.active ?? 0) > 0);
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => {
      void load().catch(() => {});
      if (open) void loadBatch(open).catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [anyActive, open, load, loadBatch]);

  async function toggle(batchId: string) {
    if (open === batchId) {
      setOpen(null);
      setBatch(null);
      return;
    }
    setOpen(batchId);
    setBatch(null);
    await loadBatch(batchId);
  }

  async function retry(batchId: string) {
    setBusyBatch(batchId);
    try {
      await api(`/questions/bank/batches/${batchId}/retry-failed`, { method: 'POST' });
      await Promise.all([load(), loadBatch(batchId)]);
      toast.success('Retrying failed questions');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to retry generation');
    } finally {
      setBusyBatch(null);
    }
  }

  async function cancel(batchId: string) {
    setBusyBatch(batchId);
    try {
      await api(`/questions/bank/batches/${batchId}/cancel`, { method: 'POST' });
      await Promise.all([load(), loadBatch(batchId)]);
      toast.success('Cancelling generation');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel generation');
    } finally {
      setBusyBatch(null);
    }
  }

  if (!canRead || sets === null) return null;
  if (sets.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" /> Recent question sets
          </CardTitle>
          <CardDescription>Every batch of AI-generated questions, newest first.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {sets.map((s) => (
          <div key={s.batchId} className="rounded-lg border p-3">
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
              onClick={() => void toggle(s.batchId)}
            >
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  open === s.batchId && 'rotate-180',
                )}
              />
              <span className="font-mono text-xs text-muted-foreground">
                {s.batchId.slice(0, 8)}
              </span>
              <span className="text-sm text-muted-foreground">
                {new Date(s.createdAt).toLocaleString()}
              </span>
              {s.active > 0 && <Badge variant="secondary">{s.active} running</Badge>}
              {s.failed > 0 && <Badge variant="destructive">{s.failed} failed</Badge>}
              {s.cancelled > 0 && <Badge variant="outline">{s.cancelled} cancelled</Badge>}
              <span className="ml-auto text-sm font-medium">{s.generated} questions</span>
            </button>
            {open === s.batchId &&
              (batch ? (
                <div className="mt-3 space-y-1.5 border-t pt-2">
                  {batch.jobs.map((j) => (
                    <div key={j.jobId} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-40 truncate">{j.questionType}</span>
                      <span className="text-muted-foreground">{j.difficulty}</span>
                      <StatusBadge status={j.status} />
                      <span className="ml-auto text-muted-foreground">
                        {j.generated ?? 0}/{j.requested}
                      </span>
                      {j.error && (
                        <span className="w-full text-destructive" title={j.error}>
                          {j.error}
                        </span>
                      )}
                    </div>
                  ))}
                  {canManage && (canRetryBatch(batch) || canCancelBatch(batch)) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {canRetryBatch(batch) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyBatch !== null}
                          onClick={() => void retry(s.batchId)}
                        >
                          {busyBatch === s.batchId ? 'Working…' : 'Retry failed'}
                        </Button>
                      )}
                      {canCancelBatch(batch) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyBatch !== null}
                          onClick={() => void cancel(s.batchId)}
                        >
                          Cancel
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {questionBankBatchPhase(batch)}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading batch…
                </div>
              ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
