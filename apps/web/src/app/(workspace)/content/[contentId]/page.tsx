'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Archive, CheckCircle2, ChevronLeft, ChevronRight, Pencil, ExternalLink } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import type {
  ContentResponse,
  NotePayload,
  SummaryPayload,
  FlashcardSetPayload,
  ImportantConceptsPayload,
  CornellNotePayload,
} from '@catlium/contracts';
import { PageHeader } from '@/components/app/page-header';
import { StatusBadge } from '@/components/app/status-badge';
import { ErrorState } from '@/components/app/error-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { ContentPayloadEditor, type ContentType } from '@/components/app/content-payload-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

export default function ContentDetailPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();

  const [content, setContent] = useState<ContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<'activate' | 'archive' | null>(null);

  const refresh = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ content: ContentResponse }>(`/content/${contentId}`, { signal: ctrl.signal })
      .then(({ content }) => setContent(content))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof ApiError ? err.message : 'Failed to load content');
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute, contentId]);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  async function activateContent() {
    try {
      await api(`/content/${contentId}/activate`, { method: 'POST' });
      toast.success('Content activated');
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to activate');
    }
  }

  async function archiveContent() {
    try {
      await api(`/content/${contentId}/archive`, { method: 'POST' });
      toast.success('Content archived');
      setConfirmAction(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to archive');
    }
  }

  const [editDraft, setEditDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    if (!editDraft) return;
    setSaving(true);
    try {
      await api(`/content/${contentId}`, { method: 'PATCH', body: JSON.stringify({ payload: editDraft }) });
      toast.success('Content updated');
      setEditDraft(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update content');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error || !content) {
    return (
      <div>
        <PageHeader title="Content" />
        <ErrorState description={error ?? 'Content not found.'} onRetry={refresh} />
      </div>
    );
  }

  const payload = content.current.payload as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => router.push('/content')}
        >
          <ArrowLeft className="mr-1 size-3.5" /> Content
        </Button>
        <PageHeader
          title={content.title}
          actions={
            isTeacher && (
              <div className="flex gap-2">
                {isTeacher && (
                  <Button size="sm" variant="outline" onClick={() => setEditDraft(payload)}>
                    <Pencil className="mr-1 size-3.5" /> Edit
                  </Button>
                )}
                {content.status === 'DRAFT' && (
                  <Button size="sm" onClick={() => setConfirmAction('activate')}>
                    <CheckCircle2 className="mr-1 size-3.5" /> Activate
                  </Button>
                )}
                {content.status === 'ACTIVE' && (
                  <Button size="sm" variant="outline" onClick={() => setConfirmAction('archive')}>
                    <Archive className="mr-1 size-3.5" /> Archive
                  </Button>
                )}
              </div>
            )
          }
        />
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge status={content.type} />
          <StatusBadge status={content.status} />
          <StatusBadge status={content.source} />
          <span className="text-muted-foreground">{formatDateTime(content.createdAt)}</span>
        </div>
      </div>

      <Separator />

      <ProvenanceCard content={content} />

      {content.type === 'NOTE' && <NoteView payload={payload as unknown as NotePayload} />}
      {content.type === 'SUMMARY' && <SummaryView payload={payload as unknown as SummaryPayload} />}
      {content.type === 'FLASHCARD_SET' && (
        <FlashcardView payload={payload as unknown as FlashcardSetPayload} />
      )}
      {content.type === 'IMPORTANT_CONCEPTS' && (
        <ConceptsView payload={payload as unknown as ImportantConceptsPayload} />
      )}
      {content.type === 'CORNELL_NOTE' && (
        <CornellView payload={payload as unknown as CornellNotePayload} />
      )}

      <Dialog open={editDraft !== null} onOpenChange={(o) => !o && setEditDraft(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {content.type.replace(/_/g, ' ').toLowerCase()}</DialogTitle>
          </DialogHeader>
          {editDraft && (
            <ContentPayloadEditor
              type={content.type as ContentType}
              payload={editDraft}
              onChange={setEditDraft}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDraft(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmAction === 'activate'}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Activate content?"
        description="This content will be available to students."
        confirmLabel="Activate"
        onConfirm={activateContent}
      />
      <ConfirmDialog
        open={confirmAction === 'archive'}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Archive content?"
        description="This content will no longer be available to students."
        confirmLabel="Archive"
        destructive
        onConfirm={archiveContent}
      />
    </div>
  );
}

function NoteView({ payload }: { payload: NotePayload }) {
  return (
    <div className="max-w-none space-y-4">
      {payload.blocks.map((block) => {
        if (block.type === 'heading') {
          return (
            <h3 key={block.id} className="text-lg font-semibold">
              {block.content}
            </h3>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p key={block.id} className="text-sm leading-relaxed">
              {block.content}
            </p>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={block.id} className="list-disc space-y-1 pl-5 text-sm">
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          );
        }
        return null;
      })}
    </div>
  );
}

function SummaryView({ payload }: { payload: SummaryPayload }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-muted/30 p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{payload.summary}</p>
      </div>
      {payload.keyConcepts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Key Concepts</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {payload.keyConcepts.map((kc, i) => (
              <li key={i}>{kc}</li>
            ))}
          </ul>
        </div>
      )}
      {payload.importantPoints.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Important Points</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {payload.importantPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FlashcardView({ payload }: { payload: FlashcardSetPayload }) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = payload.cards;

  if (cards.length === 0) return <p className="text-sm text-muted-foreground">No cards.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {current + 1} / {cards.length}
        </span>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            disabled={current === 0}
            onClick={() => {
              setCurrent((c) => c - 1);
              setFlipped(false);
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            disabled={current === cards.length - 1}
            onClick={() => {
              setCurrent((c) => c + 1);
              setFlipped(false);
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div
        className="relative min-h-[200px] cursor-pointer rounded-lg border bg-card p-6 shadow-sm transition-shadow hover:shadow-md select-none"
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="absolute right-3 top-3 text-xs text-muted-foreground">
          {flipped ? 'Back' : 'Front'} · click to flip
        </div>
        <div className="flex min-h-[160px] items-center justify-center text-center">
          <p className="whitespace-pre-wrap text-base">
            {flipped ? cards[current].back : cards[current].front}
          </p>
        </div>
      </div>
      {payload.description && (
        <p className="text-xs text-muted-foreground">{payload.description}</p>
      )}
    </div>
  );
}

function ConceptsView({ payload }: { payload: ImportantConceptsPayload }) {
  return (
    <div className="space-y-3">
      {payload.concepts.map((c, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-1">
            <h3 className="text-sm font-semibold">{c.name}</h3>
            <p className="text-sm text-muted-foreground">{c.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CornellView({ payload }: { payload: CornellNotePayload }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Cue Column</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {payload.sections.map((s) => (
              <li key={s.id}>{s.cue}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Notes</h3>
          <div className="space-y-2 text-sm leading-relaxed">
            {payload.sections.map((s) => (
              <p key={s.id} className="whitespace-pre-wrap">
                {s.notes}
              </p>
            ))}
          </div>
        </div>
      </div>
      {payload.summary && (
        <div className="rounded-lg bg-muted/30 p-4">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Summary</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{payload.summary}</p>
        </div>
      )}
    </div>
  );
}

function ProvenanceCard({ content }: { content: ContentResponse }) {
  const ai = content.current.aiContext as Record<string, unknown> | null;
  const ref = content.current.sourceReference as Record<string, unknown> | null;
  const materialId = ref?.type === 'MATERIAL' ? (ref.materialId as string | undefined) ?? String(ref.id ?? '') : undefined;
  const materialIds = ref?.materialIds as string[] | undefined;
  const firstMaterial = materialId ?? materialIds?.[0];
  const isAiGenerated = content.source === 'AI_GENERATED' || ai?.operation != null;

  if (!isAiGenerated && !firstMaterial) return null;

  const rows: { label: string; value: string }[] = [];
  if (isAiGenerated) {
    const op = ai?.operation ? String(ai.operation) : content.source.replace('AI_', '').toLowerCase();
    const model = String(ai?.model ?? '');
    const provider = String(ai?.provider ?? '');
    const generatedAt = String(ai?.generatedAt ?? '');
    rows.push({ label: 'Generated by', value: [op, model, provider].filter(Boolean).join(' · ') || content.source });
    if (generatedAt) {
      rows.push({ label: 'Generated on', value: formatDateTime(generatedAt) });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Source</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {firstMaterial ? (
          <a
            href={`/materials/${firstMaterial}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" /> View source material
          </a>
        ) : (
          <p>From topic content</p>
        )}
        {rows.map((r) => (
          <p key={r.label} className="text-muted-foreground">
            <span className="font-medium">{r.label}:</span> {r.value}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
