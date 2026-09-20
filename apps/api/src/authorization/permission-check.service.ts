import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { membershipRoles, roles, rolePermissions, permissions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { hasPermission, resolveGrantedKeys, type PermissionKey } from './permission-catalogue.js';

/**
 * The centralized grant-check primitive (Phase B / D1): does a membership
 * hold a permission? Resolution is always against current DB role/permission
 * state — permissions are never read from JWTs or frontend input.
 */
@Injectable()
export class PermissionCheckService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Raw permission keys granted to a membership via its roles
   * (membership → membership_roles → roles → role_permissions → permissions).
   * Unfiltered — the pure decision layer applies catalogue/domain rules.
   */
  async grantKeysForMembership(membershipId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.key, membershipRoles.role))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(membershipRoles.membershipId, membershipId));

    return rows.map((r) => r.key);
  }

  /** Institute-plane check: DB-fresh, default-deny, catalogue + domain filtered. */
  async can(membershipId: string, permission: PermissionKey): Promise<boolean> {
    const granted = resolveGrantedKeys(
      await this.grantKeysForMembership(membershipId),
      'institute',
    );
    return hasPermission(granted, permission);
  }
}