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
