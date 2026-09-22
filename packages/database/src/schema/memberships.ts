import { pgTable, uuid, varchar, timestamp, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { roles } from './authorization.js';
import { institutes } from './institutes.js';
import { users } from './users.js';

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('memberships_user_institute_unique').on(table.userId, table.instituteId),
    check('memberships_status_check', sql`${table.status} IN ('active', 'deactivated')`),
  ],
);

// D2/§14 — membership → role binding. `role_id` references a `roles` row
// (built-in system roles or institute-local custom roles). Platform roles
// (SUPER_ADMIN) never appear here by construction + the app-layer assignment
// guard. Backfilled from the legacy `role` string column by migration 0040.
export const membershipRoles = pgTable(
  'membership_roles',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [unique('membership_roles_membership_role_unique').on(table.membershipId, table.roleId)],
);
