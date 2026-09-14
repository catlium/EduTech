'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const RESOURCE_TYPES: { type: string; label: string }[] = [
  { type: 'NOTE', label: 'Notes' },
  { type: 'SUMMARY', label: 'Summary' },
  { type: 'FLASHCARD_SET', label: 'Flashcards' },
  { type: 'IMPORTANT_CONCEPTS', label: 'Concepts' },
  { type: 'CORNELL_NOTE', label: 'Cornell Notes' },
];

export function GenerateResourcesDialog({
  open,
  onOpenChange,
  onGenerate,
  starting,
  sourceLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (types: string[]) => void;
  starting: boolean;
  sourceLabel?: string;
}) {
  const [selected, setSelected] = useState<string[]>(RESOURCE_TYPES.map((t) => t.type));
  useEffect(() => {
    if (open) setSelected(RESOURCE_TYPES.map((t) => t.type));
  }, [open]);
  const toggle = (type: string) =>
    setSelected((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate learning resources</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {sourceLabel ? `For ${sourceLabel}. ` : ''}Content is derived strictly from what the
          source materials cover.
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
            onClick={() => onGenerate(RESOURCE_TYPES.map((t) => t.type))}
            disabled={starting}
          >
            <Sparkles className="mr-1 size-3.5" /> Generate all
          </Button>
          <Button onClick={() => onGenerate(selected)} disabled={starting || selected.length === 0}>
            {starting ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            Generate {selected.length ? `${selected.length} selected` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
