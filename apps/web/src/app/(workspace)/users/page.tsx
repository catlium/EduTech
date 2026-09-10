'use client';

import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, Plus, Search, Users as UsersIcon } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import {
  CreateInstituteUserRequestSchema,
  type CreateInstituteUserRequest,
  type InstituteUser,
} from '@catlium/contracts';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { StatusBadge } from '@/components/app/status-badge';
import { SkeletonRows } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

const ROLE_LABELS: Record<string, string> = {
  INSTITUTE_ADMIN: 'Institute admin',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
};

export default function UsersPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [members, setMembers] = useState<InstituteUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<InstituteUser | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true);
  }, [searchParams]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const data = await api<{ users: InstituteUser[] }>('/users', { signal });
      setMembers(data.users ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const form = useForm<CreateInstituteUserRequest>({
    resolver: zodResolver(CreateInstituteUserRequestSchema),
    defaultValues: { email: '', name: '', password: '', role: 'TEACHER' },
  });

  async function handleCreate(values: CreateInstituteUserRequest) {
    setCreating(true);
    try {
      await api<{ user: InstituteUser }>('/users', { method: 'POST', body: values });
      toast.success('Account created');
      setCreateOpen(false);
      form.reset();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create account');
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(member: InstituteUser, status: 'active' | 'deactivated') {
    setUpdating(true);
    try {
      await api<{ user: InstituteUser }>(`/users/${member.id}/status`, {
        method: 'PATCH',
        body: { status },
      });
      toast.success(`Account ${status === 'active' ? 'activated' : 'deactivated'}`);
      setTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update account');
    } finally {
      setUpdating(false);
    }
  }

  const filtered = query.trim()
    ? members.filter(
        (m) =>
          m.name.toLowerCase().includes(query.toLowerCase()) ||
          m.email.toLowerCase().includes(query.toLowerCase()),
      )
    : members;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage the teacher and student accounts for this institute. Administrators provision accounts — there is no public self-registration."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Add user
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorState onRetry={() => void load()} />
      ) : members.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="size-5" />}
          title="No users yet"
          description="Create the first teacher or student account for your institute."
        >
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Add user
          </Button>
        </EmptyState>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Member since</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((member) => {
                const self = member.id === user?.id;
                return (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.name}
                      {self && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {member.roles.length === 0 ? (
                          <Badge variant="secondary">No roles</Badge>
                        ) : (
                          member.roles.map((role) => (
                            <Badge key={role} variant="secondary" className="font-medium">
                              {ROLE_LABELS[role] ?? role}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={member.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(member.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!self && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updating}
                          onClick={() => setTarget(member)}
                        >
                          {member.status === 'active' ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No users match &quot;{query}&quot;
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => setCreateOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Provision a teacher or student account for this institute.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="Ada Lovelace" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="ada@institute.edu" {...form.register('email')} />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Initial password</Label>
              <Input
                type="password"
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={form.watch('role')}
                onValueChange={(role) => form.setValue('role', role as 'TEACHER' | 'STUDENT')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEACHER">Teacher</SelectItem>
                  <SelectItem value="STUDENT">Student</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target?.status === 'active' ? 'Deactivate account' : 'Activate account'}
        description={
          target
            ? target.status === 'active'
              ? `${target.name} will no longer be able to access this institute until reactivated.`
              : `${target.name} will regain access to this institute.`
            : undefined
        }
        confirmLabel={target?.status === 'active' ? 'Deactivate' : 'Activate'}
        destructive={target?.status === 'active'}
        loading={updating}
        onConfirm={() => {
          if (target)
            void handleStatusChange(target, target.status === 'active' ? 'deactivated' : 'active');
        }}
      />
    </div>
  );
}
