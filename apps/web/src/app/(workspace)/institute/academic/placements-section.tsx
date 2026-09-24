'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Archive,
  ArrowLeftRight,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  History,
  Loader2,
  UserPlus,
} from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  filterDivisions,
  filterPlacements,
  placeableStudents,
  placementHistory,
  bySortOrder,
  type AcademicYear,
  type ClassRow,
  type DivisionRow,
  type Offering,
  type StudentPlacement,
} from '@/lib/academic';
import type { InstituteUser, SubjectResponse } from '@catlium/contracts';
import { EmptyState } from '@/components/app/empty-state';
import { PageHeader } from '@/components/app/page-header';
import { SkeletonRows } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { StatusBadge } from '@/components/app/status-badge';
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

import { CarryForwardWizard } from './carry-forward-wizard';
import { EnrollmentOverridesDialog } from './enrollments-dialog';

// Phase Q.4.4 — student placement console (design §9). Which STUDENT membership
// is placed into which division of an academic year. The roster + history render
// for `assignments.read`; place/deactivate/transfer and the carry-forward
// promote controls are gated by `assignments.create`/`.delete` exactly as the
// backend declares them (transfer and carry-forward commit need create AND
// delete). The roster picker (GET /users) is INSTITUTE_ADMIN-role-gated, so a
// custom delegate without that role sees the table but cannot enumerate
// students (degraded inline, same as the teacher-assignment tab).

interface PlaceDraft {
  academicYearId: string;
  classId: string;
  divisionId: string;
  membershipId: string;
}

interface TransferDraft {
  academicYearId: string;
  classId: string;
  divisionId: string;
}

