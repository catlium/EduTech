'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { GenerateBatchJobIds } from '@catlium/contracts';

export const RESOURCE_TYPES: { type: string; label: string }[] = [
  { type: 'NOTE', label: 'Notes' },
  { type: 'SUMMARY', label: 'Summary' },
  { type: 'FLASHCARD_SET', label: 'Flashcards' },
  { type: 'IMPORTANT_CONCEPTS', label: 'Concepts' },
  { type: 'CORNELL_NOTE', label: 'Cornell Notes' },
];

export type GenerateMode = 'missing' | 'regenerate';

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  RESOURCE_TYPES.map((t) => [t.type, t.label]),
);

/** Human-readable outcome of starting a `generate-batch`, for toasts. */
export function batchStartMessages(b: GenerateBatchJobIds): string[] {
  const out: string[] = [];
  if (b.jobIds.length > 0) {
    out.push(`Started ${b.jobIds.length} generation job${b.jobIds.length !== 1 ? 's' : ''}`);
  }
  if (b.skipped?.some((s) => s.reason === 'starter_pending')) {
    out.push('Waiting for starter material to finish first');
  }
  const exists = new Set(
    (b.skipped ?? [])
      .filter((s) => s.reason === 'exists')
      .map((s) => TYPE_LABELS[s.type] ?? s.type),
  );
  if (exists.size > 0) out.push(`Already generated, left as-is: ${[...exists].join(', ')}`);
  if (b.alreadyActive.length > 0) {
    out.push(`Already running: ${b.alreadyActive.map((t) => TYPE_LABELS[t] ?? t).join(', ')}`);
  }
  return out;
}

export function GenerateResourcesDialog({
  open,
  onOpenChange,
  onGenerate,
  starting,
  sourceLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (types: string[], mode: GenerateMode) => void;
  starting: boolean;
  sourceLabel?: string;
}) {
  const [selected, setSelected] = useState<string[]>(RESOURCE_TYPES.map((t) => t.type));
  useEffect(() => {
    if (open) setSelected(RESOURCE_TYPES.map((t) => t.type));
  }, [open]);
  const toggle = (type: string) =>
    setSelected((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  const disabled = starting || selected.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate learning resources</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {sourceLabel ? `For ${sourceLabel}. ` : ''}Content is derived strictly from what the
          source materials cover. Generate missing keeps existing resources as-is; Regenerate
          overwrites them.
        </p>
        <div className="space-y-2">
          {RESOURCE_TYPES.map(({ type, label }) => (
            <label
              key={type}
              className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.includes(type)}
                onChange={() => toggle(type)}
              />
              <span className="flex-1 font-medium">{label}</span>
            </label>
          ))}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => onGenerate(selected, 'regenerate')}
            disabled={disabled}
          >
            <RefreshCw className="mr-1 size-3.5" /> Regenerate
          </Button>
          <Button onClick={() => onGenerate(selected, 'missing')} disabled={disabled}>
            {starting ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 size-3.5" />
            )}
            Generate missing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
