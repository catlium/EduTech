import { check, index, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { users } from './users.js';

// D2/§14 + D3/§15 — permission, role, and grant storage.
//
//   permissions         — the catalogue mirror: one row per application
//                         permission key (`resource.action`). Seeded from the
//                         code catalogue; unknown rows are never deleted.
//   roles               — built-in (system, global) + future institute-owned
//                         (custom) roles. Structural constraints below make a
//                         platform-domain role always system/global, and any
//                         institute-owned role always institute-domain — so a
//                         custom role can structurally NEVER hold platform
//                         permissions.
//   role_permissions    — role → permission grants (domain-matched).
//   membership_roles    — unchanged (role string ↔ `roles.key`); the
//                         role_id backfill is Phase C.
//   platform_user_roles — the sole route to platform authority (§15);
//                         only `domain='platform'` role rows may be linked
//                         (app-layer guard + `roles` constraints).
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull().unique(),
    domain: varchar('domain', { length: 20 }).notNull(),
    resource: varchar('resource', { length: 50 }).notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('permissions_resource_action_unique').on(table.resource, table.action)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    // 'system'    — built-in global role (one shared row for every institute;
    //               institute_id NULL; editable via seed/migration only).
    // 'institute' — institute-owned custom role (institute_id required).
    kind: varchar('kind', { length: 20 }).notNull(),
    // 'institute' | 'platform' — the authorization plane the role grants live in.
    domain: varchar('domain', { length: 20 }).notNull(),
    instituteId: uuid('institute_id').references(() => institutes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Built-in roles are global singletons: `key` unique among system rows.
    uniqueIndex('roles_system_key_unique').on(table.key).where(sql`kind = 'system'`),
    // Custom roles are institute-scoped: key unique within their institute.
    uniqueIndex('roles_institute_key_unique').on(table.instituteId, table.key).where(sql`kind = 'institute'`),
    check('roles_kind_check', sql`${table.kind} IN ('system', 'institute')`),
    check('roles_domain_check', sql`${table.domain} IN ('institute', 'platform')`),
    // Institute-owned roles are always institute-domain (structural bar to
    // custom roles ever carrying platform permissions).
    check('roles_institute_kind_domain_check', sql`NOT (${table.kind} = 'institute' AND ${table.domain} <> 'institute')`),
    // Platform-domain roles are always system/global (never institute rows).
    check('roles_platform_kind_check', sql`NOT (${table.domain} = 'platform' AND ${table.kind} <> 'system')`),
    // Institute-owned roles must name their institute.
    check('roles_institute_owner_check', sql`NOT (${table.kind} = 'institute' AND ${table.instituteId} IS NULL)`),
    // System/global roles must not be institute-owned.
    check('roles_system_owner_check', sql`NOT (${table.kind} = 'system' AND ${table.instituteId} IS NOT NULL)`),
    index('roles_key_idx').on(table.key),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('role_permissions_permission_idx').on(table.permissionId),
  ],
);

export const platformUserRoles = pgTable(
  'platform_user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('platform_user_roles_role_idx').on(table.roleId),
  ],
);

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
export type PlatformUserRole = typeof platformUserRoles.$inferSelect;
export type NewPlatformUserRole = typeof platformUserRoles.$inferInsert;