export function StudentPlacementsSection({
  classes,
  divisions,
  years,
  subjects,
  offeredByClass,
  canCreate,
  canDelete,
  canTransfer,
  onChange,
}: {
  classes: ClassRow[];
  divisions: DivisionRow[];
  years: AcademicYear[];
  subjects: SubjectResponse[];
  offeredByClass: Record<string, Offering[]>;
  canCreate: boolean;
  canDelete: boolean;
  canTransfer: boolean;
  onChange: () => void;
}) {
  const [placements, setPlacements] = useState<StudentPlacement[]>([]);
  const [roster, setRoster] = useState<InstituteUser[]>([]);
  const [rosterUnavailable, setRosterUnavailable] = useState(false);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  const [yearFilter, setYearFilter] = useState(() =>
    years.length > 0 ? [...years].sort(bySortOrder).at(-1)!.id : '',
  );
  const [classFilter, setClassFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeDraft, setPlaceDraft] = useState<PlaceDraft>({
    academicYearId: '',
    classId: '',
    divisionId: '',
    membershipId: '',
  });
  const [transferTarget, setTransferTarget] = useState<StudentPlacement | null>(null);
  const [transferDraft, setTransferDraft] = useState<TransferDraft>({
    academicYearId: '',
    classId: '',
    divisionId: '',
  });
  const [deactivateTarget, setDeactivateTarget] = useState<StudentPlacement | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<StudentPlacement | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const yearName = useMemo(() => new Map(years.map((y) => [y.id, y.name])), [years]);
  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState('loading');
    const aborted = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

    let rows: StudentPlacement[] = [];
    let listFailed = false;
    let roster: InstituteUser[] = [];
    let rosterFailed = false;

    try {
      ({ placements: rows } = await api<{ placements: StudentPlacement[] }>(
        '/academic/student-placements',
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

    setPlacements(rows);
    setRoster(roster);
    setRosterUnavailable(rosterFailed);
    setState(listFailed ? 'error' : 'ready');
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const sorted = useMemo(() => {
    return filterPlacements(placements, divisions, yearFilter || null, classFilter || null).sort(
      (a, b) => {
        const byName = a.studentName.localeCompare(b.studentName);
        if (byName !== 0) return byName;
        return b.academicYearName.localeCompare(a.academicYearName);
      },
    );
  }, [placements, divisions, yearFilter, classFilter]);

  const toggleExpand = (placementId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(placementId)) next.delete(placementId);
      else next.add(placementId);
      return next;
    });

  function defaultYear() {
    return years[0]?.id ?? '';
  }
  function defaultClass() {
    return classes[0]?.id ?? '';
  }

  function resetPlaceDraft() {
    setPlaceDraft({
      academicYearId: defaultYear(),
      classId: defaultClass(),
      divisionId: '',
      membershipId: '',
    });
  }

  function resetTransferDraft() {
    setTransferDraft({ academicYearId: defaultYear(), classId: defaultClass(), divisionId: '' });
  }

  async function placeStudent() {
    if (!placeDraft.divisionId || !placeDraft.membershipId) return;
    setBusy(true);
    try {
      await api('/academic/student-placements', {
        method: 'POST',
        body: { membershipId: placeDraft.membershipId, divisionId: placeDraft.divisionId },
      });
      toast.success('Student placed');
      setPlaceOpen(false);
      await load();
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to place student');
    } finally {
      setBusy(false);
    }
  }

  async function transferPlacement() {
    if (!transferTarget || !transferDraft.divisionId) return;
    setBusy(true);
    try {
      await api(
        `/academic/student-placements/${transferTarget.id}/transfer`,
        { method: 'POST', body: { divisionId: transferDraft.divisionId } },
      );
      toast.success('Placement transferred');
      setTransferTarget(null);
      await load();
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to transfer placement');
    } finally {
      setBusy(false);
    }
  }

  async function deactivatePlacement() {
    if (!deactivateTarget) return;
    setBusy(true);
    try {
      await api(`/academic/student-placements/${deactivateTarget.id}`, { method: 'DELETE' });
      toast.success('Placement deactivated');
      setDeactivateTarget(null);
      await load();
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to deactivate placement');
    } finally {
      setBusy(false);
    }
  }

  const placeDivisions = filterDivisions(
    divisions,
    placeDraft.academicYearId || null,
    placeDraft.classId || null,
  );
  const transferDivisions = filterDivisions(
    divisions,
    transferDraft.academicYearId || null,
    transferDraft.classId || null,
  );
  const placeable = placeableStudents(roster, placements, placeDraft.divisionId || null, divisions);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Student placements"
        description="Place students into a division per academic year, move them between sections or years, or run an academic-year carry-forward. History is retained — deactivating or transferring never deletes a placement."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setWizardOpen(true)}>
              <ArrowLeftRight className="mr-1.5 size-4" /> Carry forward
            </Button>
            {canCreate && (
              <Button
                onClick={() => {
                  resetPlaceDraft();
                  setPlaceOpen(true);
                }}
              >
                <UserPlus className="mr-1.5 size-4" /> Place student
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-52">
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All years</SelectItem>
              {[...years].sort(bySortOrder).map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {year.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-52">
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

      {state === 'loading' ? (
        <SkeletonRows rows={5} />
      ) : state === 'error' ? (
        <ErrorState onRetry={() => void load()} />
      ) : placements.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title="No student placements"
          description="Place students into a division to begin. Students appear here once placed and their placement history is retained."
        >
          {canCreate && (
            <Button
              size="sm"
              onClick={() => {
                resetPlaceDraft();
                setPlaceOpen(true);
              }}
            >
              <UserPlus className="mr-1.5 size-4" /> Place student
            </Button>
          )}
        </EmptyState>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title="No matching placements"
          description="No placements match the selected year and class filters."
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Division</TableHead>
                <TableHead>Academic year</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Placed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((placement) => {
                const history = placementHistory(placements, placement.membershipId, placement.id);
                const isOpen = expanded.has(placement.id);
                const canAct = placement.status === 'active';
                return (
                  <PlacementRows
                    key={placement.id}
                    placement={placement}
                    history={history}
                    isOpen={isOpen}
                    canAct={canAct}
                    canDelete={canDelete}
                    canTransfer={canTransfer}
                    onToggle={() => toggleExpand(placement.id)}
                    onTransfer={() => {
                      resetTransferDraft();
                      setTransferTarget(placement);
                    }}
                    onDeactivate={() => setDeactivateTarget(placement)}
                    onOverrides={() => setOverrideTarget(placement)}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={placeOpen} onOpenChange={(o) => setPlaceOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Place a student</DialogTitle>
            <DialogDescription>
              Choose the year, class and division to place a STUDENT member into. A student can
              hold one active placement per academic year.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Academic year</Label>
                <Select
                  value={placeDraft.academicYearId}
                  onValueChange={(academicYearId) =>
                    setPlaceDraft((d) => ({ ...d, academicYearId, divisionId: '', membershipId: '' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...years].sort(bySortOrder).map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Class</Label>
                <Select
                  value={placeDraft.classId}
                  onValueChange={(classId) =>
                    setPlaceDraft((d) => ({ ...d, classId, divisionId: '', membershipId: '' }))
                  }
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
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Division</Label>
              <Select
                value={placeDraft.divisionId}
                onValueChange={(divisionId) =>
                  setPlaceDraft((d) => ({ ...d, divisionId, membershipId: '' }))
                }
                disabled={!placeDraft.academicYearId || !placeDraft.classId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !placeDraft.academicYearId || !placeDraft.classId
                        ? 'Pick a year and class first'
                        : 'Select a division'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {placeDivisions.map((division) => (
                    <SelectItem key={division.id} value={division.id}>
                      {division.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Student</Label>
              <Select
                value={placeDraft.membershipId}
                onValueChange={(membershipId) => setPlaceDraft((d) => ({ ...d, membershipId }))}
                disabled={!placeDraft.divisionId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !placeDraft.divisionId
                        ? 'Pick a division first'
                        : placeable.length === 0
                          ? 'No placeable students'
                          : 'Select a student'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {placeable.map((student) => (
                    <SelectItem key={student.membershipId} value={student.membershipId}>
                      {student.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rosterUnavailable && (
                <p className="text-xs text-muted-foreground">
                  The student roster is unavailable to your role — listable by institute admins
                  only. Place from a roster-holding account.
                </p>
              )}
            </div>
          </div>

          <Separator />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPlaceOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void placeStudent()} disabled={!placeDraft.membershipId || busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Place student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {transferTarget && (
        <Dialog open={transferTarget !== null} onOpenChange={(o) => !o && setTransferTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Transfer {transferTarget.studentName}</DialogTitle>
              <DialogDescription>
                Currently {transferTarget.className} · {transferTarget.divisionName} ·{' '}
                {transferTarget.academicYearName}. Transferring archives the current placement and
                creates a fresh ACTIVE one at the destination division's year in a single step —
                the old row is kept as history.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Academic year</Label>
                  <Select
                    value={transferDraft.academicYearId}
                    onValueChange={(academicYearId) =>
                      setTransferDraft((d) => ({ ...d, academicYearId, divisionId: '' }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...years].sort(bySortOrder).map((year) => (
                        <SelectItem key={year.id} value={year.id}>
                          {year.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <Select
                    value={transferDraft.classId}
                    onValueChange={(classId) =>
                      setTransferDraft((d) => ({ ...d, classId, divisionId: '' }))
                    }
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
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Destination division</Label>
                <Select
                  value={transferDraft.divisionId}
                  onValueChange={(divisionId) => setTransferDraft((d) => ({ ...d, divisionId }))}
                  disabled={!transferDraft.academicYearId || !transferDraft.classId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !transferDraft.academicYearId || !transferDraft.classId
                          ? 'Pick a year and class first'
                          : 'Select a division'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {transferDivisions.map((division) => (
                      <SelectItem key={division.id} value={division.id}>
                        {division.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {transferDraft.divisionId && (
                <p className="text-xs text-muted-foreground">
                  Archive and place into {yearName.get(transferDraft.academicYearId) ?? '—'} ·{' '}
                  {className.get(transferDraft.classId) ?? '—'} ·{' '}
                  {transferDivisions.find((d) => d.id === transferDraft.divisionId)?.name ?? '—'}.
                  The backend refuses if the student already holds an active placement there.
                </p>
              )}
            </div>

            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTransferTarget(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void transferPlacement()}
                disabled={!transferDraft.divisionId || busy}
              >
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Transfer placement
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deactivateTarget && (
        <ConfirmDialog
          open={deactivateTarget !== null}
          onOpenChange={(o) => !o && setDeactivateTarget(null)}
          title={`Deactivate ${deactivateTarget.studentName}'s placement?`}
          description={`${deactivateTarget.studentName} is currently placed in ${deactivateTarget.className} · ${deactivateTarget.divisionName} · ${deactivateTarget.academicYearName}. Deactivating soft-archives the placement — the row is kept as history and the student is no longer placed for that year.`}
          confirmLabel="Deactivate placement"
          destructive
          loading={busy}
          onConfirm={() => void deactivatePlacement()}
        />
      )}

      {overrideTarget && (
        <EnrollmentOverridesDialog
          placement={overrideTarget}
          subjects={subjects}
          divisions={divisions}
          offeredByClass={offeredByClass}
          canCreate={canCreate}
          canDelete={canDelete}
          open={overrideTarget !== null}
          onOpenChange={(o) => !o && setOverrideTarget(null)}
          onChanged={onChange}
        />
      )}

      <CarryForwardWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        years={years}
        classes={classes}
        divisions={divisions}
        canCommit={canTransfer}
        onCommitted={() => {
          setWizardOpen(false);
          void load();
          onChange();
        }}
      />
    </div>
  );
}

// One placement row plus its expandable history rows (kept as sibling TableRows
// inside the shared TableBody so the history nests visually per student).
function PlacementRows({
  placement,
  history,
  isOpen,
  canAct,
  canDelete,
  canTransfer,
  onToggle,
  onTransfer,
  onDeactivate,
  onOverrides,
}: {
  placement: StudentPlacement;
  history: StudentPlacement[];
  isOpen: boolean;
  canAct: boolean;
  canDelete: boolean;
  canTransfer: boolean;
  onToggle: () => void;
  onTransfer: () => void;
  onDeactivate: () => void;
  onOverrides: () => void;
}) {
  return (
    <>
      <TableRow>
        <TableCell>
          {history.length > 0 && (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onToggle}
              aria-label={isOpen ? 'Collapse placement history' : 'Expand placement history'}
            >
              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          )}
        </TableCell>
        <TableCell className="font-medium">{placement.studentName}</TableCell>
        <TableCell>{placement.className}</TableCell>
        <TableCell>{placement.divisionName}</TableCell>
        <TableCell>{placement.academicYearName}</TableCell>
        <TableCell>
          <StatusBadge status={placement.status} />
        </TableCell>
        <TableCell className="text-muted-foreground">{formatDate(placement.createdAt)}</TableCell>
        <TableCell className="text-right">
          {canAct && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onOverrides}
                title="View or edit this student's subject enrollment overrides"
              >
                <BookOpenCheck className="size-3.5" />
              </Button>
              {canTransfer && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onTransfer}
                  title="Transfer to another division or year"
                >
                  <ArrowLeftRight className="size-3.5" />
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDeactivate}
                  title="Deactivate this placement"
                >
                  <Archive className="size-3.5" />
                </Button>
              )}
            </div>
          )}
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="bg-muted/30">
          <TableCell />
          <TableCell colSpan={7}>
            {history.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                No earlier placements for this student.
              </span>
            ) : (
              <ul className="space-y-1.5">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <History className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">{h.academicYearName}</span>
                    <span className="text-muted-foreground">
                      {h.className} · {h.divisionName}
                    </span>
                    <StatusBadge status={h.status} />
                    <span className="text-xs text-muted-foreground">{formatDate(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}