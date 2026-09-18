'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, BookMarked, BookOpen, Hash, Loader2, Sparkles, Trash2 } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { ChapterTree } from '@/components/app/chapter-tree';
import { StatusBadge } from '@/components/app/status-badge';
import { SectionHeader } from '@/components/app/section-header';
import { StatCard } from '@/components/app/stat-card';
import { SkeletonCards } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  GenerateResourcesDialog,
  batchStartMessages,
  type GenerateMode,
} from '@/components/app/generate-resources-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type {
  SubjectResponse,
  ChapterResponse,
  GenerationBatchResponse,
  GenerateBatchJobIds,
} from '@catlium/contracts';

export default function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const router = useRouter();
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [subject, setSubject] = useState<SubjectResponse | null>(null);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showChapterDialog, setShowChapterDialog] = useState(false);
  const [newChapterName, setNewChapterName] = useState('');
  const [adding, setAdding] = useState(false);
  const [topicCount, setTopicCount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDependents, setDeleteDependents] = useState<string[]>([]);
  const [confirmName, setConfirmName] = useState('');
  const [confirmForce, setConfirmForce] = useState(false);
  const [starting, setStarting] = useState(false);
  const [batch, setBatch] = useState<{
    batchId: string;
    status: GenerationBatchResponse | null;
  } | null>(null);

  const load = useCallback(async () => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        api<{ subject: SubjectResponse }>(`/academic/subjects/${subjectId}`),
        api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${subjectId}/chapters`),
      ]);
      setSubject(s.subject);
      setChapters(c.chapters);
      const total = await Promise.all(
        c.chapters.map((ch) =>
          api<{ topics: unknown[] }>(`/academic/chapters/${ch.id}/topics`).then(
            ({ topics }) => topics.length,
          ),
        ),
      );
      setTopicCount(total.reduce((a, b) => a + b, 0));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Failed to load subject. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [institute, subjectId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load();
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    if (!batch) return;
    const ctrl = new AbortController();
    const tick = () => {
      api<{ batch: GenerationBatchResponse }>(`/content/generation-batches/${batch.batchId}`, {
        signal: ctrl.signal,
      })
        .then(({ batch: b }) => {
          setBatch((prev) => (prev ? { ...prev, status: b } : prev));
          if (b.active === 0) {
            setBatch(null);
            toast.success('Generation complete');
            void load();
          }
        })
        .catch(() => {});
    };
    const id = setInterval(tick, 4000);
    tick();
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.batchId]);

  async function startBatch(types: string[], mode: GenerateMode) {
    setStarting(true);
    try {
      const { batch: b } = await api<{ batch: GenerateBatchJobIds }>('/content/generate-batch', {
        method: 'POST',
        body: { sourceType: 'SUBJECT', sourceId: subjectId, types, mode },
      });
      setDialogOpen(false);
      const messages = batchStartMessages(b);
      if (messages.length > 0) {
        toast.info(messages.join(' · '));
      } else {
        toast.info('Everything is already up to date');
        return;
      }
      if (b.jobIds.length > 0) setBatch({ batchId: b.batchId, status: null });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start generation');
    } finally {
      setStarting(false);
    }
  }

  async function openDelete() {
    setConfirmName('');
    setConfirmForce(false);
    setDeleting(true);
    setDeleteOpen(true);
    try {
      const { dependents } = await api<{ dependents: string[] }>(
        `/academic/subjects/${subjectId}/dependents`,
      );
      setDeleteDependents(dependents);
    } catch {
      setDeleteDependents([]);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api(`/academic/subjects/${subjectId}?force=${confirmForce ? 'true' : 'false'}`, {
        method: 'DELETE',
      });
      toast.success('Subject deleted');
      setDeleteOpen(false);
      router.push('/subjects');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed — subject may have dependents');
    } finally {
      setDeleting(false);
    }
  }

  async function addChapter() {
    const name = newChapterName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const { chapter } = await api<{ chapter: ChapterResponse }>(
        `/academic/subjects/${subjectId}/chapters`,
        { method: 'POST', body: { name, slug } },
      );
      setChapters((prev) => [...prev, chapter]);
      setNewChapterName('');
      setShowChapterDialog(false);
      toast.success('Chapter added');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to add chapter');
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return <SkeletonCards count={2} />;
  }
  if (error || !subject) {
    return <ErrorState description={error ?? 'Subject not found.'} onRetry={() => void load()} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={subject.name}
        description={subject.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={subject.status} />
            {isTeacher && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialogOpen(true)}
                  disabled={Boolean(batch?.status?.active)}
                >
                  <Sparkles className="mr-1 size-3.5" /> Generate resources
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.push(`/syllabus`)}>
                  <BookMarked className="mr-1 size-3.5" /> Syllabus
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void openDelete()}
                  disabled={Boolean(batch?.status?.active)}
                >
                  <Trash2 className="mr-1 size-3.5" /> Delete
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard icon={BookOpen} label="Chapters" value={chapters.length} />
        <StatCard icon={Hash} label="Topics" value={topicCount} />
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Chapters"
          description={`${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}`}
          actions={
            isTeacher && (
              <Button size="sm" variant="outline" onClick={() => setShowChapterDialog(true)}>
                <Plus className="mr-1 size-3.5" /> Add Chapter
              </Button>
            )
          }
        />
        {batch?.status && batch.status.active > 0 && (
          <Card>
            <CardContent className="flex items-center gap-2 p-3 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Generating… {batch.status.completed + batch.status.failed}/{batch.status.total}
              jobs done
            </CardContent>
          </Card>
        )}
        <ChapterTree
          subjectId={subjectId}
          isTeacher={isTeacher}
          chapters={chapters.sort((a, b) => a.sortOrder - b.sortOrder)}
        />
      </section>

      <Dialog open={showChapterDialog} onOpenChange={setShowChapterDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add chapter</DialogTitle>
            <DialogDescription>Chapters organize topics within {subject.name}.</DialogDescription>
          </DialogHeader>
          <Input
            value={newChapterName}
            onChange={(e) => setNewChapterName(e.target.value)}
            placeholder="Chapter name..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addChapter();
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowChapterDialog(false)} disabled={adding}>
              Cancel
            </Button>
            <Button disabled={adding || !newChapterName.trim()} onClick={() => void addChapter()}>
              {adding ? 'Adding...' : 'Add Chapter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenerateResourcesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onGenerate={(types, mode) => void startBatch(types, mode)}
        starting={starting}
        sourceLabel={`every topic in ${subject.name}`}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setConfirmName('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{subject.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Everything under this subject will be removed too.
            </DialogDescription>
          </DialogHeader>

          {deleteDependents.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              <p className="font-medium">This subject still contains:</p>
              <ul className="mt-1 list-inside list-disc">
                {deleteDependents.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <label className="mt-3 flex items-center gap-2">
                <Checkbox
                  checked={confirmForce}
                  onCheckedChange={(v) => setConfirmForce(Boolean(v))}
                />
                Force delete — remove this subject and all of the above
              </label>
            </div>
          )}

          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={`Type ${subject.name} to confirm`}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleting ||
                confirmName !== subject.name ||
                (deleteDependents.length > 0 && !confirmForce)
              }
              onClick={() => void handleDelete()}
            >
              {deleting ? 'Deleting…' : 'Delete subject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
