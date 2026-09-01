import { pgTable, uuid, varchar, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';

export const jobs = pgTable(
  'jobs',
  {
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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // Prevents two active (queued/processing) AI generation jobs for the same
    // source within an institute. The payload stores the source as a nested
    // object `source: { type, id }`, so the expressions must reach into it via
    // `-> 'source' ->> 'key'` (a flat `->> 'sourceType'` would always be NULL and
    // collapse uniqueness to one active job per institute). The unique constraint
    // only covers active jobs, so a finished generation can be re-requested
    // later. The API maps the unique violation to a 409 Conflict.
    uniqueIndex('jobs_active_generation_unique')
      .on(
        table.instituteId,
        sql`((payload -> 'source' ->> 'type'))`,
        sql`((payload -> 'source' ->> 'id'))`,
      )
      .where(sql`type = 'AI_GENERATE_NOTE' AND status IN ('queued', 'processing')`),
  ],
);
