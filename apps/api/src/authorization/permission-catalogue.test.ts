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
  isBuiltinRoleKey,
  isSupportedPermission,
  hasPermission,
  invalidInstitutePermissionKeys,
  isMembershipRoleEligible,
  isPlatformRole,
  isPlatformRoleGrantableToUser,
  missingPermissionKeys,
  membershipRoleUsableIn,
  permissionDomain,
  resolveGrantedKeys,
  roleVisibleToInstitute,
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

test('catalogue resources are exactly the §13 V1 vocabulary (+ Phase C roles, Phase Q.3 assignments, F5.1 academic-structure)', () => {
  assert.deepEqual(Object.keys(INSTITUTE_RESOURCES).sort(), [
    'academic-structure',
    'assessments',
    'assignments',
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
    'roles',
    'subjects',
    'syllabus',
    'topics',
    'users',
  ]);
  assert.deepEqual(Object.keys(PLATFORM_RESOURCES).sort(), ['institutes', 'ocr-workers', 'plans', 'platform-users']);
  // No speculative keys for features whose endpoints do not exist yet.
  assert.equal(isSupportedPermission('students.read'), false);
  assert.equal(isSupportedPermission('teachers.create'), false);
  assert.equal(isSupportedPermission('classes.manage'), false);
});

test('Q.3: assignments.* is the staffing vocabulary — read/create/delete/manage, deliberately no update', () => {
  // The four sanctioned actions (Q.3.0 design D-Q3.1/D-Q3.3): reassignment =
  // delete + create, so `assignments.update` is an unsupported, uncatalogued key.
  for (const key of ['assignments.read', 'assignments.create', 'assignments.delete', 'assignments.manage'] as const) {
    assert.equal(isSupportedPermission(key), true, key);
    assert.equal(permissionDomain(key), 'institute', key);
  }
  assert.equal(isSupportedPermission('assignments.update'), false);
  assert.equal(permissionDomain('assignments.update'), null);
  assert.deepEqual(invalidInstitutePermissionKeys(['assignments.update']), ['assignments.update']);
  // manage implies read/create/delete (§13 rule), and only for its resource.
  assert.equal(hasPermission(['assignments.manage'], 'assignments.read'), true);
  assert.equal(hasPermission(['assignments.manage'], 'assignments.create'), true);
  assert.equal(hasPermission(['assignments.manage'], 'assignments.delete'), true);
  assert.equal(hasPermission(['assignments.manage'], 'subjects.read'), false);
  // A bare sub-action never implies manage or its siblings.
  assert.equal(hasPermission(['assignments.create'], 'assignments.manage'), false);
  assert.equal(hasPermission(['assignments.create'], 'assignments.delete'), false);
  // INSTITUTE_ADMIN auto-holds assignments.manage via the built-in mapping.
  const admin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], 'institute');
  assert.equal(hasPermission(admin, 'assignments.manage'), true);
  assert.equal(hasPermission(admin, 'assignments.read'), true);
  // TEACHER/STUDENT default-deny: staffing config never reaches class users.
  for (const key of [TEACHER, STUDENT] as const) {
    const granted = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[key], 'institute');
    assert.equal(hasPermission(granted, 'assignments.read'), false, `${key}.assignments.read`);
    assert.equal(hasPermission(granted, 'assignments.create'), false, key);
    assert.equal(hasPermission(granted, 'assignments.delete'), false, key);
  }
  // A custom role the institute grants assignments.create resolves exactly it.
  const delegate = resolveGrantedKeys(['assignments.create'], 'institute');
  assert.equal(hasPermission(delegate, 'assignments.create'), true);
  assert.equal(hasPermission(delegate, 'assignments.read'), false);
  assert.equal(hasPermission(delegate, 'assignments.delete'), false);
});

