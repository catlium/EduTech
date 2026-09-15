'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Cpu, Copy, KeyRound, Plus, ScanText, Server } from 'lucide-react';
import { toast } from 'sonner';

import type { OcrWorkerCapabilities, WorkerListResponse, WorkerSummary } from '@catlium/contracts';

import { api, ApiError } from '@/lib/api';
import { useTenant, isInstituteAdmin } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState } from '@/components/app/error-state';
import { SkeletonRows } from '@/components/app/loading';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

const WORKER_STATUS_STYLES: Record<string, string> = {
  processing: 'bg-blue-500/15 text-blue-600',
  idle: 'bg-green-500/15 text-green-700',
  offline: 'bg-muted text-muted-foreground',
  disabled: 'bg-amber-500/15 text-amber-700',
};

function formatAgo(value: string | null): string {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Clipboard unavailable');
  }
}

export default function OcrWorkersPage() {
  const { institute } = useTenant();
  const isAdmin = isInstituteAdmin(institute);

  const [data, setData] = useState<WorkerListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState<WorkerSummary | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api<WorkerListResponse>(`/ocr/workers`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  // ~3s monitoring poll. One interval owned by this effect; aborted + cleared
  // on unmount so the route never leaks duplicate polls.
  useEffect(() => {
    if (!isAdmin) return;
    const ctrl = new AbortController();
    const id = setInterval(() => {
      api<WorkerListResponse>(`/ocr/workers`, { signal: ctrl.signal })
        .then((res) => {
          setData(res);
          setError(null);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [isAdmin]);

  const summaryCards = useMemo(
    () => [
      { label: 'Online', value: data?.summary.online ?? 0, tone: 'text-emerald-600' },
      { label: 'Idle', value: data?.summary.idle ?? 0, tone: 'text-muted-foreground' },
      { label: 'Processing', value: data?.summary.processing ?? 0, tone: 'text-blue-600' },
      { label: 'Offline', value: data?.summary.offline ?? 0, tone: 'text-muted-foreground' },
      { label: 'Disabled', value: data?.summary.disabled ?? 0, tone: 'text-amber-600' },
    ],
    [data],
  );

  async function toggleEnabled(worker: WorkerSummary) {
    if (!worker.id) return;
    setBusyId(worker.id);
    try {
      await api(`/ocr/workers/${worker.id}`, {
        method: 'PATCH',
        body: { enabled: worker.status === 'disabled' },
      });
      toast.success(worker.status === 'disabled' ? 'Worker enabled' : 'Worker disabled');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update worker');
    } finally {
      setBusyId(null);
    }
  }

  async function rotate(worker: WorkerSummary) {
    setBusyId(worker.id);
    try {
      const res = await api<{ apiKey: string }>(`/ocr/workers/${worker.id}`, {
        method: 'PATCH',
        body: { rotateToken: true },
      });
      setRotatedKey(res.apiKey);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to rotate key');
    } finally {
      setBusyId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="OCR Workers" description="Platform-wide OCR worker registry" />
        <p className="text-sm text-muted-foreground">Insufficient permissions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="OCR Workers"
        description="Registered external OCR workers and their live status."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setNewKey(null);
              setRegisterOpen(true);
            }}
          >
            <Plus className="size-4" /> Register worker
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {summaryCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-2xl font-semibold ${c.tone}`}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : loading ? (
        <SkeletonRows rows={4} />
      ) : !data || data.workers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <ScanText className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No workers registered</p>
            <p className="text-sm text-muted-foreground">
              Register an external OCR worker to process materials.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current task</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Last heartbeat</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.workers.map((worker) => (
                <TableRow key={worker.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Server className="size-4 text-muted-foreground" />
                      {worker.name}
                      {worker.version && (
                        <Badge variant="secondary" className="font-mono text-xs">
                          {worker.version}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`${WORKER_STATUS_STYLES[worker.status] ?? ''} border-0`}>
                      {worker.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {worker.currentChunkRange ? (
                      <span className="text-sm">
                        chunk {worker.currentChunkRange.index} · pages{' '}
                        {worker.currentChunkRange.startPage}–{worker.currentChunkRange.endPage}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <CapabilityCell capabilities={worker.capabilities} />
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="size-3.5" />
                      {formatAgo(worker.lastHeartbeatAt)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === worker.id}
                        onClick={() => rotate(worker)}
                      >
                        <KeyRound className="size-3.5" /> Rotate key
                      </Button>
                      <Button
                        variant={worker.status === 'disabled' ? 'secondary' : 'outline'}
                        size="sm"
                        disabled={busyId === worker.id}
                        onClick={() => toggleEnabled(worker)}
                      >
                        {worker.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RegisterWorkerDialog
        open={registerOpen}
        apiKey={newKey}
        onClose={() => {
          setRegisterOpen(false);
          setNewKey(null);
        }}
        onRegistered={async (key) => {
          setNewKey(key);
          await load();
        }}
      />

      {rotateOpen && (
        <Dialog open onOpenChange={() => setRotateOpen(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rotate key for {rotateOpen.name}</DialogTitle>
              <DialogDescription>
                The old key stops working immediately. Show the worker using the new one.
              </DialogDescription>
            </DialogHeader>
            {rotatedKey === null && (
              <Button onClick={() => rotate(rotateOpen)} disabled={busyId === rotateOpen.id}>
                Generate new key
              </Button>
            )}
            {rotatedKey !== null && (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/50 p-3 font-mono text-sm break-all">
                  {rotatedKey}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => void copyText(rotatedKey)}
                >
                  <Copy className="size-4" /> Copy key
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setRotateOpen(null);
                  setRotatedKey(null);
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CapabilityCell({ capabilities }: { capabilities: OcrWorkerCapabilities | null }) {
  if (!capabilities) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Cpu className="size-3.5" />
        {capabilities.concurrency}×
      </span>
      {capabilities.gpu && (
        <Badge variant="secondary" className="text-xs">
          GPU
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">{capabilities.engines.join(', ')}</span>
    </div>
  );
}

function RegisterWorkerDialog({
  open,
  apiKey,
  onClose,
  onRegistered,
}: {
  open: boolean;
  apiKey: string | null;
  onClose: () => void;
  onRegistered: (apiKey: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [engines, setEngines] = useState('pymupdf,paddleocr');
  const [gpu, setGpu] = useState(false);
  const [saving, setSaving] = useState(false);

  async function register() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ workerId: string; apiKey: string }>(`/ocr/workers`, {
        method: 'POST',
        body: {
          name: name.trim(),
          ...(version.trim() ? { version: version.trim() } : {}),
          capabilities: {
            engines: engines
              .split(',')
              .map((e) => e.trim())
              .filter(Boolean),
            gpu,
            concurrency: 1,
          },
        },
      });
      await onRegistered(res.apiKey);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to register worker');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {apiKey === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Register OCR worker</DialogTitle>
              <DialogDescription>
                The worker authenticates with the API key shown once after registration.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="worker-name">Name</Label>
                <Input
                  id="worker-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="worker-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="worker-version">Version</Label>
                  <Input
                    id="worker-version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="0.1.0"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="worker-engines">Engines</Label>
                  <Input
                    id="worker-engines"
                    value={engines}
                    onChange={(e) => setEngines(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={gpu} onCheckedChange={(v) => setGpu(v === true)} />
                GPU available
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={register} disabled={saving}>
                {saving ? 'Registering…' : 'Register worker'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Worker registered</DialogTitle>
              <DialogDescription>Save this API key now — it is shown only once.</DialogDescription>
            </DialogHeader>
            <div className="rounded-lg bg-muted/50 p-3 font-mono text-sm break-all">{apiKey}</div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void copyText(apiKey)}
            >
              <Copy className="size-4" /> Copy key
            </Button>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
