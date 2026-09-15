'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import type {
  MaterialProcessingStatus,
  OcrPageDetail,
  OcrPageListResponse,
} from '@catlium/contracts';

import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  extracted: 'bg-blue-500/15 text-blue-600',
  corrected: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-red-500/15 text-red-700',
  missing: 'bg-amber-500/15 text-amber-700',
};

const CHUNK_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  claimed: 'bg-blue-500/15 text-blue-600',
  submitted: 'bg-green-500/15 text-green-700',
  failed: 'bg-red-500/15 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
};

type Props = {
  materialId: string;
  processingStatus: MaterialProcessingStatus;
  canEdit: boolean;
  onRetry: () => void;
  onChanged: () => void;
};

export function OcrInspection({
  materialId,
  processingStatus,
  canEdit,
  onRetry,
  onChanged,
}: Props) {
  const [data, setData] = useState<OcrPageListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(1);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const ctrl = new AbortController();
    api<OcrPageListResponse>(`/materials/${materialId}/ocr-pages`, { signal: ctrl.signal })
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof ApiError ? err.message : 'Failed to load OCR pages');
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [materialId]);

  useEffect(() => {
    return load();
  }, [load]);

  // Refresh the page list while OCR is actively running (~3s poll, one
  // interval, aborted + cleared on unmount).
  const active = processingStatus === 'QUEUED' || processingStatus === 'PROCESSING';
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const id = setInterval(() => {
      api<OcrPageListResponse>(`/materials/${materialId}/ocr-pages`, { signal: ctrl.signal })
        .then((res) => setData(res))
        .catch(() => {});
    }, 3000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [active, materialId]);

  useEffect(() => {
    if (data && selected > data.pages.length) {
      setSelected(Math.max(1, data.pages.length));
    }
  }, [data, selected]);

  if (loading) {
    return <p className="px-6 py-4 text-sm text-muted-foreground">Loading OCR pages…</p>;
  }

  if (error || !data) {
    return <p className="px-6 py-4 text-sm text-red-600">{error ?? 'No OCR data'}</p>;
  }

  const problems =
    data.chunks.some((c) => c.status === 'failed') ||
    data.pages.some((p) => p.status === 'failed' || p.status === 'missing');

  const page = data.pages.find((p) => p.page === selected) ?? null;

  async function saveCorrection() {
    if (!page || draft === null) return;
    setSaving(true);
    try {
      const res = await api<{ page: OcrPageDetail }>(
        `/materials/${materialId}/ocr-pages/${page.page}/correction`,
        { method: 'PUT', body: { text: draft } },
      );
      toast.success(`Correction saved for page ${page.page}`);
      setDraft(null);
      setData((prev) =>
        prev ? { ...prev, pages: prev.pages.map((p) => (p.page === page.page ? res.page : p)) } : prev,
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save correction');
    } finally {
      setSaving(false);
    }
  }

  async function clearCorrection() {
    if (!page) return;
    setSaving(true);
    try {
      const res = await api<{ page: OcrPageDetail }>(
        `/materials/${materialId}/ocr-pages/${page.page}/correction`,
        { method: 'DELETE' },
      );
      toast.success(`Restored original OCR text for page ${page.page}`);
      setDraft(null);
      setData((prev) =>
        prev ? { ...prev, pages: prev.pages.map((p) => (p.page === page.page ? res.page : p)) } : prev,
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to restore original text');
    } finally {
      setSaving(false);
    }
  }

  function displayText(pageDetail: OcrPageDetail): string {
    return pageDetail.correctedText ?? pageDetail.text ?? '';
  }

  return (
    <div className="space-y-4">
      {problems && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-500/5 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <div className="flex-1">
            <p className="font-medium text-red-700">OCR incomplete for this material</p>
            <p className="text-red-600/80">
              Failed or missing pages below are not included in the extracted text. Do not treat
              this material as complete until these are resolved.
            </p>
            <Button variant="outline" size="sm" className="mt-1.5" onClick={onRetry}>
              Retry processing
            </Button>
          </div>
        </div>
      )}

      {data.chunks.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chunk</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.chunks.map((chunk) => (
                <TableRow key={chunk.id}>
                  <TableCell className="font-medium">chunk {chunk.chunkIndex}</TableCell>
                  <TableCell>
                    {chunk.startPage}–{chunk.endPage}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${CHUNK_STATUS_STYLES[chunk.status] ?? ''} border-0`}>
                      {chunk.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{chunk.attempts}</TableCell>
                  <TableCell className="max-w-[240px] truncate">
                    {chunk.error ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">
            Pages {data.documentPages ? `(1–${data.documentPages})` : ''}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={selected <= 1}
              onClick={() => setSelected((p) => p - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-16 text-center text-sm tabular-nums">
              {selected} / {Math.max(1, data.pages.length)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={selected >= data.pages.length}
              onClick={() => setSelected((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mb-3 flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-lg border p-2">
          {data.pages.map((p) => (
            <button
              key={p.page}
              onClick={() => setSelected(p.page)}
              title={`Page ${p.page} · ${p.status}`}
              className={`size-7 rounded text-xs font-medium transition-colors ${
                PAGE_STATUS_STYLES[p.status] ?? 'bg-muted text-muted-foreground'
              } ${p.page === selected ? 'ring-2 ring-ring ring-offset-1' : ''}`}
            >
              {p.page}
            </button>
          ))}
        </div>
      </div>

      {page && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                Page {page.page}
                <Badge className={`${PAGE_STATUS_STYLES[page.status] ?? ''} border-0`}>
                  {page.status}
                </Badge>
                {page.source && (
                  <span className="text-xs font-normal text-muted-foreground">
                    source: {page.source}
                  </span>
                )}
              </span>
              {page.correctedAt && (
                <span className="text-xs font-normal text-muted-foreground">
                  corrected {new Date(page.correctedAt).toLocaleString()}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {page.status === 'pending' && (
              <p className="text-sm text-muted-foreground">
                This page belongs to a chunk that has not been OCR'd yet.
              </p>
            )}
            {(page.status === 'failed' || page.status === 'missing') && (
              <p className="text-sm text-muted-foreground">
                {page.status === 'missing'
                  ? 'This page produced no extracted text (coverage hole) and is excluded from the extracted text until processing succeeds.'
                  : 'This page is inside a failed chunk and is excluded from the extracted text until processing succeeds.'}
              </p>
            )}

            {page.status !== 'pending' && page.status !== 'failed' && page.status !== 'missing' ? (
              <>
                {page.correctedText && page.text && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Original OCR output</p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                      {page.text}
                    </pre>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {page.correctedText ? 'Corrected text' : 'Extracted text'}
                  </p>
                  {canEdit ? (
                    <>
                      <Textarea
                        rows={8}
                        value={draft ?? displayText(page)}
                        onChange={(e) => setDraft(e.target.value)}
                        className="font-mono text-xs leading-relaxed"
                      />
                      {draft !== null && (
                        <div className="mt-2 flex items-center gap-2">
                          <Button size="sm" onClick={saveCorrection} disabled={saving || draft.length === 0}>
                            <Pencil className="size-3.5" /> Save correction
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                            Cancel
                          </Button>
                          {page.correctedText && currentDraftEqualsOriginal(draft, page.text) && (
                            <Button variant="outline" size="sm" onClick={clearCorrection} disabled={saving}>
                              Restore original OCR text
                            </Button>
                          )}
                        </div>
                      )}
                      {draft === null && page.correctedText && (
                        <Button variant="outline" size="sm" onClick={clearCorrection} disabled={saving}>
                          Restore original OCR text
                        </Button>
                      )}
                    </>
                  ) : (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">
                      {displayText(page)}
                    </pre>
                  )}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function currentDraftEqualsOriginal(draft: string, original: string | null): boolean {
  return draft === (original ?? '');
}