import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { inArray } from 'drizzle-orm';

import { permissions, roles, rolePermissions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import {
  BUILT_IN_ROLE_DEFINITIONS,
  PERMISSION_CATALOGUE,
  missingPermissionKeys,
  permissionDomain,
} from './permission-catalogue.js';

export interface PermissionSyncResult {
  insertedPermissions: number;
  insertedRoles: number;
  insertedRolePermissions: number;
  unknownPermissions: number;
}

/**
 * Keeps the `permissions`/`roles`/`role_permissions` tables synchronized with
 * the authoritative code catalogue (D1/§13, D2/§14), deterministically:
 *   - missing catalogue permissions are inserted (dup-key safe);
 *   - existing matching rows are preserved;
 *   - unknown/stale DB rows are COUNTED but never deleted — they stay visible
 *     so a stray key can be investigated, but the grant layer (`resolveGrantedKeys`)
 *     never treats an uncatalogued key as a valid application permission;
 *   - built-in role → permission grants are inserted from the centralized
 *     mapping, filtered to the role's own domain (D2 assignment guard + D3
 *     boundary).
 * Repeated execution is safe and idempotent.
 */
@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // Runs on every API boot so deployed images never serve a stale catalogue.
  async onApplicationBootstrap(): Promise<void> {
    const result = await this.sync();
    this.logger.log(
      `permission sync: +${result.insertedPermissions} permissions, +${result.insertedRoles} roles, ` +
        `+${result.insertedRolePermissions} role-permission grants ` +
        `(preserving ${result.unknownPermissions} unknown DB permissions)`,
    );
  }

  async sync(): Promise<PermissionSyncResult> {
    const result: PermissionSyncResult = {
      insertedPermissions: 0,
      insertedRoles: 0,
      insertedRolePermissions: 0,
      unknownPermissions: 0,
    };

    const existingPermissionKeys = new Set(
      (await this.db.select({ key: permissions.key }).from(permissions)).map((r) => r.key),
    );

    const missing = missingPermissionKeys(existingPermissionKeys);
    if (missing.length > 0) {
      const rows = PERMISSION_CATALOGUE.filter((p) => missing.includes(p.key)).map((p) => ({
        key: p.key,
        domain: p.domain,
        resource: p.resource,
        action: p.action,
        description: p.description,
      }));
      const inserted = await this.db.insert(permissions).values(rows).onConflictDoNothing().returning({ id: permissions.id });
      result.insertedPermissions = inserted.length;
    }

    result.unknownPermissions = existingPermissionKeys.size - [...existingPermissionKeys].filter((k) =>
      PERMISSION_CATALOGUE.some((p) => p.key === k),
    ).length;

    const roleKeys = BUILT_IN_ROLE_DEFINITIONS.map((r) => r.key);
    const existingRoles = await this.db.select().from(roles).where(inArray(roles.key, roleKeys));
    const existingRoleKeys = new Set(existingRoles.map((r) => r.key));

    const missingRoles = BUILT_IN_ROLE_DEFINITIONS.filter((r) => !existingRoleKeys.has(r.key));
    if (missingRoles.length > 0) {
      const rows = missingRoles.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        kind: r.kind,
        domain: r.domain,
      }));
      const inserted = await this.db.insert(roles).values(rows).onConflictDoNothing().returning({ id: roles.id });
      result.insertedRoles = inserted.length;
    }

    const permissionRows = await this.db.select({ id: permissions.id, key: permissions.key }).from(permissions);
    const permissionIdByKey = new Map(permissionRows.map((p) => [p.key, p.id]));
    const roleRows = await this.db.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, roleKeys));
    const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

    const grants: { roleId: string; permissionId: string }[] = [];
    for (const def of BUILT_IN_ROLE_DEFINITIONS) {
      const roleId = roleIdByKey.get(def.key);
      if (!roleId) continue;
      // D2 assignment guard: a role only ever receives permissions on its own
      // domain (structurally required; enforced again here for the seeds).
      for (const key of def.permissionKeys) {
        if (permissionDomain(key) !== def.domain) continue;
        const permissionId = permissionIdByKey.get(key);
        if (permissionId) grants.push({ roleId, permissionId });
      }
    }

    if (grants.length > 0) {
      const inserted = await this.db.insert(rolePermissions).values(grants).onConflictDoNothing().returning({ roleId: rolePermissions.roleId });
      result.insertedRolePermissions = inserted.length;
    }

    return result;
  }
}