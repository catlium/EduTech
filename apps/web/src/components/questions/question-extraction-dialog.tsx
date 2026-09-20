'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileSearch, Loader2 } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import {
  ScopeCascade,
  type ScopeCascade as ScopeCascadeType,
} from '@/components/app/scope-cascade';
import { EmptyState } from '@/components/app/empty-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
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
  MaterialResponse,
} from '@catlium/contracts';

interface QuestionExtractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: SubjectResponse[];
  chapters: ChapterResponse[];
  topics: TopicResponse[];
  onCreated: (jobId: string) => void;
}

export function QuestionExtractionDialog({
  open,
  onOpenChange,
  subjects,
  chapters,
  topics,
  onCreated,
}: QuestionExtractionDialogProps) {
  const [materials, setMaterials] = useState<MaterialResponse[]>([]);
  const [materialId, setMaterialId] = useState('');
  const [cascade, setCascade] = useState<ScopeCascadeType>({
    subjectId: '',
    chapterId: '',
    topicId: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api<{ materials: MaterialResponse[] }>('/materials', { signal: ctrl.signal })
      .then(({ materials: all }) =>
        setMaterials(
          all
            .filter((m) => m.processingStatus === 'READY')
            .sort((a, b) => a.title.localeCompare(b.title)),
        ),
      )
      .catch(() => setMaterials([]));
    return () => ctrl.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setMaterialId('');
    setCascade({ subjectId: '', chapterId: '', topicId: '' });
    setSubmitting(false);
  }, [open]);

  const readyMaterials = useMemo(
    () => materials.filter((m) => m.processingStatus === 'READY'),
    [materials],
  );

  const canSubmit = !!materialId && !!cascade.subjectId && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const resp = await api<{
        extraction: { jobId: string; status: string; reused: boolean };
      }>('/questions/extract-from-material', {
        method: 'POST',
        body: {
          materialId,
          subjectId: cascade.subjectId,
          ...(cascade.chapterId ? { chapterId: cascade.chapterId } : {}),
          ...(cascade.topicId ? { topicId: cascade.topicId } : {}),
        },
      });
      toast.success(
        resp.extraction.reused
          ? 'An identical extraction already exists — opening its review'
          : 'Extraction queued — review the detected questions',
      );
      onCreated(resp.extraction.jobId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start extraction');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="size-4" /> Extract Questions
          </DialogTitle>
          <DialogDescription>
            A source material is scanned for numbered, lettered and multi-part questions. Every
            detected question is stored as a review candidate you accept, edit or discard before it
            enters the bank.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {readyMaterials.length === 0 ? (
            <EmptyState
              icon={<FileSearch className="size-6" />}
              title="No ready materials"
              description="Upload and finish processing a material first — extraction needs its final text."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Source material</label>
                <Select value={materialId} onValueChange={setMaterialId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a processed material" />
                  </SelectTrigger>
                  <SelectContent>
                    {readyMaterials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {materialId
                    ? 'The material is scanned as-is — its extracted text and enhancement blocks are the only source.'
                    : 'Only READY materials are listed.'}
                </p>
              </div>

              <div className="grid gap-2">
                <ScopeCascade
                  cascade={cascade}
                  subjects={subjects}
                  chapters={chapters}
                  topics={topics}
                  onChange={setCascade}
                />
                <p className="text-xs text-muted-foreground">
                  Subject is required. Chapter or topic are just clues for mapping each question’s
                  scope — a question that doesn’t match is still kept, subject-level.
                </p>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <FileSearch className="mr-1 size-3.5" />
            )}
            Extract questions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
