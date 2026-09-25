import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InstituteUser, MembershipListItem, Role } from '@catlium/contracts';

import {
  canWriteAcademicStructure,
  classDeleteWarning,
  divisionDeleteWarning,
  bySortOrder,
  filterDivisions,
  assignableTeachers,
  byClassSubjectName,
  canAssign,
  canTransfer,
  proposalFlagInfo,
  canAutoCarry,
  destinationDivisionsFor,
  defaultCarryForwardDecisions,
  carryForwardSummary,
  carryForwardCommitPayload,
  filterPlacements,
  placementHistory,
  placeableStudents,
  togglePlacementSelection,
  togglePlacementSelectAll,
  bulkPlacementPayload,
  canSubmitBulkPlacement,
  canEnroll,
  offeredSubjectIdsForDivision,
  enrollmentState,
  canCreateEnrollmentOverride,
  canRemoveEnrollmentOverride,
  type AcademicYear,
  type CarryForwardDecision,
  type CarryForwardProposal,
  type ClassRow,
  type DivisionRow,
  type Offering,
  type StudentPlacement,
  type StudentSubjectEnrollment,
  type TeacherAssignment,
} from './academic.ts';

const baseMembership = {
  instituteId: 'i1',
  instituteName: 'Demo Institute',
  slug: 'demo',
  status: 'active',
  instituteStatus: 'active',
  permissions: [],
  roles: [] as Role[],
};

const adminMembership: MembershipListItem = {
  ...baseMembership,
  roles: ['INSTITUTE_ADMIN'],
};

test('canWriteAcademicStructure mirrors the backend INSTITUTE_ADMIN role gate', () => {
  assert.equal(canWriteAcademicStructure(adminMembership), true);
  assert.equal(
    canWriteAcademicStructure({ ...baseMembership, roles: ['TEACHER'] }),
    false,
  );
  assert.equal(
    canWriteAcademicStructure({ ...baseMembership, roles: ['TEACHER', 'STUDENT'] }),
    false,
  );
  assert.equal(canWriteAcademicStructure(null), false);
});

