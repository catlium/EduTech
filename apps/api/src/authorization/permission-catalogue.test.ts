import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILT_IN_ROLE_DEFINITIONS,
  BUILT_IN_ROLE_PERMISSIONS,
  INSTITUTE_ADMIN,
  STUDENT,
  SUPER_ADMIN,
  TEACHER,
  INSTITUTE_RESOURCES,
  PLATFORM_RESOURCES,
  PERMISSION_CATALOGUE,
  isSupportedPermission,
  hasPermission,
  isMembershipRoleEligible,
  missingPermissionKeys,
  membershipRoleUsableIn,
  permissionDomain,
  resolveGrantedKeys,
  type PermissionKey,
  type RoleState,
} from './permission-catalogue.ts';

// ── Catalogue invariants (deterministic, no duplication) ─────────

test('catalogue keys are unique, well-formed resource.action, with declared metadata', () => {
  const seen = new Set<string>();
  for (const p of PERMISSION_CATALOGUE) {
    assert.match(p.key, /^[a-z][a-z0-9-]*\.(read|create|update|delete|manage)$/, p.key);
    assert.equal(p.action, p.key.split('.')[1]!, p.key);
    assert.ok(['institute', 'platform'].includes(p.domain), p.key);
    assert.equal(seen.has(p.key), false, `duplicate key ${p.key}`);
    assert.ok(p.name.length > 0 && p.description.length > 0, p.key);
    seen.add(p.key);
  }
});

test('every resource.action in the resource maps is catalogued', () => {
  for (const [resource, def] of Object.entries(INSTITUTE_RESOURCES)) {
    for (const action of def.actions) {
      assert.ok(isSupportedPermission(`${resource}.${action}`), `${resource}.${action}`);
    }
  }
  for (const [resource, def] of Object.entries(PLATFORM_RESOURCES)) {
    for (const action of def.actions) {
      assert.ok(isSupportedPermission(`${resource}.${action}`), `${resource}.${action}`);
    }
  }
});

test('catalogue resources are exactly the §13 V1 vocabulary', () => {
  assert.deepEqual(Object.keys(INSTITUTE_RESOURCES).sort(), [
    'assessments',
    'attempts',
    'chapters',
    'content',
    'exports',
    'jobs',
    'materials',
    'paper-patterns',
    'practice',
    'question-papers',
    'question-types',
    'questions',
    'subjects',
    'syllabus',
    'topics',
    'users',
  ]);
  assert.deepEqual(Object.keys(PLATFORM_RESOURCES).sort(), ['institutes', 'ocr-workers']);
  // No speculative keys for features whose endpoints do not exist yet.
  assert.equal(isSupportedPermission('students.read'), false);
  assert.equal(isSupportedPermission('teachers.create'), false);
  assert.equal(isSupportedPermission('classes.manage'), false);
});

// ── Known / unknown permissions ─────────────────────────────────

test('known permission resolves', () => {
  assert.equal(isSupportedPermission('questions.update'), true);
  assert.equal(permissionDomain('questions.update'), 'institute');
  assert.equal(permissionDomain('ocr-workers.update'), 'platform');
});

test('unknown permission is denied', () => {
  assert.equal(isSupportedPermission('hax.magic'), false);
  assert.equal(permissionDomain('hax.magic'), null);
  // Cast: hasPermission is typed over the supported key union; this branch
  // proves the runtime default-deny for unsupported keys.
  assert.equal(hasPermission(['hax.magic' as PermissionKey], 'hax.magic' as PermissionKey), false);
  assert.equal(resolveGrantedKeys(['hax.magic'], 'institute').size, 0);
});

// ── Grant decisions (default-deny, manage implication) ─────────

test('role → permission grant resolves', () => {
  assert.equal(hasPermission(['questions.read'], 'questions.read'), true);
});

test('membership → role → permission resolution works (built-in TEACHER mapping)', () => {
  const teacher = BUILT_IN_ROLE_PERMISSIONS[TEACHER];
  const granted = resolveGrantedKeys(teacher, 'institute');
  assert.equal(hasPermission(granted, 'questions.create'), true);
  assert.equal(hasPermission(granted, 'users.read'), true);
  assert.equal(hasPermission(granted, 'users.create'), false);
  const student = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[STUDENT], 'institute');
  assert.equal(hasPermission(student, 'questions.read'), false);
  assert.equal(hasPermission(student, 'attempts.create'), true);
});