test('Q.4: AND-combinator premise — every() over create+delete means both are required', () => {
  // The guard's RequiredPermissions(...) group passes only when EVERY key
  // grants (permissions.guard: requiredAll.every). This is the pure-layer
  // building block for the collapsed placement endpoints (transfer /
  // carry-forward commit) that both archive (delete) and create.
  const both = resolveGrantedKeys(['assignments.create', 'assignments.delete'], 'institute');
  assert.equal(hasPermission(both, 'assignments.create'), true);
  assert.equal(hasPermission(both, 'assignments.delete'), true);
  // A create-only grant cannot satisfy the delete leg (and vice versa).
  assert.equal(hasPermission(resolveGrantedKeys(['assignments.create'], 'institute'), 'assignments.delete'), false);
  assert.equal(hasPermission(resolveGrantedKeys(['assignments.delete'], 'institute'), 'assignments.create'), false);
  // manage implies both legs, so a manage grantee passes the AND group untouched.
  const manage = resolveGrantedKeys(['assignments.manage'], 'institute');
  assert.equal(hasPermission(manage, 'assignments.create'), true);
  assert.equal(hasPermission(manage, 'assignments.delete'), true);
});

// ── F5.1 — `academic-structure` catalogue expansion ──────────────
// D4 structural layer (academic years, classes, class↔subject offerings,
// divisions) catalogued as one resource with the full CRUD+manage action set.
// F5.1 is catalogue-only: no controller/guard migration (that is F5.2).

const ACADEMIC_STRUCTURE_ACTIONS = ['read', 'create', 'update', 'delete', 'manage'] as const;

test('F5.1: all five academic-structure.* keys exist and are institute-domain', () => {
  assert.deepEqual(
    [...INSTITUTE_RESOURCES['academic-structure'].actions],
    ['read', 'create', 'update', 'delete', 'manage'],
  );
  for (const action of ACADEMIC_STRUCTURE_ACTIONS) {
    const key = `academic-structure.${action}`;
    assert.equal(isSupportedPermission(key), true, key);
    assert.equal(permissionDomain(key), 'institute', key);
    // Declared with the standard metadata the DB `permissions` row mirrors.
    const def = PERMISSION_CATALOGUE.find((p) => p.key === key);
    assert.ok(def, key);
    assert.equal(def.resource, 'academic-structure', key);
    assert.equal(def.action, action, key);
    assert.equal(def.domain, 'institute', key);
    assert.ok(def.name.length > 0 && def.description.length > 0, key);
  }
});

test('F5.1: academic-structure manage semantics follow the §13 implication rule', () => {
  // manage implies every other action of its own resource, and only that resource.
  for (const action of ACADEMIC_STRUCTURE_ACTIONS) {
    if (action === 'manage') continue;
    assert.equal(
      hasPermission(['academic-structure.manage'], `academic-structure.${action}`),
      true,
      action,
    );
  }
  // A bare sub-action never implies manage or a sibling action.
  for (const action of ['read', 'create', 'update', 'delete'] as const) {
    const granted = [`academic-structure.${action}`];
    assert.equal(hasPermission(granted, 'academic-structure.manage'), false, action);
    for (const other of ['read', 'create', 'update', 'delete'] as const) {
      if (other === action) continue;
      assert.equal(
        hasPermission(granted, `academic-structure.${other}`),
        false,
        `${action} -> ${other}`,
      );
    }
  }
  // Implication is resource-scoped: the structural layer grants no staffing,
  // user-management or platform authority.
  assert.equal(hasPermission(['academic-structure.manage'], 'assignments.read'), false);
  assert.equal(hasPermission(['academic-structure.manage'], 'users.create'), false);
  assert.equal(hasPermission(['academic-structure.manage'], 'subjects.read'), false);
  assert.equal(
    hasPermission(['academic-structure.manage'], 'institutes.read' as PermissionKey),
    false,
  );
});

