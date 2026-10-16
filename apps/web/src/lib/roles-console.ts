import type { InstituteUser } from '@catlium/contracts';

import type { RolesConsoleGrants } from './permissions.ts';
import { canAssignUserRoles } from './permissions.ts';

/** The subset of `GET /roles` this console needs. Mirrors the API's
 *  `InstituteRoleView`; only the display + identity fields are used here. */
export interface AssignableRole {
  id: string;
  key: string;
  name: string;
  kind: string;
}

/** A member may hold roles only while they are active — a deactivated member is
 *  not an assignable target, and the API would reject the write anyway. */
export function canAssignRolesToTarget(
  grants: RolesConsoleGrants,
  member: Pick<InstituteUser, 'id' | 'status'>,
  selfId: string | undefined,
): boolean {
  if (!canAssignUserRoles(grants)) return false;
  if (selfId !== undefined && member.id === selfId) return false;
  return member.status === 'active';
}

/** Prefer the institute's own role name; fall back to the raw key so a role the
 *  viewer cannot resolve still reads as something meaningful. */
export function roleLabel(roles: readonly AssignableRole[], key: string): string {
  return roles.find((r) => r.key === key)?.name ?? key;
}

/** Draft-only selection toggle: the saved set is never mutated while editing. */
export function toggleRoleSelection(current: readonly string[], roleId: string): string[] {
  return current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId];
}
