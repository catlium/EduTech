// Frontend permission checks are UX-only: the backend stays the authority and
// the key vocabulary lives server-side. The resolved grant set arrives from
// `GET /memberships`; this module only mirrors the backend's `*.manage`
// implication rule so UI gating matches what the API decides. Never treat a
// frontend check as an enforcement boundary, and never attempt to extend a
// key here that the catalogue does not define.

export function canUse(granted: readonly string[], key: string): boolean {
  if (!/^[a-z][\w-]*\.(read|create|update|delete|manage)$/.test(key)) return false;
  if (granted.includes(key)) return true;
  const dot = key.lastIndexOf('.');
  if (dot === -1 || key.slice(dot + 1) === 'manage') return false;
  return granted.includes(`${key.slice(0, dot)}.manage`);
}

export function canUseAny(granted: readonly string[], keys: readonly string[]): boolean {
  return keys.some((key) => canUse(granted, key));
}

/** The two inputs a capability gate needs: the backend-resolved grant set and
 *  the actor's own institute roles. */
export interface RolesConsoleGrants {
  permissions: readonly string[];
  isInstituteAdmin: boolean;
}

/** `PUT /users/:userId/roles` is deliberately AND-gated: `users.update` AND the
 *  INSTITUTE_ADMIN role. Handing out a role hands out a whole permission bundle,
 *  so a custom role holding `users.update` must not be able to promote itself —
 *  the API refuses that, and the console must not offer the button. Mirrors
 *  `UsersController.setMembershipRoles`; never a substitute for it. */
export function canAssignUserRoles(grants: RolesConsoleGrants): boolean {
  return grants.isInstituteAdmin && canUse(grants.permissions, 'users.update');
}