test('F5.1: built-in role defaults — INSTITUTE_ADMIN manage, TEACHER/STUDENT none', () => {
  const admin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], 'institute');
  assert.equal(hasPermission(admin, 'academic-structure.manage'), true);
  for (const action of ACADEMIC_STRUCTURE_ACTIONS) {
    if (action === 'manage') continue;
    assert.equal(hasPermission(admin, `academic-structure.${action}`), true, action);
  }
  // Staffing configuration stays admin-only and is NOT reached through the
  // structural manage key.
  assert.equal(hasPermission(admin, 'assignments.manage'), true); // own resource, own key
  assert.equal(
    hasPermission(
      resolveGrantedKeys(['academic-structure.manage'], 'institute'),
      'assignments.manage',
    ),
    false,
  );

  // Default-deny: class users never hold structural administration by default.
  for (const key of [TEACHER, STUDENT] as const) {
    const granted = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[key], 'institute');
    for (const action of ACADEMIC_STRUCTURE_ACTIONS) {
      assert.equal(
        hasPermission(granted, `academic-structure.${action}`),
        false,
        `${key}.${action}`,
      );
    }
    // The mapping itself carries no academic-structure key at all.
    for (const perm of BUILT_IN_ROLE_PERMISSIONS[key]) {
      assert.equal(perm.startsWith('academic-structure.'), false, `${key}: ${perm}`);
    }
  }
});

test('F5.1: no platform permission is introduced — the resource is institute-only', () => {
  // SUPER_ADMIN (platform plane) must not resolve any academic-structure key.
  const superAdmin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[SUPER_ADMIN], 'platform');
  for (const action of ACADEMIC_STRUCTURE_ACTIONS) {
    assert.equal(hasPermission(superAdmin, `academic-structure.${action}`), false, action);
  }
  assert.equal(
    resolveGrantedKeys([...BUILT_IN_ROLE_PERMISSIONS[SUPER_ADMIN]], 'institute').size,
    0,
  );
  // The key is a valid institute grant and an invalid platform one.
  assert.deepEqual(invalidInstitutePermissionKeys(['academic-structure.manage']), []);
  assert.deepEqual(
    invalidInstitutePermissionKeys(['academic-structure.read', 'ocr-workers.read']),
    ['ocr-workers.read'],
  );
});

test('F5.1: a custom institute role can be granted academic-structure via the existing mechanism', () => {
  // The role-permission assignment surface accepts the new keys unchanged —
  // no bespoke path: same invalidInstitutePermissionKeys check as any resource.
  const curator: RoleState = {
    key: 'structure-curator',
    kind: 'institute',
    domain: 'institute',
    instituteId: INST_A,
  };
  assert.equal(isMembershipRoleEligible(curator), true);
  assert.equal(roleVisibleToInstitute(curator, INST_A), true);
  assert.equal(isBuiltinRoleKey('structure-curator'), false);
  assert.deepEqual(
    invalidInstitutePermissionKeys([
      'academic-structure.read',
      'academic-structure.create',
      'academic-structure.update',
      'academic-structure.delete',
    ]),
    [],
  );

  // A read+update custom grant resolves exactly those two (manage implication,
  // default-deny) — the same resolution path a seeded role row takes.
  const readUpdate = resolveGrantedKeys(
    ['academic-structure.read', 'academic-structure.update'],
    'institute',
  );
  assert.equal(hasPermission(readUpdate, 'academic-structure.read'), true);
  assert.equal(hasPermission(readUpdate, 'academic-structure.update'), true);
  assert.equal(hasPermission(readUpdate, 'academic-structure.create'), false);
  assert.equal(hasPermission(readUpdate, 'academic-structure.delete'), false);
  assert.equal(hasPermission(readUpdate, 'academic-structure.manage'), false);

  // A delegate granted manage passes every structural action and nothing else.
  const delegate = resolveGrantedKeys(['academic-structure.manage'], 'institute');
  for (const action of ACADEMIC_STRUCTURE_ACTIONS) {
    assert.equal(hasPermission(delegate, `academic-structure.${action}`), true, action);
  }
  assert.equal(hasPermission(delegate, 'subjects.read'), false);
  assert.equal(hasPermission(delegate, 'users.update'), false);

  // Dropping the role's own grant narrows back to exactly what the admin holds.
  const withAdmin = resolveGrantedKeys(
    [
      'academic-structure.read',
      'academic-structure.update',
      ...BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN],
    ],
    'institute',
  );
  assert.equal(hasPermission(withAdmin, 'academic-structure.create'), true); // from admin.manage
  assert.equal(hasPermission(withAdmin, 'academic-structure.read'), true);
  const afterRoleRemoved = resolveGrantedKeys(
    BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN],
    'institute',
  );
  assert.equal(hasPermission(afterRoleRemoved, 'academic-structure.manage'), true);
  // Default-deny: a membership with no structural role at all holds nothing.
  assert.equal(
    hasPermission(resolveGrantedKeys([], 'institute'), 'academic-structure.read'),
    false,
  );
});

