// Institute academic-structure console (Phase Q.2). Types mirror the rows the
// academic-structure backend returns directly (no zod schemas exist yet for
// these in @catlium/contracts); the helpers below are the pure, testable slice
// of the UI. Authorization stays backend-authoritative: writes are gated by
// the INSTITUTE_ADMIN role only (the backend has no catalogue keys for
// academic structure — see docs/architecture/institute-operations-audit.md
// §11), so the UI mirrors that decision and never invents grant keys.

import type { InstituteUser, MembershipListItem, SubjectResponse } from '@catlium/contracts';
import { canUse } from './permissions.ts';

export interface AcademicYear {
  id: string;
  instituteId: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ClassRow {
  id: string;
  instituteId: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface DivisionRow {
  id: string;
  instituteId: string;
  academicYearId: string;
  classId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeleteWarning {
  title: string;
  description: string;
}

/** A class-subject offering row: the subject plus the class_subjects id a
 *  teacher-assignment create targets (Q.3). */
export interface Offering extends SubjectResponse {
  classSubjectId: string;
}

/** A teacher-assignment row as returned by GET /academic/teacher-assignments. */
export interface TeacherAssignment {
  id: string;
  instituteId: string;
  classSubjectId: string;
  membershipId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  className: string;
  subjectName: string;
  teacherName: string;
}

/** UI mirror of the backend's staffing gate (Q.3.0): the assignments console
 *  renders for `assignments.read` and mutations for `.create`/`.delete`,
 *  exactly as the API's RequiredPermission declares. UX visibility only —
 *  never an enforcement boundary, and never weaker than the API allows. */
export function canAssign(permissions: readonly string[], action: 'read' | 'create' | 'delete'): boolean {
  return canUse(permissions, `assignments.${action}`);
}

/** Active TEACHER-role members that are not already active-assigned to the
 *  given offering — the roster the assign dialog offers. */
export function assignableTeachers(
  teachers: InstituteUser[],
  assignments: TeacherAssignment[],
  classSubjectId: string,
): InstituteUser[] {
  const taken = new Set(
    assignments
      .filter((a) => a.classSubjectId === classSubjectId && a.status === 'active')
      .map((a) => a.membershipId),
  );
  return teachers.filter(
    (t) => t.status === 'active' && t.roles.includes('TEACHER') && !taken.has(t.membershipId),
  );
}

/** Assignment table ordering: by class, then subject. */
export function byClassSubjectName(a: TeacherAssignment, b: TeacherAssignment): number {
  return a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName);
}

/** UI mirror of the backend write gate: academic-structure mutations are
 *  INSTITUTE_ADMIN role-only. UX visibility only — never an enforcement
 *  boundary, and never weaker than what the API allows. */
export function canWriteAcademicStructure(institute: MembershipListItem | null): boolean {
  return institute?.roles.includes('INSTITUTE_ADMIN') ?? false;
}

/** Warning text for the destructive class delete. The backend hard-deletes the
 *  class and cascades class_subjects, divisions, and through divisions every
 *  student_placements / student_subject_enrollments / teacher_assignments row
 *  (schema FKs are ON DELETE CASCADE). The UI must state exactly that. */
export function classDeleteWarning(
  klass: ClassRow,
  subjectCount: number,
  divisionCount: number,
): DeleteWarning {
  const parts = [
    `${divisionCount} division${divisionCount === 1 ? '' : 's'}`,
    `${subjectCount} subject offering${subjectCount === 1 ? '' : 's'}`,
  ];
  return {
    title: `Delete class “${klass.name}”?`,
    description: `This permanently removes ${parts.join(' and ')}, plus every student placement, subject enrollment, and teacher assignment under them. This cannot be undone.`,
  };
}

/** Warning text for the destructive division delete. The backend hard-deletes
 *  the division and cascades student_placements, and through them
 *  student_subject_enrollments (ON DELETE CASCADE). */
export function divisionDeleteWarning(
  division: DivisionRow,
  yearName: string,
  className: string,
): DeleteWarning {
  return {
    title: `Delete division “${division.name}”?`,
    description: `This permanently removes the ${yearName} · ${className} division and every student placement and subject enrollment within it. This cannot be undone.`,
  };
}

export function bySortOrder<T extends { sortOrder: number; name: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

// ── Q.4.4 — student placement console + carry-forward wizard ────────────
//
// Types mirror the student-placements backend responses verbatim (no zod
// schemas exist in @catlium/contracts for these). Gating reuses the `assignments`
// key family via canUse — the UI mirrors the backend's RequiredPermission /
// RequiredPermissions decisions and never assumes INSTITUTE_ADMIN. A combined
// operation (transfer, carry-forward commit) requires create AND delete exactly
// like the backend's @RequiredPermissions. UX visibility only — the API stays
// the authorization boundary.

/** A student-placement row as returned by GET /academic/student-placements. */
export interface StudentPlacement {
  id: string;
  instituteId: string;
  membershipId: string;
  academicYearId: string;
  divisionId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  studentName: string;
  academicYearName: string;
  className: string;
  divisionName: string;
}

/** A carry-forward preview proposal (design §7/§8). */
export interface CarryForwardProposal {
  placementId: string;
  membershipId: string;
  studentName: string;
  currentClassId: string;
  currentClassName: string;
  currentDivisionId: string;
  currentDivisionName: string;
  proposedDivisionId: string | null;
  proposedClassName: string | null;
  proposedDivisionName: string | null;
  flags: string[];
}

export interface CarryForwardOccupancy {
  divisionId: string;
  divisionName: string;
  className: string;
  current: number;
  projected: number;
}

export interface CarryForwardSummary {
  total: number;
  promotable: number;
  noDestination: number;
  alreadyActiveInDestinationYear: number;
  membershipNotActive: number;
}

export interface CarryForwardPreview {
  sourceAcademicYearId: string;
  destinationAcademicYearId: string;
  classId: string | null;
  proposals: CarryForwardProposal[];
  occupancy: CarryForwardOccupancy[];
  summary: CarryForwardSummary;
}

/** A freshly created placement row as returned by the carry-forward commit
 *  (raw insert rows — no joined student/class/division names). */
export interface CarriedPlacement {
  id: string;
  instituteId: string;
  membershipId: string;
  academicYearId: string;
  divisionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CarryForwardCommitResult {
  placements: CarriedPlacement[];
  skipPlacementIds: string[];
}

export const CARRY_FORWARD_FLAGS = {
  MEMBERSHIP_NOT_ACTIVE: 'membership-not-active',
  ALREADY_ACTIVE_IN_DESTINATION_YEAR: 'already-active-in-destination-year',
  NO_DESTINATION: 'no-destination',
  CLASS_NAME_CHANGED: 'class-name-changed',
} as const;

/** Human-readable label + badge tone for each carry-forward preview flag. */
export function proposalFlagInfo(
  flag: string,
): { label: string; tone: 'info' | 'warning' | 'danger' } {
  switch (flag) {
    case CARRY_FORWARD_FLAGS.MEMBERSHIP_NOT_ACTIVE:
      return { label: 'Membership inactive', tone: 'danger' };
    case CARRY_FORWARD_FLAGS.ALREADY_ACTIVE_IN_DESTINATION_YEAR:
      return { label: 'Already placed in destination year', tone: 'warning' };
    case CARRY_FORWARD_FLAGS.NO_DESTINATION:
      return { label: 'No auto-matched destination', tone: 'warning' };
    case CARRY_FORWARD_FLAGS.CLASS_NAME_CHANGED:
      return { label: 'Class missing in destination year', tone: 'info' };
    default:
      return { label: flag, tone: 'info' };
  }
}

/** A proposal that can be carried with zero admin input: the server matched a
 *  destination division AND the membership is an active STUDENT who is not
 *  already placed in the destination year. */
export function canAutoCarry(proposal: CarryForwardProposal): boolean {
  return (
    proposal.proposedDivisionId !== null &&
    !proposal.flags.includes(CARRY_FORWARD_FLAGS.NO_DESTINATION) &&
    !proposal.flags.includes(CARRY_FORWARD_FLAGS.MEMBERSHIP_NOT_ACTIVE) &&
    !proposal.flags.includes(CARRY_FORWARD_FLAGS.ALREADY_ACTIVE_IN_DESTINATION_YEAR)
  );
}

/** Destination divisions a proposal may be assigned: divisions of the SAME
 *  class in the destination year (commit enforces same-class — cross-class
 *  moves use the single transfer endpoint). */
export function destinationDivisionsFor(
  proposal: CarryForwardProposal,
  divisions: DivisionRow[],
  destinationAcademicYearId: string,
): DivisionRow[] {
  return divisions.filter(
    (d) => d.academicYearId === destinationAcademicYearId && d.classId === proposal.currentClassId,
  );
}

/** Whether a combined placement operation (transfer, carry-forward commit) is
 *  allowed — the backend requires assignments.create AND assignments.delete
 *  (@RequiredPermissions). */
export function canTransfer(permissions: readonly string[]): boolean {
  return canUse(permissions, 'assignments.create') && canUse(permissions, 'assignments.delete');
}

/** Per-proposal wizard decision: the exact destination division chosen (null =
 *  none) and whether the student is intentionally skipped (repeat / leaving /
 *  no destination). */
export interface CarryForwardDecision {
  destinationDivisionId: string | null;
  skip: boolean;
}

/** Defaults every proposal toward the least-surprising commit plan: blocked
 *  proposals (deactivated membership, already present in the destination year)
 *  are force-skipped; auto-matched proposals keep the server suggestion;
 *  un-matched proposals whose class exists in the destination year are left for
 *  an admin pick ('' = must choose); classes with no destination at all sit
 *  unresolved for the admin to skip or confirm as left-behind. */
export function defaultCarryForwardDecisions(
  proposals: CarryForwardProposal[],
  divisions: DivisionRow[],
  destinationAcademicYearId: string,
): Record<string, CarryForwardDecision> {
  const out: Record<string, CarryForwardDecision> = {};
  for (const proposal of proposals) {
    const blocked =
      proposal.flags.includes(CARRY_FORWARD_FLAGS.MEMBERSHIP_NOT_ACTIVE) ||
      proposal.flags.includes(CARRY_FORWARD_FLAGS.ALREADY_ACTIVE_IN_DESTINATION_YEAR);
    const options = destinationDivisionsFor(proposal, divisions, destinationAcademicYearId);
    if (blocked) {
      out[proposal.placementId] = { destinationDivisionId: null, skip: true };
    } else if (
      proposal.proposedDivisionId &&
      options.some((d) => d.id === proposal.proposedDivisionId)
    ) {
      out[proposal.placementId] = { destinationDivisionId: proposal.proposedDivisionId, skip: false };
    } else if (options.length > 0) {
      out[proposal.placementId] = { destinationDivisionId: '', skip: false };
    } else {
      out[proposal.placementId] = { destinationDivisionId: null, skip: false };
    }
  }
  return out;
}

/** Roll up the definitive plan into the confirm step's numbers: promoted
 *  (carried now), skipped (explicitly left active in the source year), and
 *  left behind (no destination chosen/available, not skipped). */
export function carryForwardSummary(
  proposals: CarryForwardProposal[],
  decisions: Record<string, CarryForwardDecision>,
): { promoted: number; skipped: number; leftBehind: number } {
  let promoted = 0;
  let skipped = 0;
  let leftBehind = 0;
  for (const proposal of proposals) {
    const decision = decisions[proposal.placementId];
    if (decision?.skip) {
      skipped += 1;
    } else if (decision?.destinationDivisionId) {
      promoted += 1;
    } else {
      leftBehind += 1;
    }
  }
  return { promoted, skipped, leftBehind };
}

/** The exact carry-forward commit request body for a confirmed plan. Empty
 *  items is not sent (the backend requires a non-empty plan). */
export function carryForwardCommitPayload(
  destinationAcademicYearId: string,
  proposals: CarryForwardProposal[],
  decisions: Record<string, CarryForwardDecision>,
): {
  destinationAcademicYearId: string;
  items: { placementId: string; destinationDivisionId: string }[];
  skipPlacementIds?: string[];
} {
  const items: { placementId: string; destinationDivisionId: string }[] = [];
  const skipPlacementIds: string[] = [];
  for (const proposal of proposals) {
    const decision = decisions[proposal.placementId];
    if (decision?.skip) {
      skipPlacementIds.push(proposal.placementId);
    } else if (decision?.destinationDivisionId) {
      items.push({ placementId: proposal.placementId, destinationDivisionId: decision.destinationDivisionId });
    }
  }
  return { destinationAcademicYearId, items, ...(skipPlacementIds.length > 0 ? { skipPlacementIds } : {}) };
}

/** Roster filter for a placement's academic year (and class via the division
 *  → classId map). Pure client-side narrowing over the already-fetched list. */
export function filterPlacements(
  placements: StudentPlacement[],
  divisions: DivisionRow[],
  academicYearId: string | null,
  classId: string | null,
): StudentPlacement[] {
  const divisionClass = new Map(divisions.map((d) => [d.id, d.classId]));
  return placements.filter((p) => {
    if (academicYearId && p.academicYearId !== academicYearId) return false;
    if (classId && divisionClass.get(p.divisionId) !== classId) return false;
    return true;
  });
}

/** A student's other placements (placement history) from the already-loaded
 *  list, excluding the row the history is expanded from. The list arrives
 *  year-ordered from the backend, so filtering preserves chronology. */
export function placementHistory(
  placements: StudentPlacement[],
  membershipId: string,
  excludeId: string,
): StudentPlacement[] {
  return placements.filter((p) => p.membershipId === membershipId && p.id !== excludeId);
}

/** Active STUDENT roster members the place dialog may offer for a division:
 *  no ACTIVE placement already exists for them in that division's academic
 *  year (the backend's partial-unique 409 mirror). */
export function placeableStudents(
  roster: InstituteUser[],
  placements: StudentPlacement[],
  divisionId: string | null,
  divisions: DivisionRow[],
): InstituteUser[] {
  const yearId = divisionId ? divisions.find((d) => d.id === divisionId)?.academicYearId : undefined;
  const taken = new Set(
    placements
      .filter((p) => p.status === 'active' && p.academicYearId === yearId)
      .map((p) => p.membershipId),
  );
  return roster.filter(
    (u) => u.status === 'active' && u.roles.includes('STUDENT') && (!divisionId || !taken.has(u.membershipId)),
  );
}

export function filterDivisions(
  divisions: DivisionRow[],
  academicYearId: string | null,
  classId: string | null,
): DivisionRow[] {
  return divisions.filter(
    (d) =>
      (!academicYearId || d.academicYearId === academicYearId) &&
      (!classId || d.classId === classId),
  );
}