import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  text,
  integer,
  boolean,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { users } from './users.js';
import { subjects } from './academic.js';
import { jobs } from './jobs.js';

// The syllabus is the authoritative, first-class source of a subject's
// prescribed curriculum. A subject NEVER generates a syllabus: a teacher
// uploads/provides the syllabus document first, OCR extracts its text
// (processingStatus), a deep-analysis job extracts the Syllabus Context and the
// academic structure proposal (context + structure), and the teacher confirms
// it to create the real Subject → Chapter → Topic hierarchy (reconciliation-
// aware; historical chapters/topics keep their identity where the content is
// continuous).
//
// Rows are versioned per subject: every upload/create produces a new row with
// version = max(version for subject) + 1, so history is never silently lost.
//
// Processing state machine (source document extraction):
//   UPLOADED → QUEUED → PROCESSING → READY, or → FAILED
//   (TEXT sources are READY immediately; IMPORTED legacy rows need no OCR)
//
// Analysis state machine (deep syllabus analysis):
//   PENDING → PROCESSING → READY, or → FAILED
//
// Lifecycle status: PROPOSED → CONFIRMED (terminal per row). Confirming a
// newer version updates the authoritative hierarchy; older versions stay
// visible in history.
export const syllabi = pgTable(
  'syllabi',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    title: varchar('title', { length: 255 }).notNull(),
    program: varchar('program', { length: 255 }),
    academicYear: varchar('academic_year', { length: 20 }),
    sourceType: varchar('source_type', { length: 20 }).notNull().default('UPLOAD'),
    fileName: varchar('file_name', { length: 255 }),
    mimeType: varchar('mime_type', { length: 120 }),
    fileSize: integer('file_size'),
    storageProvider: varchar('storage_provider', { length: 30 }).notNull().default('local'),
    storageKey: varchar('storage_key', { length: 1000 }),
    textContent: text('text_content'),
    processingStatus: varchar('processing_status', { length: 20 }).notNull().default('UPLOADED'),
    processingJobId: uuid('processing_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    processingError: text('processing_error'),
    analysisStatus: varchar('analysis_status', { length: 20 }).notNull().default('PENDING'),
    analysisJobId: uuid('analysis_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    analysisError: text('analysis_error'),
    // Extracted Syllabus Context (objectives, outcomes, scope, units, ...). NULL
    // until deep analysis succeeds. Never invented — only extracted fields.
    context: jsonb('context'),
    // Extracted academic structure proposal: { chapters: [ { name, description,
    // topics: [{ name, description }] } ] }. The worker writes it; the API's
    // confirm flow creates/updates the academic hierarchy from it.
    structure: jsonb('structure'),
    status: varchar('status', { length: 20 }).notNull().default('PROPOSED'),
    isLocked: boolean('is_locked').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('syllabi_subject_version_unique').on(table.subjectId, table.version),
    // UPLOAD documents carry a stored file; TEXT syllabi carry their text
    // directly; IMPORTED (migrated) rows are informational history.
    check(
      'syllabi_source_consistency',
      sql`(
        CASE ${table.sourceType}
          WHEN 'UPLOAD' THEN ${table.fileName} IS NOT NULL AND ${table.storageKey} IS NOT NULL
          WHEN 'TEXT' THEN ${table.textContent} IS NOT NULL
          ELSE true
        END
      )`,
    ),
  ],
);

export type Syllabus = typeof syllabi.$inferSelect;
export type NewSyllabus = typeof syllabi.$inferInsert;
