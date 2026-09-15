'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Activity,
  FileText,
  BookMarked,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Layers,
  Lightbulb,
  FileText as CornellIcon,
  Sparkles,
} from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState } from '@/components/app/error-state';
import { SkeletonCards } from '@/components/app/loading';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface JobListItem {
  id: string;
  type: string;
  status: string;
  error: string | null;
  sourceType: string | null;
  sourceId: string | null;
  batchId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const statusStyles: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  processing: 'bg-blue-500/15 text-blue-600',
  completed: 'bg-green-500/15 text-green-700',
  failed: 'bg-red-500/15 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
  cancelling: 'bg-muted text-muted-foreground',
};

const typeLabel: Record<string, string> = {
  AI_GENERATE_NOTE: 'Notes',
  AI_GENERATE_SUMMARY: 'Summary',
  AI_GENERATE_FLASHCARDS: 'Flashcards',
  AI_GENERATE_CONCEPTS: 'Concepts',
  AI_GENERATE_CONTENT_PACKAGE: 'Content package',
  AI_GENERATE_CORNELL_NOTE: 'Cornell notes',
  AI_GENERATE_QUESTIONS: 'Questions',
  AI_GENERATE_BLUEPRINT: 'Blueprint',
  AI_GENERATE_STARTER_MATERIAL: 'Starter material',
  AI_ANALYZE_SYLLABUS: 'Syllabus analysis',
  MATERIAL_PROCESS: 'Material process',
};

const typeIcon: Record<string, React.ReactNode> = {
  AI_GENERATE_NOTE: <FileText className="size-4" />,
  AI_GENERATE_SUMMARY: <Layers className="size-4" />,
  AI_GENERATE_FLASHCARDS: <BookMarked className="size-4" />,
  AI_GENERATE_CONCEPTS: <Lightbulb className="size-4" />,
  AI_GENERATE_CORNELL_NOTE: <CornellIcon className="size-4" />,
  AI_GENERATE_QUESTIONS: <Activity className="size-4" />,
};

export default function JobsPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const searchParams = useSearchParams();

  const initialStatus = searchParams.get('status') ?? '';
  const validFilters = ['', 'queued', 'processing', 'completed', 'failed', 'cancelled'];

  const [status, setStatus] = useState<string>(
    validFilters.includes(initialStatus) ? initialStatus : '',
  );
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(
    async (showSpinner = true) => {
      if (!isTeacher) return;
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (status) query.set('status', status);
        const res = await api<{
          jobs: JobListItem[];
          labels: Record<string, Record<string, string>>;
          total: number;
        }>(`/jobs?${query.toString()}`);
        setJobs(res.jobs);
        setLabels(res.labels);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load jobs');
      } finally {
        setLoading(false);
      }
    },
    [isTeacher, status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function retryJob(jobId: string) {
    setRetrying(jobId);
    try {
      await api<{ job: { status: string } }>(`/jobs/${jobId}/retry`, { method: 'POST' });
      toast.success('Job requeued');
      void load(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to requeue job');
    } finally {
      setRetrying(null);
    }
  }

  async function cancelJob(jobId: string) {
    setCancelling(jobId);
    try {
      await api<{ job: { status: string } }>(`/jobs/${jobId}/cancel`, { method: 'POST' });
      toast.success('Job cancel requested');
      void load(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel job');
    } finally {
      setCancelling(null);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (status) query.set('status', status.toLowerCase());
      const res = await api<{
        jobs: JobListItem[];
        labels: Record<string, Record<string, string>>;
        total: number;
      }>(`/jobs?${query.toString()}`);
      setJobs(res.jobs);
      setLabels(res.labels);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }

  function sourceLabel(job: JobListItem): string {
    if (!job.sourceType || !job.sourceId) return '';
    const table = labels[job.sourceType];
    return table?.[job.sourceId] ?? '';
  }

  return (
    <div className="page">
      <PageHeader
        title="Job Monitor"
        actions={
          isTeacher && (
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              <RefreshCw className="mr-1 size-3.5" /> Refresh
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {['', 'queued', 'processing', 'completed', 'failed', 'cancelled'].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              status === s
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {s === '' ? `All (${total})` : s}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonCards />
      ) : error ? (
        <ErrorState title="Could not load jobs" description={error} />
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No {status || 'jobs'} yet — start generation from a topic, chapter, or subject.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted">
                  {typeIcon[job.type] ?? <Activity className="size-4" />}
                </span>
                <span className="font-medium">{typeLabel[job.type] ?? job.type}</span>
                <Badge className={`${statusStyles[job.status] ?? ''} border-0`}>{job.status}</Badge>
                <span className="text-xs text-muted-foreground capitalize">
                  {job.type.startsWith('AI_')
                    ? `for ${sourceLabel(job) || job.sourceType?.toLowerCase() || ''}`
                    : ''}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="truncate font-mono text-[11px]">{job.id}</span>
                {job.batchId && <span>batch {job.batchId.slice(0, 8)}</span>}
                <span className="flex items-center gap-1">
                  <Clock className="size-3" /> {new Date(job.createdAt).toLocaleString()}
                </span>
                {job.completedAt && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> {new Date(job.completedAt).toLocaleString()}
                  </span>
                )}
                {job.status === 'FAILED' && job.error && (
                  <span className="text-red-600">{job.error}</span>
                )}
                {(job.status === 'failed' || job.status === 'cancelled') && (
                  <button
                    onClick={() => void retryJob(job.id)}
                    disabled={retrying === job.id}
                    className="text-primary hover:underline disabled:opacity-50"
                  >
                    {retrying === job.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <>Requeue</>
                    )}
                  </button>
                )}
                {(job.status === 'queued' || job.status === 'processing') && (
                  <button
                    onClick={() => void cancelJob(job.id)}
                    disabled={cancelling === job.id}
                    className="text-destructive hover:underline disabled:opacity-50"
                  >
                    {cancelling === job.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <>Cancel</>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