const klass: ClassRow = {
  id: 'c1',
  instituteId: 'i1',
  name: 'Class X',
  sortOrder: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('classDeleteWarning spells out every cascaded consequence', () => {
  const warning = classDeleteWarning(klass, 5, 2);
  assert.equal(warning.title, 'Delete class “Class X”?');
  assert.match(warning.description, /2 divisions/);
  assert.match(warning.description, /5 subject offerings/);
  assert.match(warning.description, /student placement/);
  assert.match(warning.description, /subject enrollment/);
  assert.match(warning.description, /teacher assignment/);
  assert.match(warning.description, /cannot be undone/);
});

test('classDeleteWarning stays singular for single-item cascades', () => {
  const warning = classDeleteWarning(klass, 1, 1);
  assert.match(warning.description, /1 division/);
  assert.match(warning.description, /1 subject offering/);
});

const division: DivisionRow = {
  id: 'd1',
  instituteId: 'i1',
  academicYearId: 'y1',
  classId: 'c1',
  name: 'A',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('divisionDeleteWarning names year/class and cascaded placements', () => {
  const warning = divisionDeleteWarning(division, '2025-26', 'Class X');
  assert.equal(warning.title, 'Delete division “A”?');
  assert.match(warning.description, /2025-26 · Class X/);
  assert.match(warning.description, /student placement/);
  assert.match(warning.description, /subject enrollment/);
  assert.match(warning.description, /cannot be undone/);
});

const year1: AcademicYear = { id: 'y1', instituteId: 'i1', name: '2025-26', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' };
const year2: AcademicYear = { id: 'y2', instituteId: 'i1', name: '2026-27', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' };

test('bySortOrder orders by sortOrder then name', () => {
  const rows = [
    { sortOrder: 1, name: 'Z' },
    { sortOrder: 1, name: 'A' },
    { sortOrder: 0, name: 'B' },
  ];
  assert.deepEqual(rows.sort(bySortOrder).map((r) => `${r.sortOrder}${r.name}`), ['0B', '1A', '1Z']);
  assert.deepEqual([year2, year1].sort(bySortOrder).map((y) => y.id), ['y1', 'y2']);
});

test('filterDivisions narrows by year, class, both, or neither', () => {
  const d2: DivisionRow = { ...division, id: 'd2', classId: 'c2' };
  const d3: DivisionRow = { ...division, id: 'd3', academicYearId: 'y2' };
  const all = [division, d2, d3];

  assert.deepEqual(filterDivisions(all, 'y1', null).map((d) => d.id), ['d1', 'd2']);
  assert.deepEqual(filterDivisions(all, null, 'c1').map((d) => d.id), ['d1', 'd3']);
  assert.deepEqual(filterDivisions(all, 'y1', 'c1').map((d) => d.id), ['d1']);
  assert.deepEqual(filterDivisions(all, 'y2', 'c1').map((d) => d.id), ['d3']);
  assert.equal(filterDivisions(all, null, null).length, 3);
  assert.equal(filterDivisions(all, 'y1', 'c9').length, 0);
});

// ── Q.3 — teacher-assignment console helpers ────────────────────

const teacher = (id: string, name: string, status = 'active', roles: Role[] = ['TEACHER']): InstituteUser => ({
  id: `u-${id}`,
  email: `${id}@t.test`,
  name,
  membershipId: `m-${id}`,
  roles,
  status: status as InstituteUser['status'],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const assignment = (
  id: string,
  classSubjectId: string,
  membershipId: string,
  status: TeacherAssignment['status'] = 'active',
): TeacherAssignment => ({
  id,
  instituteId: 'i1',
  classSubjectId,
  membershipId,
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  className: `Class ${classSubjectId[0]}`,
  subjectName: `Subject ${classSubjectId.slice(-1)}`,
  teacherName: 'Any',
});

test('assignableTeachers = active TEACHer teachers not already active-assigned to the offering', () => {
  const ann = teacher('a', 'Ann');
  const bob = teacher('b', 'Bob');
  const carol = teacher('c', 'Carol', 'deactivated');
  const dean = teacher('d', 'Dean', 'active', ['STUDENT']);

  const took = assignment('x1', 'cs1', 'm-a');
  const inactiveOnCs1 = assignment('x2', 'cs1', 'm-b', 'inactive');

  const available = assignableTeachers([ann, bob, carol, dean], [took, inactiveOnCs1], 'cs1');
  assert.deepEqual(available.map((u) => u.name), ['Bob']);
  // bob's inactive assignment on cs1 does not clear the offering for another class subject.
  assert.equal(assignableTeachers([bob], [inactiveOnCs1], 'cs2').length, 1);
  assert.deepEqual(assignableTeachers([ann, bob], [], 'cs9').map((u) => u.name), ['Ann', 'Bob']);
});

test('byClassSubjectName orders by class then subject', () => {
  const rows = [
    { ...assignment('1', 'cs-b', 'm-1'), className: 'Beta', subjectName: 'Bio' },
    { ...assignment('2', 'cs-a', 'm-2'), className: 'Alpha', subjectName: 'Chem' },
    { ...assignment('3', 'cs-a', 'm-3'), className: 'Alpha', subjectName: 'Math' },
  ];
  assert.deepEqual(
    [...rows].sort(byClassSubjectName).map((r) => `${r.className}:${r.subjectName}`),
    ['Alpha:Chem', 'Alpha:Math', 'Beta:Bio'],
  );
});

test('canAssign mirrors the assignments.* permission gate with manage implication', () => {
  assert.equal(canAssign(['assignments.read'], 'read'), true);
  assert.equal(canAssign(['assignments.read'], 'create'), false);
  assert.equal(canAssign(['assignments.manage'], 'create'), true);
  assert.equal(canAssign(['assignments.manage'], 'delete'), true);
  assert.equal(canAssign(['assignments.create'], 'delete'), false);
  assert.equal(canAssign([], 'read'), false);
  assert.equal(canAssign(['subjects.read'], 'read'), false);
});

// ── Q.4.4 — student placement console + carry-forward wizard helpers ──

test('canTransfer requires BOTH assignments.create and assignments.delete (backend AND rule)', () => {
  assert.equal(canTransfer(['assignments.create', 'assignments.delete']), true);
  assert.equal(canTransfer(['assignments.create']), false);
  assert.equal(canTransfer(['assignments.delete']), false);
  assert.equal(canTransfer(['assignments.manage']), true);
  assert.equal(canTransfer(['assignments.read']), false);
  assert.equal(canTransfer([]), false);
});

const proposal = (
  overrides: Partial<CarryForwardProposal> = {},
): CarryForwardProposal => ({
  placementId: 'pl1',
  membershipId: 'm1',
  studentName: 'Ada',
  currentClassId: 'c1',
  currentClassName: 'Class X',
  currentDivisionId: 'd1',
  currentDivisionName: 'A',
  proposedDivisionId: 'dy1',
  proposedClassName: 'Class X',
  proposedDivisionName: 'A',
  flags: [],
  ...overrides,
});

test('proposalFlagInfo maps every carry-forward flag to a label + tone', () => {
  assert.deepEqual(proposalFlagInfo('membership-not-active'), { label: 'Membership inactive', tone: 'danger' });
  assert.deepEqual(proposalFlagInfo('already-active-in-destination-year'), { label: 'Already placed in destination year', tone: 'warning' });
  assert.deepEqual(proposalFlagInfo('no-destination'), { label: 'No auto-matched destination', tone: 'warning' });
  assert.deepEqual(proposalFlagInfo('class-name-changed'), { label: 'Class missing in destination year', tone: 'info' });
});

test('canAutoCarry = matched destination AND no membership/occupancy blockers', () => {
  assert.equal(canAutoCarry(proposal()), true);
  assert.equal(canAutoCarry(proposal({ proposedDivisionId: null })), false);
  assert.equal(canAutoCarry(proposal({ flags: ['no-destination'] })), false);
  assert.equal(canAutoCarry(proposal({ flags: ['membership-not-active'] })), false);
  assert.equal(canAutoCarry(proposal({ flags: ['already-active-in-destination-year'] })), false);
});

test('destinationDivisionsFor offers only same-class divisions of the destination year', () => {
  const destYear = new Map([
    ['dy1', { ...division, id: 'dy1', academicYearId: 'y2' }],
    ['dy2', { ...division, id: 'dy2', academicYearId: 'y2', classId: 'c2' }],
    ['fy1', { ...division, id: 'fy1', academicYearId: 'y1' }],
  ]);
  const options = destinationDivisionsFor(proposal(), [...destYear.values()], 'y2');
  assert.deepEqual(options.map((d) => d.id), ['dy1']);
});

test('defaultCarryForwardDecisions picks the least-surprising plan for each scenario', () => {
  const destYear = 'y2';
  const auto = proposal(); // matched → keep suggestion
  const blocked = proposal({ placementId: 'pl2', flags: ['membership-not-active'], proposedDivisionId: null });
  const occupied = proposal({ placementId: 'pl3', flags: ['already-active-in-destination-year'] });
  const unmatched = proposal({ placementId: 'pl4', proposedDivisionId: null, flags: ['no-destination'] });
  const noClass = proposal({ placementId: 'pl5', proposedDivisionId: null, currentClassId: 'c3', flags: ['no-destination', 'class-name-changed'] });
  const divisions = [
    { ...division, id: 'dy1', academicYearId: 'y2' },
    { ...division, id: 'dy2', academicYearId: 'y2', classId: 'c2' },
  ];
  const decisions = defaultCarryForwardDecisions(
    [auto, blocked, occupied, unmatched, noClass],
    divisions,
    destYear,
  );
  assert.deepEqual(decisions.pl1, { destinationDivisionId: 'dy1', skip: false });
  assert.deepEqual(decisions.pl2, { destinationDivisionId: null, skip: true });
  assert.deepEqual(decisions.pl3, { destinationDivisionId: null, skip: true });
  assert.deepEqual(decisions.pl4, { destinationDivisionId: '', skip: false });
  assert.deepEqual(decisions.pl5, { destinationDivisionId: null, skip: false });
});

test('carryForwardSummary counts promoted / skipped / left-behind', () => {
  const decisions: Record<string, CarryForwardDecision> = {
    pl1: { destinationDivisionId: 'dy1', skip: false },
    pl2: { destinationDivisionId: null, skip: true },
    pl3: { destinationDivisionId: '', skip: false },
    pl4: { destinationDivisionId: null, skip: false },
    pl5: { destinationDivisionId: 'dy2', skip: true }, // skip wins over a selection
  };
  const summary = carryForwardSummary(
    [proposal(), proposal({ placementId: 'pl2', proposedDivisionId: 'dy1' }), proposal({ placementId: 'pl3', proposedDivisionId: 'dy1' }), proposal({ placementId: 'pl4', proposedDivisionId: 'dy1' }), proposal({ placementId: 'pl5', proposedDivisionId: 'dy1' })],
    decisions,
  );
  assert.deepEqual(summary, { promoted: 1, skipped: 2, leftBehind: 2 });
});

test('carryForwardCommitPayload builds the exact backend body (items + optional skips)', () => {
  const decisions: Record<string, CarryForwardDecision> = {
    pl1: { destinationDivisionId: 'dy1', skip: false },
    pl2: { destinationDivisionId: null, skip: true },
    pl3: { destinationDivisionId: '', skip: false },
  };
  const body = carryForwardCommitPayload('y2', [proposal(), proposal({ placementId: 'pl2', currentClassId: 'c2' }), proposal({ placementId: 'pl3', currentClassId: 'c2' })], decisions);
  assert.deepEqual(body, {
    destinationAcademicYearId: 'y2',
    items: [{ placementId: 'pl1', destinationDivisionId: 'dy1' }],
    skipPlacementIds: ['pl2'],
  });
  // all-skipped / empty plan omits the skip key entirely (backend requires items)
  const none = carryForwardCommitPayload('y2', [], {});
  assert.deepEqual(none, { destinationAcademicYearId: 'y2', items: [] });
  assert.equal('skipPlacementIds' in none, false);
});

test('filterPlacements narrows by year and class via the division map', () => {
  const p1: StudentPlacement = { id: 'p1', instituteId: 'i1', membershipId: 'm1', academicYearId: 'y1', divisionId: 'd1', status: 'active', createdAt: '', updatedAt: '', studentName: 'Ada', academicYearName: '2025-26', className: 'Class X', divisionName: 'A' };
  const p2: StudentPlacement = { ...p1, id: 'p2', academicYearId: 'y2', divisionId: 'd3' };
  const p3: StudentPlacement = { ...p1, id: 'p3', divisionId: 'd2' };
  const divisions = [
    { ...division, id: 'd1', classId: 'c1' },
    { ...division, id: 'd2', classId: 'c2' },
    { ...division, id: 'd3', classId: 'c1', academicYearId: 'y2' },
  ];
  assert.deepEqual(filterPlacements([p1, p2, p3], divisions, 'y1', null).map((p) => p.id), ['p1', 'p3']);
  assert.deepEqual(filterPlacements([p1, p2, p3], divisions, null, 'c1').map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(filterPlacements([p1, p2, p3], divisions, 'y2', 'c1').map((p) => p.id), ['p2']);
  assert.deepEqual(filterPlacements([p1, p2, p3], divisions, 'y1', 'c1').map((p) => p.id), ['p1']);
  assert.equal(filterPlacements([p1, p2, p3], divisions, 'y9', null).length, 0);
});

test('placementHistory returns a student’s other placements excluding the expanded row', () => {
  const current: StudentPlacement = { id: 'p1', instituteId: 'i1', membershipId: 'm1', academicYearId: 'y1', divisionId: 'd1', status: 'active', createdAt: '', updatedAt: '', studentName: 'Ada', academicYearName: '2025-26', className: 'Class X', divisionName: 'A' };
  const prior = { ...current, id: 'p0', academicYearId: 'y0', status: 'inactive' as const };
  const other = { ...current, id: 'p9', membershipId: 'm9' };
  const history = placementHistory([current, prior, other], 'm1', 'p1');
  assert.deepEqual(history.map((p) => p.id), ['p0']);
  assert.equal(placementHistory([current], 'm1', 'p1').length, 0);
});

test('placeableStudents = active STUDENT roster not already active in the division’s year', () => {
  const ann = teacher('a', 'Ann', 'active', ['STUDENT']);
  const bob = teacher('b', 'Bob', 'active', ['STUDENT']);
  const carol = teacher('c', 'Carol', 'deactivated', ['STUDENT']);
  const dean = teacher('d', 'Dean', 'active', ['TEACHER', 'STUDENT']);
  const placed: StudentPlacement = {
    id: 'p1', instituteId: 'i1', membershipId: 'm-a', academicYearId: 'y1', divisionId: 'd1',
    status: 'active', createdAt: '', updatedAt: '', studentName: 'Ann', academicYearName: '2025-26', className: 'Class X', divisionName: 'A',
  };
  const elsewhere = { ...placed, id: 'p2', membershipId: 'm-b', academicYearId: 'y2' };
  const divisions = [{ ...division, id: 'd1', academicYearId: 'y1' }];
  const available = placeableStudents([ann, bob, carol, dean], [placed, elsewhere], 'd1', divisions);
  assert.deepEqual(available.map((u) => u.name), ['Bob', 'Dean']);
  assert.equal(placeableStudents([ann, bob], [], null, divisions).length, 2);
  assert.equal(placeableStudents([ann], [placed], 'd1', divisions).length, 0);
});

// ── F.1 — bulk place dialog helpers ────────────────────────────────────

test('togglePlacementSelection toggles a single student in/out of the selection', () => {
  assert.deepEqual(togglePlacementSelection([], 'm1'), ['m1']);
  assert.deepEqual(togglePlacementSelection(['m1'], 'm1'), []);
  assert.deepEqual(togglePlacementSelection(['m1', 'm2'], 'm3'), ['m1', 'm2', 'm3']);
  assert.deepEqual(togglePlacementSelection(['m1', 'm2'], 'm2'), ['m1']);
});

test('togglePlacementSelectAll selects the visible roster, then clears only the visible subset', () => {
  assert.deepEqual(togglePlacementSelectAll([], ['m1', 'm2']), ['m1', 'm2']);
  // already fully selected → toggle clears the visible set only
  assert.deepEqual(togglePlacementSelectAll(['m1', 'm2'], ['m1', 'm2']), []);
  // students selected outside the visible roster are preserved
  assert.deepEqual(togglePlacementSelectAll(['m9'], ['m1', 'm2']), ['m9', 'm1', 'm2']);
  assert.deepEqual(togglePlacementSelectAll(['m9', 'm1', 'm2'], ['m1', 'm2']), ['m9']);
  // empty visible roster is a no-op
  assert.deepEqual(togglePlacementSelectAll(['m1'], []), ['m1']);
});

test('bulkPlacementPayload = selected membershipIds + one destination division', () => {
  assert.deepEqual(bulkPlacementPayload(['m1', 'm2'], 'd1'), { membershipIds: ['m1', 'm2'], divisionId: 'd1' });
});

test('canSubmitBulkPlacement requires a division AND at least one selected student', () => {
  assert.equal(canSubmitBulkPlacement([], 'd1'), false);
  assert.equal(canSubmitBulkPlacement(['m1'], null), false);
  assert.equal(canSubmitBulkPlacement(['m1'], ''), false);
  assert.equal(canSubmitBulkPlacement(['m1'], 'd1'), true);
});

// ── E.2 — student subject-enrollment override helpers ──────────────────

test('canEnroll mirrors assignments.* with manage implication', () => {
  assert.equal(canEnroll(['assignments.read'], 'read'), true);
  assert.equal(canEnroll(['assignments.read'], 'create'), false);
  assert.equal(canEnroll(['assignments.manage'], 'delete'), true);
});

test('offeredSubjectIdsForDivision maps division -> offered subject IDs', () => {
  const divs = [
    { ...division, id: 'd1', classId: 'c1' },
    { ...division, id: 'd2', classId: 'c2' },
  ];
  const offering = (id: string): Offering => ({
    id, instituteId: 'i1', name: id, slug: id, description: null, sortOrder: 0, status: 'active', createdAt: '', updatedAt: '', classSubjectId: `cs-${id}`,
  });
  const offeredByClass: Record<string, Offering[]> = { c1: [offering('s1'), offering('s2')], c2: [offering('s3')] };
  const set = offeredSubjectIdsForDivision('d1', divs, offeredByClass);
  assert.equal(set.has('s1'), true);
  assert.equal(set.has('s2'), true);
  assert.equal(set.has('s3'), false);
});

test('enrollmentState returns DEFAULT/ENROLLED/EXCLUDED', () => {
  const enrollments: StudentSubjectEnrollment[] = [
    { id: 'e1', instituteId: 'i1', placementId: 'p1', subjectId: 's2', kind: 'ENROLLED', createdAt: '' },
  ];
  assert.equal(enrollmentState(enrollments, 'p1', 's1'), 'DEFAULT');
  assert.equal(enrollmentState(enrollments, 'p1', 's2'), 'ENROLLED');
  assert.equal(enrollmentState(enrollments, 'p99', 's2'), 'DEFAULT');
});

test('canCreateEnrollmentOverride enforces EXCLUDED must be offered, ENROLLED not offered', () => {
  const offered = new Set(['s1']);
  assert.equal(canCreateEnrollmentOverride('EXCLUDED', offered, 's1'), true);
  assert.equal(canCreateEnrollmentOverride('EXCLUDED', offered, 's2'), false);
  assert.equal(canCreateEnrollmentOverride('ENROLLED', offered, 's2'), true);
  assert.equal(canCreateEnrollmentOverride('ENROLLED', offered, 's1'), false);
});

test('canRemoveEnrollmentOverride only when overridden', () => {
  assert.equal(canRemoveEnrollmentOverride('DEFAULT'), false);
  assert.equal(canRemoveEnrollmentOverride('ENROLLED'), true);
  assert.equal(canRemoveEnrollmentOverride('EXCLUDED'), true);
});