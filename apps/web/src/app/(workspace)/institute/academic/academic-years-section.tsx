'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CalendarDays, Loader2, Pencil, Plus } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { bySortOrder, type AcademicYear } from '@/lib/academic';
import { EmptyState } from '@/components/app/empty-state';
import { StatusBadge } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
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
import {
  namedStructureSchema,
  intOrUndefined,
  type NamedStructureValues,
  type NamedStructureInput,
} from './schemas';

const DEFAULT_VALUES: NamedStructureValues = { name: '', sortOrder: '', status: 'active' };

export function AcademicYearsSection({
  years,
  admin,
  onChange,
}: {
  years: AcademicYear[];
  admin: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<AcademicYear | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<NamedStructureValues>({
    resolver: zodResolver(namedStructureSchema),
    defaultValues: DEFAULT_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      target
        ? { name: target.name, sortOrder: String(target.sortOrder), status: target.status }
        : DEFAULT_VALUES,
    );
  }, [open, target, form]);

  async function onSubmit(values: NamedStructureValues) {
    setBusy(true);
    const body: NamedStructureInput = {
      name: values.name,
      sortOrder: intOrUndefined(values.sortOrder),
      status: values.status,
    };
    try {
      if (target) {
        await api<{ academicYear: AcademicYear }>(`/academic/academic-years/${target.id}`, {
          method: 'PATCH',
          body,
        });
        toast.success('Academic year updated');
      } else {
        await api<{ academicYear: AcademicYear }>('/academic/academic-years', {
          method: 'POST',
          body,
        });
        toast.success('Academic year created');
      }
      setOpen(false);
      setTarget(null);
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save academic year');
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...years].sort(bySortOrder);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Academic Years"
        description="Define the institute's academic calendar years. Years are never deleted — a future year may be added and an obsolete one archived."
        actions={
          admin && (
            <Button onClick={() => { setTarget(null); setOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Add year
            </Button>
          )
        }
      />

      {years.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-5" />}
          title="No academic years"
          description="Add the first academic year (for example “2026-27”) to start building the academic structure."
        >
          {admin && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Add year
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Sort order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((year) => (
                <TableRow key={year.id}>
                  <TableCell className="font-medium">{year.name}</TableCell>
                  <TableCell className="text-muted-foreground">{year.sortOrder}</TableCell>
                  <TableCell>
                    <StatusBadge status={year.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(year.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    {admin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTarget(year);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="mr-1.5 size-3.5" /> Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{target ? `Edit “${target.name}”` : 'Add academic year'}</DialogTitle>
            <DialogDescription>
              {target
                ? 'Update the year name, ordering, or archive it.'
                : 'Create a new academic year for this institute.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="2026-27" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Sort order</Label>
                <Input type="number" placeholder="0" {...form.register('sortOrder')} />
                {form.formState.errors.sortOrder && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.sortOrder.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={form.watch('status')}
                  onValueChange={(status) => form.setValue('status', status as 'active' | 'archived')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                {target ? 'Save changes' : 'Create year'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}