test('F5.1: the new keys are picked up by the deterministic PermissionSync insert set', () => {
  const allKeys = PERMISSION_CATALOGUE.map((p) => p.key);
  for (const action of ACADEMIC_STRUCTURE_ACTIONS) {
    assert.ok(allKeys.includes(`academic-structure.${action}`), action);
  }
  // A live DB that predates F5.1 has none of them → all five are "missing" and
  // get inserted; once present, the second pass is empty (idempotent).
  const preF51 = missingPermissionKeys(
    new Set(allKeys.filter((k) => !k.startsWith('academic-structure.'))),
  );
  assert.deepEqual(preF51.filter((k) => k.startsWith('academic-structure.')).sort(), [
    'academic-structure.create',
    'academic-structure.delete',
    'academic-structure.manage',
    'academic-structure.read',
    'academic-structure.update',
  ]);
  const afterFirst = new Set([...allKeys]);
  assert.deepEqual(missingPermissionKeys(afterFirst), []);
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

// ── Phase C — custom role + role-permission management guards (D2/§14) ────

test('Phase C: roles.* role-management keys are catalogued institute-domain', () => {
  for (const action of ['read', 'create', 'update', 'delete', 'manage'] as const) {
    const key = `roles.${action}`;
    assert.equal(isSupportedPermission(key), true, key);
    assert.equal(permissionDomain(key), 'institute', key);
    // manage implies every action of the roles resource.
    assert.equal(hasPermission([`roles.${action}`], key as PermissionKey), true, key);
  }
});

test('Phase C: INSTITUTE_ADMIN holds roles.manage; TEACHER/STUDENT never role-management keys', () => {
  const admin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], 'institute');
  assert.equal(hasPermission(admin, 'roles.manage'), true);
  assert.equal(hasPermission(admin, 'roles.read'), true);
  for (const roleKey of [TEACHER, STUDENT] as const) {
    const granted = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[roleKey], 'institute');
    assert.equal(hasPermission(granted, 'roles.read'), false, roleKey);
    assert.equal(hasPermission(granted, 'roles.create'), false, roleKey);
    assert.equal(hasPermission(granted, 'roles.update'), false, roleKey);
    assert.equal(hasPermission(granted, 'roles.delete'), false, roleKey);
  }
});

test('Phase C: custom role without role-management permission is denied; with it, allowed', () => {
  // A custom role holding only questions.* can never manage roles.
  assert.equal(hasPermission(['questions.read'], 'roles.create'), false);
  assert.equal(hasPermission(['questions.read'], 'roles.read'), false);
  assert.equal(hasPermission(['roles.read'], 'roles.manage'), false);
  // A custom role the institute grants roles.update can manage others' roles
  // (subject to the self-edit guard enforced at the service layer).
  assert.equal(hasPermission(['roles.update'], 'roles.update'), true);
  assert.equal(hasPermission(['roles.manage'], 'roles.delete'), true);
});

