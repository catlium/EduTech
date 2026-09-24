'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, CheckCircle2, ChevronLeft, Loader2, Users } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  bySortOrder,
  carryForwardCommitPayload,
  carryForwardSummary,
  defaultCarryForwardDecisions,
  destinationDivisionsFor,
  proposalFlagInfo,
  type AcademicYear,
  type CarryForwardDecision,
  type CarryForwardPreview,
  type CarryForwardProposal,
  type CarryForwardCommitResult,
  type ClassRow,
  type DivisionRow,
} from '@/lib/academic';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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

// Phase Q.4.4 — academic-year carry-forward wizard (design §9). A read-gated
// proposal → review → confirm flow over POST carry-forward/preview + commit.
// The destination-year picker only offers years that sort strictly after the
// source (mirror of the backend's strict-forward rule), and the per-student
// destination pickers only offer SAME-CLASS divisions of the destination year
// (the commit rejects cross-class targets — those use the transfer endpoint).
// Commit (create AND delete) is gated by `canCommit` and stays disabled until
// at least one row is staged to be carried.

type Step = 'select' | 'review' | 'confirm';

const flagTone: Record<'info' | 'warning' | 'danger', string> = {
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

function isBlocked(proposal: CarryForwardProposal): boolean {
  return (
    proposal.flags.includes('membership-not-active') ||
    proposal.flags.includes('already-active-in-destination-year')
  );
}

export function CarryForwardWizard({
  open,
  onOpenChange,
  years,
  classes,
  divisions,
  canCommit,
  onCommitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  years: AcademicYear[];
  classes: ClassRow[];
  divisions: DivisionRow[];
  canCommit: boolean;
  onCommitted: () => void;
}) {
  const sortedYears = useMemo(() => [...years].sort(bySortOrder), [years]);

  const [step, setStep] = useState<Step>('select');
  const [sourceYearId, setSourceYearId] = useState('');
  const [destYearId, setDestYearId] = useState('');
  const [classId, setClassId] = useState('');
  const [preview, setPreview] = useState<CarryForwardPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CarryForwardDecision>>({});
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CarryForwardCommitResult | null>(null);

  const sourceYear = sortedYears.find((y) => y.id === sourceYearId);
  const destYears = sourceYear
    ? sortedYears.filter((y) => y.sortOrder > sourceYear.sortOrder)
    : [];

  function close() {
    if (loading || committing) return;
    onOpenChange(false);
  }

  function reset() {
    setStep('select');
    setSourceYearId('');
    setDestYearId('');
    setClassId('');
    setPreview(null);
    setDecisions({});
    setResult(null);
  }

  async function runPreview() {
    if (!sourceYearId || !destYearId) return;
    setLoading(true);
    try {
      const body: { sourceAcademicYearId: string; destinationAcademicYearId: string; classId?: string } =
        { sourceAcademicYearId: sourceYearId, destinationAcademicYearId: destYearId };
      if (classId) body.classId = classId;
      const { preview: data } = await api<{ preview: CarryForwardPreview }>(
        '/academic/student-placements/carry-forward/preview',
        { method: 'POST', body },
      );
      setPreview(data);
      setDecisions(
        defaultCarryForwardDecisions(data.proposals, divisions, data.destinationAcademicYearId),
      );
      setResult(null);
      setStep('review');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to preview carry-forward');
    } finally {
      setLoading(false);
    }
  }

  function setDecision(placementId: string, decision: CarryForwardDecision) {
    setDecisions((prev) => ({ ...prev, [placementId]: decision }));
  }

  async function runCommit() {
    if (!preview) return;
    setCommitting(true);
    try {
      const body = carryForwardCommitPayload(
        preview.destinationAcademicYearId,
        preview.proposals,
        decisions,
      );
      const { result: committed } = await api<{ result: CarryForwardCommitResult }>(
        '/academic/student-placements/carry-forward/commit',
        { method: 'POST', body },
      );
      setResult(committed);
      onCommitted();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to commit carry-forward plan — nothing was changed',
      );
    } finally {
      setCommitting(false);
    }
  }

  const tally = preview ? carryForwardSummary(preview.proposals, decisions) : { promoted: 0, skipped: 0, leftBehind: 0 };
  const destOptionsFor = (proposal: CarryForwardProposal) =>
    preview ? destinationDivisionsFor(proposal, divisions, preview.destinationAcademicYearId) : [];

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? reset() : close())}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Carry forward student placements</DialogTitle>
          <DialogDescription>
            Propose every student's placement from one academic year into the next. Review and
            adjust per student, then commit — the whole plan applies atomically or not at all.
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Source year</Label>
                <Select
                  value={sourceYearId}
                  onValueChange={(id) => {
                    setSourceYearId(id);
                    setDestYearId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedYears.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Destination year</Label>
                <Select value={destYearId} onValueChange={setDestYearId} disabled={!sourceYearId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        sourceYearId && destYears.length === 0
                          ? 'No later year exists'
                          : 'Select year'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {destYears.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Class (optional)</Label>
                <Select value={classId} onValueChange={setClassId}>
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

            {destYears.length === 0 && sourceYearId && (
              <Alert>
                <AlertTitle>No later year</AlertTitle>
                <AlertDescription>
                  {sortedYears.find((y) => y.id === sourceYearId)?.name} is the last academic year —
                  there is nothing to carry forward into.
                </AlertDescription>
              </Alert>
            )}

            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => void runPreview()} disabled={!sourceYearId || !destYearId || loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                Preview
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'review' && preview && (
          <>
            <p className="text-sm text-muted-foreground">
              {preview.proposals.length === 0
                ? 'No active placements to carry forward for the selected scope.'
                : `${preview.proposals.length} active placement${preview.proposals.length === 1 ? '' : 's'} to consider. Students flagged below need a decision before the plan can commit.`}
            </p>

            {preview.proposals.length > 0 && (
              <div className="rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Current</TableHead>
                      <TableHead>Destination division</TableHead>
                      <TableHead className="w-20">Skip</TableHead>
                      <TableHead>Flags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.proposals.map((proposal) => {
                      const decision = decisions[proposal.placementId];
                      const blocked = isBlocked(proposal);
                      const options = destOptionsFor(proposal);
                      return (
                        <TableRow key={proposal.placementId}>
                          <TableCell className="font-medium">{proposal.studentName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {proposal.currentClassName} · {proposal.currentDivisionName}
                          </TableCell>
                          <TableCell>
                            <div className="w-52">
                              <Select
                                value={decision?.destinationDivisionId || ''}
                                onValueChange={(id) =>
                                  setDecision(proposal.placementId, {
                                    destinationDivisionId: id,
                                    skip: false,
                                  })
                                }
                                disabled={blocked || options.length === 0}
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={
                                      options.length === 0
                                        ? 'No division in year'
                                        : blocked
                                          ? 'Not carried'
                                          : 'Choose division'
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {options.map((d) => (
                                    <SelectItem key={d.id} value={d.id}>
                                      {d.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Checkbox
                              checked={decision?.skip ?? false}
                              disabled={blocked}
                              onCheckedChange={(checked) =>
                                setDecision(proposal.placementId, {
                                  destinationDivisionId: checked ? null : proposal.proposedDivisionId,
                                  skip: checked === true,
                                })
                              }
                              aria-label={`Skip ${proposal.studentName}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {proposal.flags.map((flag) => (
                                <Badge key={flag} className={cn('font-medium', flagTone[proposalFlagInfo(flag).tone])}>
                                  {proposalFlagInfo(flag).label}
                                </Badge>
                              ))}
                              {decision?.destinationDivisionId &&
                                decision.destinationDivisionId !== proposal.proposedDivisionId && (
                                  <Badge variant="secondary">Adjusted</Badge>
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {preview.occupancy.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Users className="size-4 text-muted-foreground" />
                  Destination occupancy
                </p>
                <div className="rounded-xl border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Class</TableHead>
                        <TableHead>Division</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Projected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.occupancy.map((o) => (
                        <TableRow key={o.divisionId}>
                          <TableCell>{o.className}</TableCell>
                          <TableCell>{o.divisionName}</TableCell>
                          <TableCell className="text-right">{o.current}</TableCell>
                          <TableCell className="text-right font-medium">{o.projected}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5" />
              Skip keeps the source placement ACTIVE (repeat or leaving). Leaving a student without a
              destination and without skipping leaves them ACTIVE in the source year with no carry.
            </p>

            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setStep('select')}>
                <ChevronLeft className="mr-1.5 size-4" /> Back
              </Button>
              <Button onClick={() => setStep('confirm')} disabled={preview.proposals.length === 0}>
                Review plan <ArrowRight className="ml-1.5 size-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'confirm' && preview && (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border bg-card p-3">
                <p className="text-2xl font-semibold">{tally.promoted}</p>
                <p className="text-xs text-muted-foreground">Carried forward</p>
              </div>
              <div className="rounded-xl border bg-card p-3">
                <p className="text-2xl font-semibold">{tally.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped (kept active)</p>
              </div>
              <div className="rounded-xl border bg-card p-3">
                <p className="text-2xl font-semibold">{tally.leftBehind}</p>
                <p className="text-xs text-muted-foreground">Left in source year</p>
              </div>
            </div>

            {!canCommit && (
              <Alert>
                <AlertTitle>No permission to commit</AlertTitle>
                <AlertDescription>
                  Committing a plan archives the source placements and creates fresh ones — it
                  requires both assignments.create and assignments.delete grants. You can review
                  plans, but ask an admin to run the commit.
                </AlertDescription>
              </Alert>
            )}

            {tally.promoted === 0 && (
              <Alert>
                <AlertTitle>Nothing to carry</AlertTitle>
                <AlertDescription>
                  The plan contains no placements to promote. Go back and choose a destination
                  division or uncheck skips before committing.
                </AlertDescription>
              </Alert>
            )}

            {result && (
              <Alert>
                <AlertTitle>Plan committed</AlertTitle>
                <AlertDescription>
                  {result.placements.length} placement{result.placements.length === 1 ? '' : 's'} created
                  {result.skipPlacementIds.length > 0
                    ? `, ${result.skipPlacementIds.length} left in the source year`
                    : ''}
                  .
                </AlertDescription>
              </Alert>
            )}

            <Separator />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setStep('review')} disabled={committing}>
                <ChevronLeft className="mr-1.5 size-4" /> Back
              </Button>
              <Button
                onClick={() => void runCommit()}
                disabled={!canCommit || tally.promoted === 0 || committing || result !== null}
              >
                {committing && <Loader2 className="mr-2 size-4 animate-spin" />}
                {result ? 'Committed' : `Commit ${tally.promoted} placement${tally.promoted === 1 ? '' : 's'}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}