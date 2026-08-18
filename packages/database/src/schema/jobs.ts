import { pgTable, uuid, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  instituteId: uuid('institute_id')
    .notNull()
    .references(() => institutes.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  payload: jsonb('payload'),
  result: jsonb('result'),
  error: jsonb('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