test('Phase C: custom role keys never collide with built-in role names (case-insensitive)', () => {
  for (const builtin of [INSTITUTE_ADMIN, TEACHER, STUDENT, SUPER_ADMIN]) {
    assert.equal(isBuiltinRoleKey(builtin), true, builtin);
    assert.equal(isBuiltinRoleKey(builtin.toLowerCase()), true, builtin.toLowerCase());
  }
  assert.equal(isBuiltinRoleKey('super_admin'), true);
  assert.equal(isBuiltinRoleKey('exam-coordinator'), false);
  assert.equal(isBuiltinRoleKey('housemaster'), false);
});

test('Phase C: role permission management — only catalogue institute keys may be granted', () => {
  // Valid institute-domain grant keys pass clean.
  assert.deepEqual(invalidInstitutePermissionKeys(['questions.read', 'users.update']), []);
  // Platform keys, unknown keys, and duplicate-free leftovers are flagged.
  assert.deepEqual(
    invalidInstitutePermissionKeys(['questions.read', 'ocr-workers.update', 'hax.magic', 'institutes.create']),
    ['ocr-workers.update', 'hax.magic', 'institutes.create'],
  );
  // An uncatalogued DB row (stale key) is every bit as invalid as an unknown one.
  assert.deepEqual(invalidInstitutePermissionKeys(['questions.read', 'questions.typo']), ['questions.typo']);
  // Duplicates are not an error at this layer (they are deduped by the service).
  assert.deepEqual(invalidInstitutePermissionKeys(['questions.read', 'questions.read']), []);
});

test('Phase C: role visibility — SUPER_ADMIN never an institute role; system institute roles global; custom institute-local', () => {
  const superAdmin = systemRole(SUPER_ADMIN);
  assert.equal(roleVisibleToInstitute(superAdmin, INST_A), false);
  assert.equal(roleVisibleToInstitute(superAdmin, INST_B), false);
  for (const key of [INSTITUTE_ADMIN, TEACHER, STUDENT]) {
    assert.equal(roleVisibleToInstitute(systemRole(key), INST_A), true, key);
    assert.equal(roleVisibleToInstitute(systemRole(key), INST_B), true, key);
  }
  const customA: RoleState = { key: 'syllabus-clerk', kind: 'institute', domain: 'institute', instituteId: INST_A };
  assert.equal(roleVisibleToInstitute(customA, INST_A), true);
  assert.equal(roleVisibleToInstitute(customA, INST_B), false); // cross-institute invisible
  // Platform roles are never usable as membership roles anywhere.
  assert.equal(membershipRoleUsableIn(superAdmin, INST_A), false);
  assert.equal(membershipRoleUsableIn(superAdmin, null), false);
});

// ── Phase D — the platform plane (D3/§15): SUPER_ADMIN → platform
//    permissions → shared platform operations ────────────────────

function platformRole(key: string): RoleState {
  const def = BUILT_IN_ROLE_DEFINITIONS.find((r) => r.key === key);
  assert.ok(def, `built-in ${key} defined`);
  return { key: def!.key, kind: def!.kind, domain: def!.domain, instituteId: null };
}

function allPlatformKeys(): string[] {
  const out: string[] = [];
  for (const [resource, def] of Object.entries(PLATFORM_RESOURCES)) {
    for (const action of def.actions) out.push(`${resource}.${action}`);
  }
  return out;
}

test('Phase D: platform vocabulary — institutes.*, ocr-workers.*, plans.*, platform-users.* are platform-domain', () => {
  assert.deepEqual(
    Object.keys(PLATFORM_RESOURCES).sort(),
    ['institutes', 'ocr-workers', 'plans', 'platform-users'].sort(),
  );
  for (const key of allPlatformKeys()) {
    assert.equal(isSupportedPermission(key), true, key);
    assert.equal(permissionDomain(key), 'platform', key);
  }
  // A platform permission can never be satisfied by an institute grant set.
  assert.equal(
    hasPermission([...resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], 'platform')], 'ocr-workers.read'),
    false,
  );
});

