'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, BookOpenCheck, Loader2, MinusCircle } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import {
  canCreateEnrollmentOverride,
  enrollmentState,
  offeredSubjectIdsForDivision,
  type DivisionRow,
  type EnrollmentKind,
  type EnrollmentState,
  type Offering,
  type StudentPlacement,
  type StudentSubjectEnrollment,
} from '@/lib/academic';
import type { SubjectResponse } from '@catlium/contracts';
import { EmptyState } from '@/components/app/empty-state';
import { ErrorState } from '@/components/app/error-state';
import { SkeletonRows } from '@/components/app/loading';
import { Badge } from '@/components/ui/badge';
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

// E.2 — student subject-enrollment overrides dialog. One placement (student +
// year) per dialog: the class's offered subjects list with their current
// per-student override state, plus an "enroll elective" picker for subjects the
// class does NOT offer. Reads render for `assignments.read`; mutations are gated
// by `assignments.create` (mark ENROLLED/EXCLUDED) / `assignments.delete`
// (revert an override) exactly as the backend declares them. The backend stays
// the authority — "EXCLUDED only for offered subjects, ENROLLED only for
// non-offered" checks here are convenience, not an enforcement boundary.

function StateBadge({ state }: { state: EnrollmentState }) {
  if (state === 'ENROLLED') {
    return (
      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        Enrolled
      </Badge>
    );
  }
  if (state === 'EXCLUDED') {
    return (
      <Badge variant="secondary" className="bg-red-500/10 text-red-700 dark:text-red-400">
        Excluded
      </Badge>
    );
  }
  return <Badge variant="secondary">Class default</Badge>;
}

export function EnrollmentOverridesDialog({
  placement,
  subjects,
  divisions,
  offeredByClass,
  canCreate,
  canDelete,
  open,
  onOpenChange,
  onChanged,
}: {
  placement: StudentPlacement;
  subjects: SubjectResponse[];
  divisions: DivisionRow[];
  offeredByClass: Record<string, Offering[]>;
  canCreate: boolean;
  canDelete: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [enrollments, setEnrollments] = useState<StudentSubjectEnrollment[]>([]);
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'ready'>('loading');
  const [busy, setBusy] = useState(false);
  const [electiveId, setElectiveId] = useState('');

  const offered = useMemo(
    () => offeredSubjectIdsForDivision(placement.divisionId, divisions, offeredByClass),
    [placement.divisionId, divisions, offeredByClass],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState('loading');
      try {
        const { enrollments } = await api<{ enrollments: StudentSubjectEnrollment[] }>(
          `/academic/student-enrollments?placementId=${placement.id}`,
          { signal },
        );
        setEnrollments(enrollments ?? []);
        setState('ready');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error');
      }
    },
    [placement.id],
  );

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [open, load]);

  async function setOverride(subjectId: string, kind: EnrollmentKind) {
    if (!canCreateEnrollmentOverride(kind, offered, subjectId)) return;
    setBusy(true);
    try {
      await api('/academic/student-enrollments', {
        method: 'POST',
        body: { placementId: placement.id, subjectId, kind },
      });
      toast.success(kind === 'ENROLLED' ? 'Elective enrolled' : 'Subject excluded');
      setElectiveId('');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update enrollment');
    } finally {
      setBusy(false);
    }
  }

  async function revertOverride(subjectId: string) {
    const enrollment = enrollments.find((e) => e.subjectId === subjectId);
    if (!enrollment) return;
    setBusy(true);
    try {
      await api(`/academic/student-enrollments/${enrollment.id}`, { method: 'DELETE' });
      toast.success('Override removed — class default restored');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove override');
    } finally {
      setBusy(false);
    }
  }

  const electiveCandidates = subjects
    .filter((s) => !offered.has(s.id))
    .filter((s) => enrollmentState(enrollments, placement.id, s.id) === 'DEFAULT')
    .filter((s) => s.status === 'active');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subject overrides — {placement.studentName}</DialogTitle>
          <DialogDescription>
            {placement.className} · {placement.divisionName} · {placement.academicYearName}.
            Overrides adjust this student&apos;s subject set from the class default.
          </DialogDescription>
        </DialogHeader>

        {state === 'loading' ? (
          <SkeletonRows rows={4} />
        ) : state === 'forbidden' ? (
          <EmptyState
            icon={<BookOpenCheck className="size-5" />}
            title="Enrollments unavailable"
            description="You don't have permission to view enrollment overrides for this institute."
          />
        ) : state === 'error' ? (
          <ErrorState onRetry={() => void load()} />
        ) : subjects.length === 0 ? (
          <EmptyState
            icon={<BookOpenCheck className="size-5" />}
            title="No subjects"
            description="No subjects have been defined for this institute yet."
          />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>State</TableHead>
                    {(canCreate || canDelete) && <TableHead className="text-right">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.map((subject) => {
                    const e = enrollmentState(enrollments, placement.id, subject.id);
                    const isOffered = offered.has(subject.id);
                    const explainsDefault =
                      isOffered ? 'Offered by the class — included unless excluded.' : 'Not offered by the class — excluded unless enrolled as an elective.';
                    if (e === 'DEFAULT' && !isOffered) return null;
                    return (
                      <TableRow key={subject.id}>
                        <TableCell className="font-medium">{subject.name}</TableCell>
                        <TableCell>
                          <StateBadge state={e} />
                          {e === 'DEFAULT' && (
                            <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                              {explainsDefault}
                            </span>
                          )}
                        </TableCell>
                        {(canCreate || canDelete) && (
                          <TableCell className="text-right">
                            {e !== 'DEFAULT' && canDelete && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => void revertOverride(subject.id)}
                                title="Remove the override and revert to the class default"
                              >
                                <MinusCircle className="size-3.5" /> Revert
                              </Button>
                            )}
                            {e === 'DEFAULT' && canCreate && isOffered && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => void setOverride(subject.id, 'EXCLUDED')}
                                title="Exclude this offered subject for this student"
                              >
                                Exclude
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {canCreate && electiveCandidates.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="w-full space-y-1.5 sm:max-w-xs">
                  <Label>Enroll elective</Label>
                  <Select value={electiveId} onValueChange={setElectiveId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a subject not offered by the class" />
                    </SelectTrigger>
                    <SelectContent>
                      {electiveCandidates.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!electiveId || busy}
                  onClick={() => void setOverride(electiveId, 'ENROLLED')}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
                  Add elective
                </Button>
              </div>
            )}
          </div>
        )}

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