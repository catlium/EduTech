'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DocumentModel } from './doc-blocks';
import { RenderDocHtml } from './render-doc-html';
import { ApiError } from '@/lib/api';

export interface ExportPreviewValue {
  hash: string;
  document: DocumentModel;
  html: string;
}

/** localStorage key for an assessment preview hash — the assessment page
 * reads this to enable its export buttons only for the previewed revision. */
export const previewStorageKey = (
  assessmentId: string,
  include: 'paper' | 'answers',
  rev: string,
) => `catlium:export-preview:${assessmentId}:${include}:${rev}`;

interface ExportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  load: () => Promise<ExportPreviewValue>;
  /* Called with the freshly built preview so the page can store the hash. */
  onPreviewed: (preview: ExportPreviewValue) => void;
}

/* Shared preview surface used by Paper Pattern and Question Bank export. The
 * preview is rebuilt from the server on every open and returns the document
 * hash — export is only allowed with a hash that still matches, so the file
 * always reflects exactly what was previewed. */
export function ExportPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  load,
  onPreviewed,
}: ExportPreviewDialogProps) {
  const [preview, setPreview] = useState<ExportPreviewValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const build = useCallback(() => {
    setLoading(true);
    setError(null);
    void loadRef
      .current()
      .then((p) => {
        setPreview(p);
        onPreviewed(p);
      })
      .catch((err) => {
        setPreview(null);
        setError(err instanceof ApiError ? err.message : 'Failed to build preview');
      })
      .finally(() => setLoading(false));
  }, [onPreviewed]);

  useEffect(() => {
    if (open) build();
    // Re-build on every open so a stale preview is never shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Building preview…
          </div>
        )}

        {!loading && error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && preview && (
          <>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Eye className="size-3.5" />
              Preview #{preview.hash.slice(0, 8)} — the exported file will match this exactly.
            </p>
            <div className="rounded-md border bg-background p-4">
              <RenderDocHtml html={preview.html} />
            </div>
          </>
        )}

        <DialogFooter>
          {!loading && !error && (
            <Button variant="outline" onClick={build} disabled={loading}>
              Refresh preview
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
