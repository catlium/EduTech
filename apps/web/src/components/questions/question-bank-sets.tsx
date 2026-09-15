'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, History, Loader2, RefreshCw } from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { QuestionBankBatchResponse } from '@catlium/contracts';
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

export function QuestionBankSets() {
  const [sets, setSets] = useState<BankSet[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [batch, setBatch] = useState<QuestionBankBatchResponse | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ sets: BankSet[] }>('/questions/bank/sets');
    setSets(res.sets);
  }, []);

  useEffect(() => {
    void load().catch(() => setSets([]));
  }, [load]);

  async function toggle(batchId: string) {
    if (open === batchId) {
      setOpen(null);
      setBatch(null);
      return;
    }
    setOpen(batchId);
    setBatch(null);
    const res = await api<QuestionBankBatchResponse>(`/questions/bank/batches/${batchId}`);
    setBatch(res);
  }

  if (sets === null) return null;
  if (sets.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" /> Recent question sets
          </CardTitle>
          <CardDescription>
            Every batch of AI-generated questions, newest first.
          </CardDescription>
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
                    <div
                      key={j.jobId}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span className="w-40 truncate">{j.questionType}</span>
                      <span className="text-muted-foreground">{j.difficulty}</span>
                      <StatusBadge status={j.status} />
                      <span className="ml-auto text-muted-foreground">
                        {j.generated ?? 0}/{j.requested}
                      </span>
                    </div>
                  ))}
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