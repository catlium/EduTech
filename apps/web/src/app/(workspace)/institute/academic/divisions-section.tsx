'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CalendarDays, Filter, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  divisionDeleteWarning,
  filterDivisions,
  bySortOrder,
  type AcademicYear,
  type ClassRow,
  type DivisionRow,
} from '@/lib/academic';
import { EmptyState } from '@/components/app/empty-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
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
  divisionCreateSchema,
  divisionEditSchema,
  intOrUndefined,
  type DivisionCreateValues,
  type DivisionEditValues,
} from './schemas';

export function DivisionsSection({
  divisions,
  years,
  classes,
  admin,
  onChange,
}: {
  divisions: DivisionRow[];
  years: AcademicYear[];
  classes: ClassRow[];
  admin: boolean;
  onChange: () => void;
}) {
  const [yearFilter, setYearFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DivisionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DivisionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const yearName = useMemo(() => new Map(years.map((y) => [y.id, y.name])), [years]);
  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  function yearClassNames(division: DivisionRow) {
    return {
      year: yearName.get(division.academicYearId) ?? 'Unknown year',
      cls: className.get(division.classId) ?? 'Unknown class',
    };
  }

  const createForm = useForm<DivisionCreateValues>({
    resolver: zodResolver(divisionCreateSchema),
    defaultValues: { name: '', sortOrder: '', academicYearId: '', classId: '' },
  });

  const editForm = useForm<DivisionEditValues>({
    resolver: zodResolver(divisionEditSchema),
    defaultValues: { name: '', sortOrder: '' },
  });

  useEffect(() => {
    if (!createOpen) return;
    createForm.reset({
      name: '',
      sortOrder: '',
      academicYearId: years.find((y) => y.status === 'active')?.id ?? years[0]?.id ?? '',
      classId: classes.find((c) => c.status === 'active')?.id ?? classes[0]?.id ?? '',
    });
  }, [createOpen, createForm, years, classes]);

  useEffect(() => {
    if (!editTarget) return;
    editForm.reset({ name: editTarget.name, sortOrder: String(editTarget.sortOrder) });
  }, [editTarget, editForm]);

  async function createDivision(values: DivisionCreateValues) {
    setBusy(true);
    try {
      await api<{ division: DivisionRow }>('/academic/divisions', {
        method: 'POST',
        body: {
          name: values.name,
          sortOrder: intOrUndefined(values.sortOrder),
          academicYearId: values.academicYearId,
          classId: values.classId,
        },
      });
      toast.success('Division created');
      setCreateOpen(false);
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create division');
    } finally {
      setBusy(false);
    }
  }

  async function updateDivision(values: DivisionEditValues) {
    if (!editTarget) return;
    setBusy(true);
    try {
      await api<{ division: DivisionRow }>(`/academic/divisions/${editTarget.id}`, {
        method: 'PATCH',
        body: { name: values.name, sortOrder: intOrUndefined(values.sortOrder) },
      });
      toast.success('Division updated');
      setEditTarget(null);
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update division');
    } finally {
      setBusy(false);
    }
  }

  async function deleteDivision() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api(`/academic/divisions/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('Division deleted');
      setDeleteTarget(null);
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete division');
    } finally {
      setBusy(false);
    }
  }

  const filtered = filterDivisions(
    divisions,
    yearFilter || null,
    classFilter || null,
  ).sort((a, b) => {
    const y = (yearName.get(a.academicYearId) ?? '').localeCompare(
      yearName.get(b.academicYearId) ?? '',
    );
    if (y !== 0) return y;
    const c = (className.get(a.classId) ?? '').localeCompare(className.get(b.classId) ?? '');
    if (c !== 0) return c;
    return bySortOrder(a, b);
  });

  const hasFilters = yearFilter !== '' || classFilter !== '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Divisions"
        description="Year-bound student groups inside a class (for example Class X — 2026-27 — Section A). Deleting a division permanently removes its placements and enrollments."
        actions={
          admin && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Add division
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-56 items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All years</SelectItem>
              {years.map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {year.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All classes</SelectItem>
              {classes.map((klass) => (
                <SelectItem key={klass.id} value={klass.id}>
                  {klass.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {divisions.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-5" />}
          title="No divisions"
          description="Add academic years and classes first, then create this class's first division (for example “A”)."
        >
          {admin && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Add division
            </Button>
          )}
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-5" />}
          title="No matching divisions"
          description={hasFilters ? 'No divisions match the selected year and class filters.' : 'No divisions exist yet.'}
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Academic year</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Sort order</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((division) => {
                const warning = divisionDeleteWarning(
                  division,
                  yearName.get(division.academicYearId) ?? 'Unknown year',
                  className.get(division.classId) ?? 'Unknown class',
                );
                return (
                  <TableRow key={division.id}>
                    <TableCell className="font-medium">{division.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <CalendarDays className="size-3.5" />
                        {yearName.get(division.academicYearId) ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {className.get(division.classId) ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{division.sortOrder}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(division.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      {admin && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditTarget(division)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteTarget(division)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => setCreateOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add division</DialogTitle>
            <DialogDescription>
              Create a student group within an academic year and class. The backend validates
              both belong to this institute.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createForm.handleSubmit(createDivision)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Academic year</Label>
              <Select
                value={createForm.watch('academicYearId')}
                onValueChange={(v) => createForm.setValue('academicYearId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {createForm.formState.errors.academicYearId && (
                <p className="text-xs text-destructive">
                  {createForm.formState.errors.academicYearId.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select
                value={createForm.watch('classId')}
                onValueChange={(v) => createForm.setValue('classId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((klass) => (
                    <SelectItem key={klass.id} value={klass.id}>
                      {klass.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {createForm.formState.errors.classId && (
                <p className="text-xs text-destructive">
                  {createForm.formState.errors.classId.message}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input placeholder="A" {...createForm.register('name')} />
                {createForm.formState.errors.name && (
                  <p className="text-xs text-destructive">
                    {createForm.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Sort order</Label>
                <Input type="number" placeholder="0" {...createForm.register('sortOrder')} />
                {createForm.formState.errors.sortOrder && (
                  <p className="text-xs text-destructive">
                    {createForm.formState.errors.sortOrder.message}
                  </p>
                )}
              </div>
            </div>
            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || years.length === 0 || classes.length === 0}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create division
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit division “${editTarget.name}”` : 'Edit division'}</DialogTitle>
            <DialogDescription>
              Update the division name or ordering. Its year and class are fixed by the backend.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(updateDivision)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input placeholder="A" {...editForm.register('name')} />
                {editForm.formState.errors.name && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Sort order</Label>
                <Input type="number" placeholder="0" {...editForm.register('sortOrder')} />
                {editForm.formState.errors.sortOrder && (
                  <p className="text-xs text-destructive">
                    {editForm.formState.errors.sortOrder.message}
                  </p>
                )}
              </div>
            </div>
            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditTarget(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {deleteTarget && (
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={divisionDeleteWarning(deleteTarget, yearClassNames(deleteTarget).year, yearClassNames(deleteTarget).cls).title}
          description={divisionDeleteWarning(
            deleteTarget,
            yearClassNames(deleteTarget).year,
            yearClassNames(deleteTarget).cls,
          ).description}
          confirmLabel="Delete division"
          destructive
          loading={busy}
          onConfirm={() => void deleteDivision()}
        />
      )}
    </div>
  );
}