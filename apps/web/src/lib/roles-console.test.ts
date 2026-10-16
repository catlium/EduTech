import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canAssignUserRoles, type RolesConsoleGrants } from './permissions.ts';
import {
  canAssignRolesToTarget,
  roleLabel,
  toggleRoleSelection,
  type AssignableRole,
} from './roles-console.ts';

const admin: RolesConsoleGrants = { permissions: ['users.manage'], isInstituteAdmin: true };
const teacher: RolesConsoleGrants = { permissions: ['users.manage'], isInstituteAdmin: false };
const readOnlyAdmin: RolesConsoleGrants = { permissions: ['users.read'], isInstituteAdmin: true };
const granularAdmin: RolesConsoleGrants = { permissions: ['users.update'], isInstituteAdmin: true };

const active = { id: 'u-1', status: 'active' as const };
const inactive = { id: 'u-2', status: 'deactivated' as const };

const ROLES: AssignableRole[] = [
  { id: 'r-1', key: 'INSTITUTE_ADMIN', name: 'Institute Admin', kind: 'system' },
  { id: 'r-2', key: 'TEACHER', name: 'Teacher', kind: 'system' },
  { id: 'r-3', key: 'exam-coordinator', name: 'Exam Coordinator', kind: 'custom' },
];

// ── the AND gate ─────────────────────────────────────────────────────────────
test('canAssignUserRoles requires users.update AND the admin role', () => {
  assert.equal(canAssignUserRoles(admin), true, 'users.manage implies users.update');
  assert.equal(canAssignUserRoles(granularAdmin), true, 'the granular key satisfies the gate');
  assert.equal(canAssignUserRoles(teacher), false, 'users.update alone is not enough');
  assert.equal(canAssignUserRoles(readOnlyAdmin), false, 'the admin role alone is not enough');
  assert.equal(canAssignUserRoles({ permissions: [], isInstituteAdmin: false }), false);
});

// ── target eligibility ───────────────────────────────────────────────────────
test('canAssignRolesToTarget excludes the actor, deactivated members and weak grants', () => {
  assert.equal(canAssignRolesToTarget(admin, active, 'someone-else'), true);
  assert.equal(canAssignRolesToTarget(admin, active, active.id), false, 'self-edit is hidden');
  assert.equal(
    canAssignRolesToTarget(admin, active, undefined),
    true,
    'unknown self still allowed',
  );
  assert.equal(canAssignRolesToTarget(admin, inactive, 'someone-else'), false, 'inactive excluded');
  assert.equal(canAssignRolesToTarget(teacher, active, 'someone-else'), false, 'gate is checked');
  assert.equal(canAssignRolesToTarget(readOnlyAdmin, active, 'someone-else'), false);
});

// ── labels ───────────────────────────────────────────────────────────────────
test('roleLabel prefers the institute name and falls back to the raw key', () => {
  assert.equal(roleLabel(ROLES, 'TEACHER'), 'Teacher');
  assert.equal(roleLabel(ROLES, 'exam-coordinator'), 'Exam Coordinator');
  assert.equal(roleLabel(ROLES, 'SOMETHING_UNRESOLVED'), 'SOMETHING_UNRESOLVED');
  assert.equal(roleLabel([], 'TEACHER'), 'TEACHER', 'no role list means key fallback');
});

// ── draft selection ──────────────────────────────────────────────────────────
test('toggleRoleSelection adds and removes without mutating the input', () => {
  const draft = ['r-2'];
  const added = toggleRoleSelection(draft, 'r-3');
  assert.deepEqual(added, ['r-2', 'r-3']);
  assert.deepEqual(draft, ['r-2'], 'input untouched');

  const removed = toggleRoleSelection(added, 'r-2');
  assert.deepEqual(removed, ['r-3']);
  assert.deepEqual(added, ['r-2', 'r-3'], 'input untouched');
});