test('Phase D: SUPER_ADMIN is a system platform role granted every platform key, and nothing institute-side', () => {
  const role = platformRole(SUPER_ADMIN);
  assert.equal(role.kind, 'system');
  assert.equal(role.domain, 'platform');
  assert.equal(role.instituteId, null);
  assert.equal(isPlatformRoleGrantableToUser(role), true);

  const platformGrants = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[SUPER_ADMIN], 'platform');
  for (const key of allPlatformKeys()) {
    assert.equal(hasPermission(platformGrants, key as PermissionKey), true, key);
  }
  // SUPER_ADMIN's platform grants never satisfy an institute permission.
  assert.equal(
    hasPermission([...resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[SUPER_ADMIN], 'institute')], 'users.manage'),
    false,
  );
});

test('Phase D: institute roles — built-in or custom — can never hold platform permissions', () => {
  // Built-in institute roles resolve to zero platform grants.
  for (const key of [INSTITUTE_ADMIN, TEACHER, STUDENT] as const) {
    const platformGrants = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[key], 'platform');
    assert.equal(platformGrants.size, 0, key);
    assert.equal(hasPermission([...platformGrants], 'ocr-workers.read'), false, key);
    assert.equal(hasPermission([...platformGrants], 'institutes.read'), false, key);
  }
  // Custom institute roles are refused platform/unknown keys at the assignment
  // surface (a custom role may only ever hold institute-domain catalogue keys).
  const customWithPlatform: RoleState = { key: 'fleet-manager', kind: 'institute', domain: 'institute', instituteId: INST_A };
  assert.equal(isMembershipRoleEligible(customWithPlatform), true);
  assert.equal(isPlatformRoleGrantableToUser(customWithPlatform), false);
  assert.deepEqual(invalidInstitutePermissionKeys(['ocr-workers.manage', 'institutes.read']), [
    'ocr-workers.manage',
    'institutes.read',
  ]);
  // Granting a platform key into an institute custom role can never surface on
  // the institute plane: the assignment surface rejects them and institute
  // resolution strips any that slip through.
  assert.deepEqual(resolveGrantedKeys(['ocr-workers.read', 'institutes.manage'], 'institute'), new Set());
});

test('Phase D: SUPER_ADMIN cannot be assigned as a membership role or become an institute role', () => {
  const superAdmin = platformRole(SUPER_ADMIN);
  assert.equal(isMembershipRoleEligible(superAdmin), false); // never a membership_roles row
  assert.equal(membershipRoleUsableIn(superAdmin, INST_A), false);
  assert.equal(roleVisibleToInstitute(superAdmin, INST_A), false); // invisible to institute role APIs
  assert.equal(isBuiltinRoleKey('SUPER_ADMIN'), true); // custom roles cannot use the name
  assert.equal(isBuiltinRoleKey('super_admin'), true);
  assert.equal(isPlatformRoleGrantableToUser(systemRole(INSTITUTE_ADMIN)), false); // institute role is not grantable on the platform plane
  assert.equal(isPlatformRole(superAdmin), true);
});

test('Phase D: platform plane is independent of institute memberships', () => {
  // A user holding every institute key still has zero platform authority.
  const instituteAdmin = resolveGrantedKeys(BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], 'institute');
  for (const key of ['ocr-workers.read', 'ocr-workers.create', 'ocr-workers.update', 'ocr-workers.manage'] as const) {
    assert.equal(hasPermission(instituteAdmin, key), false, key);
  }
  // And the platform plane never consults institute grants: an institute admin
  // who is ALSO a platform super admin resolves exactly the platform keys.
  const both = resolveGrantedKeys(
    [...BUILT_IN_ROLE_PERMISSIONS[INSTITUTE_ADMIN], ...BUILT_IN_ROLE_PERMISSIONS[SUPER_ADMIN]],
    'platform',
  );
  assert.equal(hasPermission(both, 'ocr-workers.read'), true);
  assert.equal(hasPermission(both, 'institutes.manage'), true);
});