test('no roles → denied (default-deny)', () => {
  assert.equal(hasPermission([], 'questions.read'), false);
  assert.equal(hasPermission([], 'subjects.manage'), false);
  assert.equal(resolveGrantedKeys([], 'institute').size, 0);
});

test('grant of a sub-action does not imply manage', () => {
  assert.equal(hasPermission(['questions.update'], 'questions.manage'), false);
});

test('manage implies every action of its resource (§13 rule)', () => {
  assert.equal(hasPermission(['questions.manage'], 'questions.read'), true);
  assert.equal(hasPermission(['questions.manage'], 'questions.create'), true);
  assert.equal(hasPermission(['questions.manage'], 'questions.update'), true);
  assert.equal(hasPermission(['questions.manage'], 'questions.delete'), true);
  assert.equal(hasPermission(['questions.manage'], 'questions.manage'), true);
  // ... but only for that resource.
  assert.equal(hasPermission(['questions.manage'], 'materials.read'), false);
  // resources without a delete action are unaffected
  assert.equal(hasPermission(['attempts.manage'], 'attempts.update'), true);
  assert.equal(hasPermission(['practice.manage'], 'practice.read'), true);
});

test('default-deny: absence of a grant means denied', () => {
  assert.equal(hasPermission(['questions.read'], 'questions.update'), false);
  assert.equal(hasPermission(['subjects.create'], 'subjects.delete'), false);
});

// ── Dropped on the floor: DB rows outside the catalogue / plane ─

test('permission row exists in DB but is not in the supported catalogue → not valid', () => {
  const granted = resolveGrantedKeys(['questions.read', 'questions.typo'], 'institute');
  assert.equal(hasPermission(granted, 'questions.typo' as PermissionKey), false);
  assert.deepEqual([...granted].sort(), ['questions.read']);
});

test('platform permission cannot be granted through institute membership roles', () => {
  // Institute-plane resolution strips platform-domain keys entirely — even if
  // a (buggy) DB row granted them via membership roles.
  const granted = resolveGrantedKeys(['ocr-workers.update', 'subjects.read'], 'institute');
  assert.deepEqual([...granted], ['subjects.read']);
  assert.equal(hasPermission(granted, 'ocr-workers.update'), false);
  // Built-in institute role mappings never contain platform keys.
  for (const def of BUILT_IN_ROLE_DEFINITIONS) {
    if (def.domain !== 'institute') continue;
    for (const key of def.permissionKeys) {
      assert.equal(permissionDomain(key), 'institute', key);
    }
  }
  // SUPER_ADMIN is the only platform grantee.
  const superAdmin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[SUPER_ADMIN], 'platform');
  assert.equal(hasPermission(superAdmin, 'ocr-workers.manage'), true);
  assert.equal(hasPermission(superAdmin, 'institutes.create'), true);
  const admin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], 'institute');
  assert.equal(hasPermission(admin, 'institutes.create'), false);
  assert.equal(hasPermission(admin, 'ocr-workers.read'), false);
});

// ── Built-in role mapping sanity ────────────────────────────────

test('INSTITUTE_ADMIN holds manage for every institute resource', () => {
  const admin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], 'institute');
  for (const resource of Object.keys(INSTITUTE_RESOURCES)) {
    assert.equal(hasPermission(admin, `${resource}.manage` as PermissionKey), true, resource);
  }
});

test('every built-in role permission key is a supported catalogue key', () => {
  for (const def of BUILT_IN_ROLE_DEFINITIONS) {
    for (const key of def.permissionKeys) {
      assert.equal(isSupportedPermission(key), true, `${def.key}: ${key}`);
    }
  }
});

// ── Sync determinism / idempotency ──────────────────────────────

test('missingPermissionKeys drives an idempotent sync', () => {
  const allKeys = PERMISSION_CATALOGUE.map((p) => p.key);
  assert.deepEqual([...missingPermissionKeys(new Set())].sort(), [...allKeys].sort());
  // After inserting every missing key, nothing is missing anymore.
  assert.deepEqual(missingPermissionKeys(new Set(allKeys)), []);
  // Partial existing set: only the truly missing keys come back, deterministically.
  const half = new Set(allKeys.slice(0, Math.floor(allKeys.length / 2)));
  const missing = missingPermissionKeys(half);
  assert.equal(missing.length, allKeys.length - half.size);
  assert.equal(missing.some((k) => half.has(k)), false);
  // Run a full sync twice and confirm the second pass halts (idempotency).
  const first = [...missingPermissionKeys(new Set())];
  const afterFirst = new Set([...half, ...first]);
  assert.deepEqual(missingPermissionKeys(afterFirst), []);
});

