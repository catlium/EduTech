// Phase B — the central permission catalogue (D1/§13) and the pure grant
// decision layer. This file is the authoritative application permission
// vocabulary: guards/decorators reference keys from it, the `permissions`
// DB table mirrors it, and the built-in role → permission mapping lives here
// deterministically.
//
// Keys are explicit `resource.action` (no wildcards), default-deny, no DENY
// rows, and `manage` is an explicit key that implies every other action of
// its resource. Platform-domain permissions (D3) are disjoint from the
// institute vocabulary and can never be granted through institute
// membership — `resolveGrantedKeys` strips them on the institute plane.

export const PERMISSION_ACTIONS = ['read', 'create', 'update', 'delete', 'manage'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_DOMAINS = ['institute', 'platform'] as const;
export type PermissionDomain = (typeof PERMISSION_DOMAINS)[number];

interface ResourceDefinition {
  actions: readonly PermissionAction[];
}

type ResourceMap = Record<string, ResourceDefinition>;

// Institute-domain resources (§13 catalogue). No speculative keys: nothing is
// catalogued before an endpoint exists (no students/teachers/classes yet;
// their administration maps to `users.*`).
export const INSTITUTE_RESOURCES = {
  subjects: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  chapters: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  topics: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  content: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  materials: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  syllabus: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  questions: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  'question-types': { actions: ['read', 'manage'] },
  'paper-patterns': { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  'question-papers': { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  assessments: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  attempts: { actions: ['read', 'create', 'update', 'manage'] },
  practice: { actions: ['read', 'create', 'update', 'manage'] },
  exports: { actions: ['read', 'manage'] },
  jobs: { actions: ['read', 'update', 'manage'] },
  users: { actions: ['read', 'create', 'update', 'manage'] },
} as const satisfies ResourceMap;

// Platform-domain resources (§13). Only reachable via the platform plane
// (D3): never through institute membership roles.
export const PLATFORM_RESOURCES = {
  institutes: { actions: ['read', 'create', 'update', 'delete', 'manage'] },
  'ocr-workers': { actions: ['read', 'create', 'update', 'manage'] },
} as const satisfies ResourceMap;

type ResourceKeys<T extends ResourceMap> = {
  [R in keyof T]: `${R & string}.${T[R]['actions'][number]}`;
}[keyof T];

/** Compile-time union of every supported permission key. */
export type PermissionKey = ResourceKeys<typeof INSTITUTE_RESOURCES> | ResourceKeys<typeof PLATFORM_RESOURCES>;

export interface PermissionDefinition {
  key: string;
  resource: string;
  action: PermissionAction;
  domain: PermissionDomain;
  name: string;
  description: string;
}

const ACTION_LABELS: Record<PermissionAction, string> = {
  read: 'View',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  manage: 'Manage',
};

// Deterministic order: resource declaration order × action order.
export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = [
  ...buildCatalogue(INSTITUTE_RESOURCES, 'institute'),
  ...buildCatalogue(PLATFORM_RESOURCES, 'platform'),
];

function buildCatalogue(resources: ResourceMap, domain: PermissionDomain): PermissionDefinition[] {
  const out: PermissionDefinition[] = [];
  for (const [resource, def] of Object.entries(resources)) {
    for (const action of def.actions) {
      out.push({
        key: `${resource}.${action}`,
        resource,
        action,
        domain,
        name: `${ACTION_LABELS[action]} ${resource}`,
        description: `${ACTION_LABELS[action]} the ${resource} resource ${
          domain === 'platform' ? 'in the CatLium platform' : 'within an institute'
        }.`,
      });
    }
  }
  return out;
}

const DOMAIN_BY_KEY = new Map<string, PermissionDomain>(
  PERMISSION_CATALOGUE.map((p) => [p.key, p.domain]),
);

/** True only for keys the application catalogue actually supports. */
export function isSupportedPermission(key: string): boolean {
  return DOMAIN_BY_KEY.has(key);
}

/** The plane a permission key belongs to; null for unsupported keys. */
export function permissionDomain(key: string): PermissionDomain | null {
  return DOMAIN_BY_KEY.get(key) ?? null;
}

/** Catalogue keys missing from an existing set (used for deterministic sync). */
export function missingPermissionKeys(existing: ReadonlySet<string>): string[] {
  return PERMISSION_CATALOGUE.filter((p) => !existing.has(p.key)).map((p) => p.key);
}

/**
 * Filter raw granted keys to the supported, domain-matching set. A permission
 * row that exists in the DB but is not in this catalogue — or lives on the
 * other plane — is never treated as a valid application permission.
 */
export function resolveGrantedKeys(keys: Iterable<string>, domain: PermissionDomain): Set<string> {
  const granted = new Set<string>();
  for (const key of keys) {
    if (permissionDomain(key) === domain) granted.add(key);
  }
  return granted;
}

/**
 * True when `required` is granted, or the resource's `manage` is granted
 * (implication rule). Default-deny: unknown required keys, or absent grants,
 * are false. No DENY rows exist — absence of a grant means denied.
 */
export function hasPermission(granted: Iterable<string>, required: PermissionKey): boolean {
  if (!isSupportedPermission(required)) return false;
  const grant = new Set(granted);
  if (grant.has(required)) return true;
  const dot = required.lastIndexOf('.');
  if (dot === -1 || required.slice(dot + 1) === 'manage') return false;
  return grant.has(`${required.slice(0, dot)}.manage`);
}

// ── Built-in roles (D2/§14: immutable seeded system rows). The mapping below
// is the §13 reference mapping, centralized + deterministic. Phase C finalizes
// custom roles; built-ins are never editable via institute APIs.

export const INSTITUTE_ADMIN = 'INSTITUTE_ADMIN';
export const TEACHER = 'TEACHER';
export const STUDENT = 'STUDENT';
export const SUPER_ADMIN = 'SUPER_ADMIN';
export const BUILT_IN_ROLE_KEYS = [INSTITUTE_ADMIN, TEACHER, STUDENT, SUPER_ADMIN] as const;
export type BuiltinRoleKey = (typeof BUILT_IN_ROLE_KEYS)[number];

export interface BuiltinRoleDefinition {
  key: string;
  name: string;
  description: string;
  kind: 'system';
  domain: PermissionDomain;
  permissionKeys: readonly string[];
}

const READ_WRITE_DELETE: readonly PermissionAction[] = ['read', 'create', 'update', 'delete'];
const READ: readonly PermissionAction[] = ['read'];

function keysFor(resources: ResourceMap, actions: readonly PermissionAction[]): string[] {
  const out: string[] = [];
  for (const [resource, def] of Object.entries(resources)) {
    for (const action of def.actions) {
      if ((actions as readonly string[]).includes(action)) out.push(`${resource}.${action}`);
    }
  }
  return out;
}

function allKeys(resources: ResourceMap): string[] {
  return Object.entries(resources).flatMap(([resource, def]) =>
    def.actions.map((action) => `${resource}.${action}`),
  );
}

export const BUILT_IN_ROLE_DEFINITIONS: readonly BuiltinRoleDefinition[] = [
  {
    key: INSTITUTE_ADMIN,
    name: 'Institute Admin',
    description: 'Institute-wide administration. Holds the manage key for every institute resource.',
    kind: 'system',
    domain: 'institute',
    permissionKeys: Object.keys(INSTITUTE_RESOURCES).map((resource) => `${resource}.manage`),
  },
  {
    key: TEACHER,
    name: 'Teacher',
    description: 'Teaching staff. Full read/create/update/delete over academic structure and content.',
    kind: 'system',
    domain: 'institute',
    permissionKeys: [
      ...keysFor(
        {
          subjects: INSTITUTE_RESOURCES['subjects'],
          chapters: INSTITUTE_RESOURCES['chapters'],
          topics: INSTITUTE_RESOURCES['topics'],
          content: INSTITUTE_RESOURCES['content'],
          materials: INSTITUTE_RESOURCES['materials'],
          syllabus: INSTITUTE_RESOURCES['syllabus'],
          questions: INSTITUTE_RESOURCES['questions'],
          'paper-patterns': INSTITUTE_RESOURCES['paper-patterns'],
          'question-papers': INSTITUTE_RESOURCES['question-papers'],
          assessments: INSTITUTE_RESOURCES['assessments'],
        } as ResourceMap,
        READ_WRITE_DELETE,
      ),
      'question-types.read',
      'attempts.read',
      'practice.read',
      'exports.read',
      'jobs.read',
      'jobs.update',
      'users.read',
    ],
  },
  {
    key: STUDENT,
    name: 'Student',
    description: 'Learning surface. Reads academic structure and content; self-scoped attempts and practice.',
    kind: 'system',
    domain: 'institute',
    permissionKeys: [
      ...keysFor(
        {
          subjects: INSTITUTE_RESOURCES['subjects'],
          chapters: INSTITUTE_RESOURCES['chapters'],
          topics: INSTITUTE_RESOURCES['topics'],
          content: INSTITUTE_RESOURCES['content'],
          materials: INSTITUTE_RESOURCES['materials'],
          syllabus: INSTITUTE_RESOURCES['syllabus'],
          assessments: INSTITUTE_RESOURCES['assessments'],
          'question-types': INSTITUTE_RESOURCES['question-types'],
        } as ResourceMap,
        READ,
      ),
      'attempts.read',
      'attempts.create',
      'attempts.update',
      'practice.read',
      'practice.create',
      'practice.update',
    ],
  },
  {
    key: SUPER_ADMIN,
    name: 'Super Admin',
    description: 'CatLium platform authority (D3). All platform-domain permissions; not an institute role.',
    kind: 'system',
    domain: 'platform',
    permissionKeys: allKeys(PLATFORM_RESOURCES),
  },
];

/** Built-in role → permission keys (also enforced domain-matched at sync). */
export const BUILT_IN_ROLE_PERMISSIONS: Readonly<Record<BuiltinRoleKey, readonly string[]>> =
  Object.fromEntries(BUILT_IN_ROLE_DEFINITIONS.map((r) => [r.key, r.permissionKeys])) as Readonly<
    Record<BuiltinRoleKey, readonly string[]>
  >;

// ── Phase C — the role model (D2/§14), pure decisions ────────────
// Every membership-role assignment rule that must not be re-implemented
// ad-hoc: SUPER_ADMIN (platform) is never a membership role; custom
// (institute-kind) roles are institute-local; built-in (system) institute
// roles are global singletons usable in every institute. The schema's CHECK
// constraints already make platform roles structurally system/global and
// custom roles structurally institute-domain; the app-layer assignment guard
// below is the second line (and tests exercise it directly).

export type RoleKind = 'system' | 'institute';

export interface RoleState {
  readonly key: string;
  readonly kind: RoleKind;
  readonly domain: PermissionDomain;
  readonly instituteId: string | null;
}

/** A role that may ever be granted through an institute membership. */
export function isMembershipRoleEligible(role: RoleState): boolean {
  if (role.domain === 'platform') return false; // SUPER_ADMIN never a membership role
  if (role.kind === 'system') return true; // built-in institute roles are global
  return role.instituteId !== null; // custom roles must be owned by an institute
}

/**
 * True when `role` may be assigned to a membership of `instituteId`
 * (null instituteId only ever represents the platform plane, where no
 * membership roles apply). Same-institute for custom roles; built-in
 * institute roles are usable everywhere.
 */
export function membershipRoleUsableIn(role: RoleState, instituteId: string | null): boolean {
  if (!isMembershipRoleEligible(role)) return false;
  if (role.kind === 'institute') return role.instituteId === instituteId;
  return true;
}