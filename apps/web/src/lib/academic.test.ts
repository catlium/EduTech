import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MembershipListItem, Role } from '@catlium/contracts';

import {
  canWriteAcademicStructure,
  classDeleteWarning,
  divisionDeleteWarning,
  bySortOrder,
  filterDivisions,
  type AcademicYear,
  type ClassRow,
  type DivisionRow,
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