import { pgTable, uuid, varchar, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const institutes = pgTable(
  'institutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // Stamped on deactivation; cleared on reactivation. Auth access to the
    // institute requires status='active' regardless of this column (lifecycle
    // foundation — the timestamp is for audit/history).
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('institutes_status_check', sql`${table.status} IN ('active', 'deactivated')`)],
);
