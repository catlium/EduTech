import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from './permission-catalogue.js';

export const PERMISSIONS_KEY = 'permissions';

/** AND-mode requirement group (see `RequiredPermissions`). */
export const PERMISSIONS_ALL_KEY = 'permissions-all';

/**
 * Declares the permission an endpoint requires. Multiple keys are OR'd
 * (any grant satisfies the check). `R.manage` implies every action of R via
 * the grant layer. Absence of ANY declared grant denies by default.
 */
export const RequiredPermission = (...permissions: readonly PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Declares permissions an endpoint requires as a group that must ALL be
 * granted (AND semantics — uses `every`, unlike `RequiredPermission`'s OR).
 * For collapsed combined endpoints (Q.4): transfer/carry-forward commit both
 * archive (delete) and create, so a caller must hold every key, not any.
 * `R.manage` still implies every action of R through the grant layer, so a
 * manage grantee satisfies the group untouched. Routes using only this
 * decorator skip the OR check entirely.
 */
export const RequiredPermissions = (...permissions: readonly PermissionKey[]) =>
  SetMetadata(PERMISSIONS_ALL_KEY, permissions);