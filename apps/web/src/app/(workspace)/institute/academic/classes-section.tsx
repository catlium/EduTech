'use client';

import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { BookOpen, GraduationCap, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { classDeleteWarning, type ClassRow, type DivisionRow } from '@/lib/academic';
import type { SubjectResponse } from '@catlium/contracts';
import { EmptyState } from '@/components/app/empty-state';
import { PageHeader } from '@/components/app/page-header';
import { StatusBadge } from '@/components/app/status-badge';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
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

interface DeleteRequest {
  klass: ClassRow;
  subjectCount: number;
  divisionCount: number;
}

export function ClassesSection({
  classes,
  divisions,
  subjects,
  offeredByClass,
  admin,
  onChange,
}: {
  classes: ClassRow[];
  divisions: DivisionRow[];
  subjects: SubjectResponse[];
  offeredByClass: Record<string, SubjectResponse[]>;
  admin: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ClassRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [manageClass, setManageClass] = useState<ClassRow | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        await api<{ class: ClassRow }>(`/academic/classes/${target.id}`, {
          method: 'PATCH',
          body,
        });
        toast.success('Class updated');
      } else {
        await api<{ class: ClassRow }>('/academic/classes', { method: 'POST', body });
        toast.success('Class created');
      }
      setOpen(false);
      setTarget(null);
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save class');
    } finally {
      setBusy(false);
    }
  }

  // The class DELETE is a hard delete that cascades offerings, divisions, and
  // through divisions every placement/enrollment/assignment (schema FKs are
  // ON DELETE CASCADE). Use the live offering count so the confirm states the
  // exact impact instead of a generic warning.
  function startDelete(klass: ClassRow) {
    const divisionCount = divisions.filter((d) => d.classId === klass.id).length;
    const subjectCount = (offeredByClass[klass.id] ?? []).length;
    setDeleteRequest({ klass, subjectCount, divisionCount });
  }

  async function confirmDelete() {
    if (!deleteRequest) return;
    setDeleting(true);
    try {
      await api(`/academic/classes/${deleteRequest.klass.id}`, { method: 'DELETE' });
      toast.success('Class deleted');
      setDeleteRequest(null);
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete class');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Classes"
        description="Stable curriculum levels shared across years. Offerings and divisions hang off a class, and deleting one cascades them away."
        actions={
          admin && (
            <Button onClick={() => { setTarget(null); setOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Add class
            </Button>
          )
        }
      />

      {classes.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title="No classes"
          description="Add the institute's first class (for example “Class X”) to begin defining curriculum levels."
        >
          {admin && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Add class
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Offered subjects</TableHead>
                <TableHead>Divisions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((klass) => {
                const divisionCount = divisions.filter((d) => d.classId === klass.id).length;
                const offeringCount = (offeredByClass[klass.id] ?? []).length;
                return (
                  <TableRow key={klass.id}>
                    <TableCell className="font-medium">{klass.name}</TableCell>
                    <TableCell className="text-muted-foreground">{offeringCount}</TableCell>
                    <TableCell className="text-muted-foreground">{divisionCount}</TableCell>
                    <TableCell>
                      <StatusBadge status={klass.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(klass.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      {admin && (
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setManageClass(klass)}>
                            <BookOpen className="mr-1.5 size-3.5" /> Subjects
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setTarget(klass); setOpen(true); }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => startDelete(klass)}>
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

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{target ? `Edit “${target.name}”` : 'Add class'}</DialogTitle>
            <DialogDescription>
              {target
                ? 'Update the class name, ordering, or archive it.'
                : 'Create a new stable curriculum level for this institute.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="Class X" {...form.register('name')} />
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
                {target ? 'Save changes' : 'Create class'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {manageClass && (
        <ManageSubjectsDialog
          klass={manageClass}
          allSubjects={subjects}
          open={manageClass !== null}
          onOpenChange={(o) => !o && setManageClass(null)}
          onChanged={() => onChange()}
        />
      )}

      {deleteRequest && (
        <ConfirmDialog
          open={deleteRequest !== null}
          onOpenChange={(o) => !o && setDeleteRequest(null)}
          title={classDeleteWarning(deleteRequest.klass, deleteRequest.subjectCount, deleteRequest.divisionCount).title}
          description={classDeleteWarning(
            deleteRequest.klass,
            deleteRequest.subjectCount,
            deleteRequest.divisionCount,
          ).description}
          confirmLabel="Delete class"
          destructive
          loading={deleting}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

function ManageSubjectsDialog({
  klass,
  allSubjects,
  open,
  onOpenChange,
  onChanged,
}: {
  klass: ClassRow;
  allSubjects: SubjectResponse[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [offered, setOffered] = useState<SubjectResponse[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const { subjects } = await api<{ subjects: SubjectResponse[] }>(
        `/academic/classes/${klass.id}/subjects`,
        { signal },
      );
      setOffered(subjects ?? []);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        toast.error(err instanceof ApiError ? err.message : 'Failed to load class subjects');
      }
    } finally {
      setLoading(false);
    }
  }, [klass.id]);

  useEffect(() => {
    if (!open) return;
    setSelected('');
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [open, load]);

  const available = allSubjects.filter(
    (s) => !offered.some((o) => o.id === s.id) && s.status !== 'archived',
  );

  async function addSubject() {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/academic/classes/${klass.id}/subjects/${selected}`, { method: 'POST' });
      const subject = allSubjects.find((s) => s.id === selected);
      if (subject) setOffered((prev) => [...prev, subject].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected('');
      toast.success('Subject offered');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to offer subject');
    } finally {
      setBusy(false);
    }
  }

  async function removeSubject(subject: SubjectResponse) {
    setBusy(true);
    try {
      await api(`/academic/classes/${klass.id}/subjects/${subject.id}`, { method: 'DELETE' });
      setOffered((prev) => prev.filter((s) => s.id !== subject.id));
      toast.success('Subject removed');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove subject');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subjects offered in {klass.name}</DialogTitle>
          <DialogDescription>
            Manage which institute subjects this class offers. Removing an offering does not
            delete the subject.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>Add a subject</Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger>
                  <SelectValue placeholder={available.length ? 'Select a subject' : 'All subjects offered'} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void addSubject()} disabled={!selected || busy}>
              <Plus className="mr-1.5 size-4" /> Add
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : offered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No subjects offered yet. Add one from the select above.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {offered.map((subject) => (
                <Badge key={subject.id} variant="secondary" className="gap-1.5 py-1 pr-1 pl-2.5 font-medium">
                  {subject.name}
                  <button
                    type="button"
                    aria-label={`Remove ${subject.name}`}
                    disabled={busy}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    onClick={() => void removeSubject(subject)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}