// ── Phase C — the role model (D2/§14): built-ins, SUPER_ADMIN boundary,
//    custom-role institute-locality, assignment rules ─────────────

const INST_A = '00000000-0000-0000-0000-00000000000a';
const INST_B = '00000000-0000-0000-0000-00000000000b';

function systemRole(key: string): RoleState {
  const def = BUILT_IN_ROLE_DEFINITIONS.find((r) => r.key === key);
  assert.ok(def, `built-in ${key} defined`);
  return { key: def!.key, kind: def!.kind, domain: def!.domain, instituteId: null };
}

test('Phase C: built-in institute roles exist and are system + institute domain', () => {
  for (const key of [INSTITUTE_ADMIN, TEACHER, STUDENT]) {
    const role = systemRole(key);
    assert.equal(role.kind, 'system', key);
    assert.equal(role.domain, 'institute', key);
    assert.equal(isMembershipRoleEligible(role), true, key);
  }
  // No invented built-ins beyond the sanctioned four.
  assert.deepEqual(
    BUILT_IN_ROLE_DEFINITIONS.map((r) => r.key).sort(),
    [INSTITUTE_ADMIN, STUDENT, SUPER_ADMIN, TEACHER].sort(),
  );
});

test('Phase C: SUPER_ADMIN is platform-only and can never be a membership role', () => {
  const superAdmin = systemRole(SUPER_ADMIN);
  assert.equal(superAdmin.kind, 'system');
  assert.equal(superAdmin.domain, 'platform');
  assert.equal(isMembershipRoleEligible(superAdmin), false);
  assert.equal(membershipRoleUsableIn(superAdmin, INST_A), false);
  assert.equal(membershipRoleUsableIn(superAdmin, null), false);
});

test('Phase C: built-in institute roles are usable in every institute', () => {
  for (const key of [INSTITUTE_ADMIN, TEACHER, STUDENT]) {
    const role = systemRole(key);
    assert.equal(membershipRoleUsableIn(role, INST_A), true, key);
    assert.equal(membershipRoleUsableIn(role, INST_B), true, key);
  }
});

test('Phase C: custom roles are institute-local — cross-institute assignment is denied', () => {
  const customA: RoleState = { key: 'exam-coordinator', kind: 'institute', domain: 'institute', instituteId: INST_A };
  assert.equal(isMembershipRoleEligible(customA), true);
  assert.equal(membershipRoleUsableIn(customA, INST_A), true);
  assert.equal(membershipRoleUsableIn(customA, INST_B), false); // cross-institute denied
  assert.equal(membershipRoleUsableIn(customA, null), false); // never a platform-plane role
});

test('Phase C: custom institute roles can never resolve platform permissions', () => {
  // A custom role is structurally institute-domain, so even a (buggy) grant
  // row pointing at a platform key is stripped on the institute plane.
  const customA: RoleState = { key: 'syllabus-clerk', kind: 'institute', domain: 'institute', instituteId: INST_A };
  assert.equal(membershipRoleUsableIn(customA, INST_A), true);
  const granted = resolveGrantedKeys(['questions.manage', 'ocr-workers.update'], 'institute');
  assert.deepEqual([...granted], ['questions.manage']);
  assert.equal(hasPermission(granted, 'ocr-workers.create'), false);
});

test('Phase C: custom role permission keys resolve through the same grant path', () => {
  const custom = ['questions.read', 'questions.update'];
  const granted = resolveGrantedKeys(custom, 'institute');
  assert.equal(hasPermission(granted, 'questions.update'), true);
  assert.equal(hasPermission(granted, 'questions.read'), true);
  // Default-deny for the exact keys the role never received.
  assert.equal(hasPermission(granted, 'questions.delete'), false);
  assert.equal(hasPermission(granted, 'questions.manage'), false);
});

test('Phase C: removing a role removes its permissions (union of remaining roles)', () => {
  const admin = BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN];
  const teacher = BUILT_IN_ROLE_PERMISSIONS[TEACHER];
  const before = resolveGrantedKeys([...teacher, ...admin], 'institute');
  // users.create comes only from INSTITUTE_ADMIN.
  assert.equal(hasPermission(before, 'users.create'), true);
  const afterRemove = resolveGrantedKeys(teacher, 'institute');
  assert.equal(hasPermission(afterRemove, 'users.create'), false);
  assert.equal(hasPermission(afterRemove, 'questions.update'), true);
});