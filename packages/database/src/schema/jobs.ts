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
    // operation on the same source within an institute. The payload stores the
    // operation as a flat key and the source as a nested object
    // `source: { type, id }`, so the expression must reach into it via
    // `-> 'source' ->> 'key'`. The unique constraint only covers active jobs,
    // so a finished generation can be re-requested later. The API maps the
    // unique violation to a 409 Conflict.
    uniqueIndex('jobs_active_generation_unique')
      .on(
        table.instituteId,
        sql`((payload -> 'operation'))`,
        sql`((payload -> 'source' ->> 'type'))`,
        sql`((payload -> 'source' ->> 'id'))`,
      )
      .where(
        sql`type IN ('AI_GENERATE_NOTE', 'AI_GENERATE_SUMMARY', 'AI_GENERATE_FLASHCARDS', 'AI_GENERATE_CONCEPTS', 'AI_GENERATE_SYLLABUS', 'AI_GENERATE_QUESTIONS') AND status IN ('queued', 'processing')`,
      ),
  ],
);
