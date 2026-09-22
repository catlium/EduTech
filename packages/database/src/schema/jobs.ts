import { pgTable, uuid, varchar, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { users } from './users.js';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    // Verifiable job owner — stamped from the authenticated actor at issue
    // time (never from the request payload). NULL for system-generated jobs
    // (PROCESS_SYLLABUS, OCR/CORRECTION triggered enhancement) — precedent:
    // materialEnhancements.createdBy is nullable.
    createdBy: uuid('created_by').references(() => users.id),
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
        // Question-bank batches (Goal E) run one child job per (source, type,
        // difficulty) sharing a batchId. The dedupKey slot differentiates the
        // children so per-type jobs for one source coexist; absent (legacy)
        // it coalesces to '' and keeps the historic single-job dedupe.
        sql`(COALESCE((payload -> 'params' ->> 'dedupKey'), ''))`,
      )
      .where(
        sql`type IN ('AI_GENERATE_NOTE', 'AI_GENERATE_SUMMARY', 'AI_GENERATE_FLASHCARDS', 'AI_GENERATE_CONCEPTS', 'AI_GENERATE_CONTENT_PACKAGE', 'AI_GENERATE_QUESTIONS', 'AI_GENERATE_BLUEPRINT', 'AI_GENERATE_STARTER_MATERIAL', 'AI_ANALYZE_SYLLABUS') AND status IN ('queued', 'processing')`,
      ),
  ],
);
