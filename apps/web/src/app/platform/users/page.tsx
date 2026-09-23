'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, ShieldAlert, UsersRound } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { usePlatform } from '@/lib/platform';
import {
  filterPlatformUsers,
  formatDate,
  platformUserActions,
  SUPER_ADMIN_ROLE,
  type PlatformUserAction,
  type PlatformUserStatusFilter,
  type PlatformUserSummary,
} from '@/lib/platform-scope';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState } from '@/components/app/error-state';
import { EmptyState } from '@/components/app/empty-state';
import { SkeletonRows } from '@/components/app/loading';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { StatusBadge } from '@/components/app/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const statusTabs: { value: PlatformUserStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
];

type Pending = { type: PlatformUserAction; user: PlatformUserSummary } | null;

export default function PlatformUsersPage() {
  const { can } = usePlatform();
  const [users, setUsers] = useState<PlatformUserSummary[]>([]);
  const [status, setStatus] = useState<PlatformUserStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const canRead = can('platform-users.read');
  const canMutate = can('platform-users.update');

  const load = useCallback(async (filter: PlatformUserStatusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api<PlatformUserSummary[]>(
        `/platform/users${filter === 'all' ? '' : `?status=${filter}`}`,
      );
      setUsers(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load platform users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canRead) load(status);
    // fetch-once per tab matches the API's status filter surface
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canRead]);

  const visible = filterPlatformUsers(users, status, query);

  async function grantSuperAdmin(user: PlatformUserSummary) {
    setBusy(true);
    try {
      await api(`/platform/users/${user.id}/roles`, {
        method: 'POST',
        body: { roleKey: SUPER_ADMIN_ROLE },
      });
      toast.success(`${user.name || user.email} is now a Super Admin`);
      await load(status);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to grant Super Admin');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    const { type, user } = pending;
    setBusy(true);
    try {
      if (type === 'revoke-super-admin') {
        const role = user.platformRoles.find((r) => r.key === SUPER_ADMIN_ROLE);
        if (!role) throw new ApiError(404, 'Platform role not found');
        await api(`/platform/users/${user.id}/roles/${role.id}`, { method: 'DELETE' });
        toast.success(`Removed Super Admin from ${user.name || user.email}`);
      } else if (type === 'suspend') {
        await api(`/platform/users/${user.id}/suspend`, { method: 'POST' });
        toast.success(`Suspended ${user.name || user.email}`);
      } else {
        await api(`/platform/users/${user.id}/reactivate`, { method: 'POST' });
        toast.success(`Reactivated ${user.name || user.email}`);
      }
      setPending(null);
      await load(status);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('Request failed');
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader title="Platform users" description="Operators holding platform roles." />
        <EmptyState
          icon={<ShieldAlert className="size-5" />}
          title="Admin access required"
          description="Only platform admins with the platform-users.read permission can manage platform users."
        />
      </div>
    );
  }

  const pendingUser = pending?.user;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform users"
        description="Super Admin operators on the CatLium platform, with role and account lifecycle controls."
      />

      <Tabs value={status} onValueChange={(v) => setStatus(v as PlatformUserStatusFilter)}>
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
              placeholder="Search name or email…"
              className="pl-9"
              aria-label="Search platform users"
            />
          </div>
        </div>
      </Tabs>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorState
          title="Couldn't load platform users"
          description={error}
          onRetry={() => load(status)}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<UsersRound className="size-5" />}
          title={users.length === 0 ? 'No platform users yet' : 'No users match your filters'}
          description={
            users.length === 0
              ? 'Grant the SUPER_ADMIN role to an existing account to create the first platform operator.'
              : 'Try a different status tab or search query.'
          }
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Platform roles</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                {canMutate && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((user) => {
                const actions = platformUserActions(canMutate, user);
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <span className="block font-medium">{user.name || '—'}</span>
                      <span className="block text-xs text-muted-foreground">{user.email}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    <TableCell>
                      {user.platformRoles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          {user.platformRoles.map((role) => (
                            <Badge key={role.id} variant="secondary" className="font-medium">
                              {role.key.replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    {canMutate && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {actions.includes('grant-super-admin') && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => grantSuperAdmin(user)}
                            >
                              Grant Super Admin
                            </Button>
                          )}
                          {actions.includes('revoke-super-admin') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => setPending({ type: 'revoke-super-admin', user })}
                            >
                              Revoke
                            </Button>
                          )}
                          {actions.includes('suspend') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => setPending({ type: 'suspend', user })}
                            >
                              Suspend
                            </Button>
                          )}
                          {actions.includes('reactivate') && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => setPending({ type: 'reactivate', user })}
                            >
                              Reactivate
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && !busy && setPending(null)}
        title={
          pending?.type === 'revoke-super-admin'
            ? 'Remove Super Admin?'
            : pending?.type === 'suspend'
              ? 'Suspend user?'
              : 'Reactivate user?'
        }
        description={
          pending?.type === 'revoke-super-admin'
            ? `${pendingUser?.name || pendingUser?.email} loses all platform authority immediately. Institute access from memberships is unaffected.`
            : pending?.type === 'suspend'
              ? `${pendingUser?.name || pendingUser?.email} is locked out of every plane until reactivated. All active sessions are revoked; no data is deleted.`
              : `${pendingUser?.name || pendingUser?.email} regains access to every plane immediately. They must sign in afresh — revoked sessions are not restored.`
        }
        confirmLabel={
          pending?.type === 'revoke-super-admin'
            ? 'Remove role'
            : pending?.type === 'suspend'
              ? 'Suspend'
              : 'Reactivate'
        }
        destructive={pending?.type !== 'reactivate'}
        loading={busy}
        onConfirm={confirmPending}
      />
    </div>
  );
}