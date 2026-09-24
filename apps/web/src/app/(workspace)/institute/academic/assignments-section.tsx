'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, UserRoundCheck } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  assignableTeachers,
  byClassSubjectName,
  type ClassRow,
  type Offering,
  type TeacherAssignment,
} from '@/lib/academic';
import type { InstituteUser } from '@catlium/contracts';
import { EmptyState } from '@/components/app/empty-state';
import { PageHeader } from '@/components/app/page-header';
import { StatusBadge } from '@/components/app/status-badge';
import { SkeletonRows } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
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

// Phase Q.3.0 — teacher-assignment console. Which TEACHER membership teaches
// which class-subject offering. Reads render for `assignments.read`; the assign
// and unassign controls are gated by `assignments.create`/`assignments.delete`
// (the backend enforces all of it). Roster comes from GET /users, which is
// INSTITUTE_ADMIN-role-gated — a custom delegate without that role sees the
// table but cannot enumerate teachers (roster degradation handled inline).

interface AssignDraft {
  teacherId: string;
  classId: string;
  offeringId: string;
}

export function TeacherAssignmentsSection({
  classes,
  offeredByClass,
  canCreate,
  canDelete,
  onChange,
}: {
  classes: ClassRow[];
  offeredByClass: Record<string, Offering[]>;
  canCreate: boolean;
  canDelete: boolean;
  onChange: () => void;
}) {
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [teachers, setTeachers] = useState<InstituteUser[]>([]);
  const [rosterUnavailable, setRosterUnavailable] = useState(false);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  const [assignOpen, setAssignOpen] = useState(false);
  const [draft, setDraft] = useState<AssignDraft>({ teacherId: '', classId: '', offeringId: '' });
  const [busy, setBusy] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<TeacherAssignment | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState('loading');
    const aborted = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

    let rows: TeacherAssignment[] = [];
    let roster: InstituteUser[] = [];
    let listFailed = false;
    let rosterFailed = false;

    try {
      ({ assignments: rows } = await api<{ assignments: TeacherAssignment[] }>(
        '/academic/teacher-assignments',
        { signal },
      ));
    } catch (err) {
      if (aborted(err)) return;
      listFailed = true;
    }

    try {
      ({ users: roster } = await api<{ users: InstituteUser[] }>('/users', { signal }));
    } catch (err) {
      if (aborted(err)) return;
      rosterFailed = true;
    }

    setAssignments(rows);
    setTeachers(roster);
    setRosterUnavailable(rosterFailed);
    setState(listFailed ? 'error' : 'ready');
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const activeRows = assignments.filter((a) => a.status === 'active').sort(byClassSubjectName);

  async function assignTeacher() {
    if (!draft.teacherId || !draft.offeringId) return;
    setBusy(true);
    try {
      await api('/academic/teacher-assignments', {
        method: 'POST',
        body: { membershipId: draft.teacherId, classSubjectId: draft.offeringId },
      });
      toast.success('Teacher assigned');
      setAssignOpen(false);
      setDraft({ teacherId: '', classId: '', offeringId: '' });
      await load();
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to assign teacher');
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    if (!unassignTarget) return;
    setBusy(true);
    try {
      await api(`/academic/teacher-assignments/${unassignTarget.id}`, { method: 'DELETE' });
      toast.success('Assignment removed');
      setUnassignTarget(null);
      await load();
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove assignment');
    } finally {
      setBusy(false);
    }
  }

  const offeringsFor = (classId: string) => offeredByClass[classId] ?? [];
  const rosterFor = (offeringId: string) =>
    assignableTeachers(teachers, assignments, offeringId).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teacher assignments"
        description="Assign TEACHER members to teach a class-subject offering. Reassigning is remove-then-assign; there is no edit — the backend enforces one active teacher assignment per offering."
        actions={
          canCreate && (
            <Button onClick={() => { setDraft({ teacherId: '', classId: '', offeringId: '' }); setAssignOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Assign teacher
            </Button>
          )
        }
      />

      {state === 'loading' ? (
        <SkeletonRows rows={5} />
      ) : state === 'error' ? (
        <ErrorState onRetry={() => void load()} />
      ) : activeRows.length === 0 ? (
        <EmptyState
          icon={<UserRoundCheck className="size-5" />}
          title="No teacher assignments"
          description="Assign a teacher to a class subject to begin staffing. Teachers appear here only once assigned."
        >
          {canCreate && (
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Assign teacher
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned</TableHead>
                {canDelete && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeRows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.className}</TableCell>
                  <TableCell>{a.subjectName}</TableCell>
                  <TableCell>{a.teacherName}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                  {canDelete && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setUnassignTarget(a)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={assignOpen} onOpenChange={(o) => setAssignOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign a teacher</DialogTitle>
            <DialogDescription>
              Pick the class, the subject offering, and the TEACHER member to teach it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select
                value={draft.classId}
                onValueChange={(classId) =>
                  setDraft((d) => ({ ...d, classId, offeringId: '', teacherId: '' }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Subject offering</Label>
              <Select
                value={draft.offeringId}
                onValueChange={(offeringId) =>
                  setDraft((d) => ({ ...d, offeringId, teacherId: '' }))
                }
                disabled={!draft.classId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={draft.classId ? 'Select a subject' : 'Pick a class first'} />
                </SelectTrigger>
                <SelectContent>
                  {offeringsFor(draft.classId).map((o) => (
                    <SelectItem key={o.classSubjectId} value={o.classSubjectId}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Teacher</Label>
              <Select
                value={draft.teacherId}
                onValueChange={(teacherId) => setDraft((d) => ({ ...d, teacherId }))}
                disabled={!draft.offeringId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !draft.offeringId
                        ? 'Pick a subject first'
                        : rosterFor(draft.offeringId) === 0
                          ? 'No unassigned teachers'
                          : 'Select a teacher'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {assignableTeachers(teachers, assignments, draft.offeringId).map((t) => (
                    <SelectItem key={t.membershipId} value={t.membershipId}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rosterUnavailable && (
                <p className="text-xs text-muted-foreground">
                  Teacher roster is unavailable to your role — listable by institute
                  admins only. Assign from a roster-holding account.
                </p>
              )}
            </div>
          </div>

          <Separator />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void assignTeacher()} disabled={!draft.teacherId || busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Assign teacher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {unassignTarget && (
        <ConfirmDialog
          open={unassignTarget !== null}
          onOpenChange={(o) => !o && setUnassignTarget(null)}
          title={`Remove ${unassignTarget.teacherName} from ${unassignTarget.className} · ${unassignTarget.subjectName}?`}
          description="The teacher stops teaching this subject offering immediately. Reassign later by assigning them again."
          confirmLabel="Remove assignment"
          destructive
          loading={busy}
          onConfirm={() => void unassign()}
        />
      )}
    </div>
  );
}