'use client';

import { useRef, useState } from 'react';
import { FileUp, ScanSearch, Type } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError, uploadFileWithChunks } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ExtractQuestionPaperResponse } from '@catlium/contracts';

interface QuestionSourceExtractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Endpoint family: '/questions' fills the Question Bank (no paper is
   *  created, paperId comes back null); '/question-papers' creates a Question
   *  Paper and returns its paperId. */
  basePath: '/questions' | '/question-papers';
  onStarted: (extraction: { jobId: string; paperId: string | null }) => void;
}

/** Paste-exam-text / upload-PDF→(OCR) dialog for turning a real paper into
 *  reviewable extracted questions — either into the Question Bank tray or into
 *  a new Question Paper, depending on the endpoint family. Files upload in 2MB
 *  chunks for the tunnel. */
export function QuestionSourceExtractionDialog({
  open,
  onOpenChange,
  basePath,
  onStarted,
}: QuestionSourceExtractionDialogProps) {
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    let response: ExtractQuestionPaperResponse;
    try {
      if (mode === 'text') {
        if (!text.trim()) {
          toast.error('Paste the paper text first');
          return;
        }
        const endpoint =
          basePath === '/questions'
            ? `${basePath}/extract-source-text`
            : `${basePath}/extract-text`;
        response = await api<ExtractQuestionPaperResponse>(endpoint, {
          method: 'POST',
          body: { text },
        });
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          toast.error('Choose the paper source file first');
          return;
        }
        const endpoint =
          basePath === '/questions'
            ? `${basePath}/extract-source-file`
            : `${basePath}/extract-file`;
        response = await uploadFileWithChunks<ExtractQuestionPaperResponse>(endpoint, file, {});
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start extraction');
      return;
    }

    setBusy(true);
    toast.dismiss();
    try {
      toast.success(response.extraction.reused ? 'Extraction already done' : 'Extraction started');
      onStarted({
        jobId: response.extraction.jobId,
        paperId: response.extraction.paperId,
      });
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {basePath === '/questions' ? 'Extract Questions from Source' : 'Extract Question Paper'}
          </DialogTitle>
          <DialogDescription>
            Paste the exam paper text or upload a PDF/image of it. The questions are detected and
            staged for review{' '}
            {basePath === '/questions' ? 'in the Question Bank' : 'into a new Question Paper'}.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v === 'file' ? 'file' : 'text')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">
              <Type className="mr-1 size-3.5" /> Paste text
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileUp className="mr-1 size-3.5" /> Upload file
            </TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="space-y-3">
            <Label htmlFor="source-text">Exam paper text</Label>
            <Textarea
              id="source-text"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                '1. What is the capital of France? (2 marks)\n2. Solve for x: 3x + 2 = 11…'
              }
            />
          </TabsContent>
          <TabsContent value="file" className="space-y-3">
            <Label htmlFor="source-file">PDF or image (PNG/JPEG/WebP)</Label>
            <Input
              id="source-file"
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
            />
            <p className="text-xs text-muted-foreground">
              The file is OCR&rsquo;d on upload; printed or photographed past papers work.
            </p>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="w-full sm:w-auto">
            <ScanSearch className="mr-1 size-3.5" />
            {busy ? 'Extracting…' : 'Extract'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
