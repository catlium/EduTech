import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from './permission-catalogue.js';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the permissions an endpoint requires. Multiple keys are OR'd
 * (any grant satisfies the check). `R.manage` implies every action of R via
 * the grant layer. Absence of ANY declared grant denies by default.
 */
export const RequiredPermission = (...permissions: readonly PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);