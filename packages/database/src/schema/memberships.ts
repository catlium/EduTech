import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';

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
  (table) => [unique('memberships_user_institute_unique').on(table.userId, table.instituteId)],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull(),
  },
  (table) => [unique('membership_roles_membership_role_unique').on(table.membershipId, table.role)],
);
