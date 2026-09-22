'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { usePlatform } from '@/lib/platform';
import {
  filterInstitutes,
  formatDate,
  type InstituteDetail,
  type InstituteSummary,
  type InstituteStatusFilter,
} from '@/lib/platform-scope';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState } from '@/components/app/error-state';
import { EmptyState } from '@/components/app/empty-state';
import { SkeletonRows } from '@/components/app/loading';
import { StatusBadge } from '@/components/app/status-badge';
import { CreateInstituteDialog } from '@/components/app/create-institute-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const statusTabs: { value: InstituteStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
];

export default function PlatformInstitutesPage() {
  const { can } = usePlatform();
  const [institutes, setInstitutes] = useState<InstituteSummary[]>([]);
  const [status, setStatus] = useState<InstituteStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (filter: InstituteStatusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api<InstituteSummary[]>(
        `/platform/institutes${filter === 'all' ? '' : `?status=${filter}`}`,
      );
      setInstitutes(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load institutes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(status);
    // fetch-once per tab matches the API's status filter surface
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const visible = filterInstitutes(institutes, 'all', query);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institutes"
        description="Every tenant on the CatLium platform, with lifecycle and subscription controls."
        actions={
          can('institutes.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Create institute
            </Button>
          ) : undefined
        }
      />

      <Tabs value={status} onValueChange={(v) => setStatus(v as InstituteStatusFilter)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            {statusTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or slug…"
              className="pl-9"
              aria-label="Search institutes"
            />
          </div>
        </div>
      </Tabs>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorState
          title="Couldn't load institutes"
          description={error}
          onRetry={() => load(status)}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title={institutes.length === 0 ? 'No institutes yet' : 'No institutes match your filters'}
          description={
            institutes.length === 0
              ? 'Create the first tenant to get started.'
              : 'Try a different status tab or search query.'
          }
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Institute</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((institute) => (
                <TableRow key={institute.id}>
                  <TableCell>
                    <Link href={`/platform/institutes/${institute.id}`} className="group block">
                      <span className="block font-medium group-hover:text-primary">
                        {institute.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        / {institute.slug}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={institute.status} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {formatDate(institute.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/platform/institutes/${institute.id}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateInstituteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(detail) => setInstitutes((rows) => [detail, ...rows])}
      />
    </div>
  );
}
