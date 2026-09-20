import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { membershipRoles, roles, rolePermissions, permissions, platformUserRoles } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { hasPermission, resolveGrantedKeys, type PermissionKey } from './permission-catalogue.js';

/**
 * The centralized grant-check primitive (Phase B / D1): does a membership
 * hold a permission? Resolution is always against current DB role/permission
 * state — permissions are never read from JWTs or frontend input.
 * Phase C: the membership → membership_roles → roles join goes through the
 * `role_id` FK, and the platform plane (SUPER_ADMIN groundwork) resolves via
 * the same role/grant tables.
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
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(membershipRoles.membershipId, membershipId));

    return rows.map((r) => r.key);
  }

  /**
   * Platform-plane keys for a user granted via platform_user_roles (D3 §15,
   * SUPER_ADMIN groundwork). Same tables as the institute plane — this is not
   * a second resolution system, just the platform analog.
   */
  async platformGrantKeysForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(platformUserRoles)
      .innerJoin(roles, eq(roles.id, platformUserRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(platformUserRoles.userId, userId));

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

  /** Platform-plane check: DB-fresh, default-deny, platform-domain keys only. */
  async canOnPlatform(userId: string, permission: PermissionKey): Promise<boolean> {
    const granted = resolveGrantedKeys(await this.platformGrantKeysForUser(userId), 'platform');
    return hasPermission(granted, permission);
  }
}