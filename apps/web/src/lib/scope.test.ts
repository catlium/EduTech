import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scopedSubjectIds, groupOfferingsByClass, type ScopeDetail } from './scope.ts';

const base: ScopeDetail = {
  kind: 'subject-set',
  subjectIds: ['s-1', 's-2'],
  offerings: [],
  placement: {
    academicYearId: 'ay-1',
    academicYearName: '2026–27',
    classId: 'c-1',
    className: 'Class 10',
    divisionId: 'd-1',
    divisionName: 'A',
  },
};

test('subject-set scope restricts to its subject ids', () => {
  assert.deepEqual(scopedSubjectIds(base), ['s-1', 's-2']);
});

test('whole-institute scope disables client-side subject filtering', () => {
  const adminScope: ScopeDetail = { ...base, kind: 'whole-institute' };
  assert.equal(scopedSubjectIds(adminScope), null);
});

test('null/undecided scope also disables client filter', () => {
  assert.equal(scopedSubjectIds(null), null);
});

test('offerings group by class, preserving first-seen order', () => {
  const scope: ScopeDetail = {
    ...base,
    offerings: [
      { classId: 'c-2', className: 'Class 11', subjectId: 's-3', subjectName: 'Physics' },
      { classId: 'c-1', className: 'Class 10', subjectId: 's-1', subjectName: 'Maths' },
      { classId: 'c-2', className: 'Class 11', subjectId: 's-4', subjectName: 'Chemistry' },
      { classId: 'c-1', className: 'Class 10', subjectId: 's-2', subjectName: 'Science' },
    ],
  };
  assert.deepEqual(groupOfferingsByClass(scope.offerings), [
    { classId: 'c-2', className: 'Class 11', subjects: ['Physics', 'Chemistry'] },
    { classId: 'c-1', className: 'Class 10', subjects: ['Maths', 'Science'] },
  ]);
});

test('no offerings groups to an empty list', () => {
  assert.deepEqual(groupOfferingsByClass([]), []);
});