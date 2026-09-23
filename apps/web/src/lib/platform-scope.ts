// Platform console shared types + pure helpers (Phase N.5). The response
// shapes mirror the platform API's service interfaces (institute-lifecycle
// §11) — the backend stays the shape and authorization authority; these
// helpers are UX-only.

export interface PlatformPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

export interface PlatformPermissionProbe {
  permissions: string[];
}

export interface InstituteSummary {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'deactivated';
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstituteDetail extends InstituteSummary {
  memberCount: number;
  subscription: { planCode: string; planName: string } | null;
}

export interface InstituteAdmin {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'deactivated';
  createdAt: string;
}

export interface PlatformAuditEventView {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  instituteId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { userId: string; email: string; name: string } | null;
}

export interface PlatformAuditEventPage {
  events: PlatformAuditEventView[];
  total: number;
  limit: number;
  offset: number;
}

export type InstituteStatusFilter = 'all' | 'active' | 'deactivated';

/** Client-side status + name/slug search over a loaded institute list. The API
 *  supports the status filter (GET /platform/institutes?status=) and the list
 *  is small, so search stays local — never a new endpoint. */
export function filterInstitutes(
  institutes: InstituteSummary[],
  status: InstituteStatusFilter,
  query: string,
): InstituteSummary[] {
  const q = query.trim().toLowerCase();
  return institutes.filter((institute) => {
    if (status !== 'all' && institute.status !== status) return false;
    if (q && !institute.name.toLowerCase().includes(q) && !institute.slug.toLowerCase().includes(q))
      return false;
    return true;
  });
}

// ── Platform users (Phase P.2-FE, platform-user-lifecycle §12/§13) ──────────

export interface PlatformUserRoleView {
  id: string;
  key: string;
}

export interface PlatformUserSummary {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'deactivated';
  roles: string[];
  /** Roles with their ids — the revoke surface (DELETE .../roles/:roleId) needs
   *  the UUID the P.2 read responses now carry. */
  platformRoles: PlatformUserRoleView[];
  createdAt: string;
}

export type PlatformUserStatusFilter = 'all' | 'active' | 'deactivated';

/** The only platform role today (platform-user-lifecycle §2.1/§4.1). */
export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

/** Client-side name/email search over a loaded platform-user list. Status
 *  filtering is the API's surface (GET /platform/users?status=); the list is
 *  small, so search stays local. */
export function filterPlatformUsers(
  users: PlatformUserSummary[],
  status: PlatformUserStatusFilter,
  query: string,
): PlatformUserSummary[] {
  const q = query.trim().toLowerCase();
  return users.filter((user) => {
    if (status !== 'all' && user.status !== status) return false;
    if (q && !user.name.toLowerCase().includes(q) && !user.email.toLowerCase().includes(q))
      return false;
    return true;
  });
}

/** The per-row lifecycle actions a platform console renders. UX-only —
 *  `canMutate` comes from the DB-fresh `can('platform-users.update')` probe and
 *  the backend re-checks every call. Self/last-SUPER_ADMIN denials are NOT
 *  duplicated here; they surface from the backend 4xx as §13 prescribes. */
export type PlatformUserAction = 'grant-super-admin' | 'revoke-super-admin' | 'suspend' | 'reactivate';

export function platformUserActions(
  canMutate: boolean,
  user: Pick<PlatformUserSummary, 'status' | 'platformRoles'>,
  subjectRole: string = SUPER_ADMIN_ROLE,
): PlatformUserAction[] {
  if (!canMutate) return [];
  const holdsSubjectRole = user.platformRoles.some((r) => r.key === subjectRole);
  return [
    holdsSubjectRole ? 'revoke-super-admin' : 'grant-super-admin',
    user.status === 'active' ? 'suspend' : 'reactivate',
  ];
}

/** Plan selector default: the configured default (starter), else the first
 *  catalog plan, else null (no plans assignable). */
export function defaultPlanCode(plans: PlatformPlan[], fallback = 'starter'): string | null {
  if (plans.some((plan) => plan.code === fallback)) return fallback;
  return plans[0]?.code ?? null;
}

export function planName(plans: PlatformPlan[], code: string | null | undefined): string {
  if (!code) return 'No plan';
  return plans.find((plan) => plan.code === code)?.name ?? code;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'institute.create': 'Institute created',
  'institute.update': 'Institute updated',
  'institute.deactivate': 'Institute deactivated',
  'institute.reactivate': 'Institute reactivated',
  'institute.primary_admin.attach': 'Primary admin attached',
  'institute.plan.change': 'Plan changed',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** Human detail line per documented action metadata (platform-audit-trail §5).
 *  Unknown/future actions fall back to a compact JSON dump only until the
 *  console learns them — uuids/internal ids are never surfaced. */
export function auditEventSummary(event: PlatformAuditEventView): string {
  const m = event.metadata;
  switch (event.action) {
    case 'institute.create':
      return m.planCode ? `on the ${String(m.planCode)} plan` : '';
    case 'institute.primary_admin.attach':
      return m.email ? `for ${String(m.email)}` : '';
    case 'institute.plan.change':
      return `from ${String(m.fromPlanCode ?? '—')} to ${String(m.toPlanCode ?? '—')}`;
    default:
      return Object.keys(m).length > 0 ? JSON.stringify(m) : '';
  }
}
