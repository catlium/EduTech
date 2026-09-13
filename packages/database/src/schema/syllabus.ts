import { pgTable, uuid, varchar, jsonb, timestamp, text, unique } from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';
import { users } from './users.js';
import { subjects } from './academic.js';
import { materials } from './materials.js';
import { jobs } from './jobs.js';

// AI-generated academic structure proposal for a subject.
//
// State machine: PROCESSING → PENDING_REVIEW → CONFIRMED, or PROCESSING → FAILED.
// - The API writes PROCESSING (+ generation_job_id) when the generation job is
//   created so a failed generation is always visible (never a stuck
//   "drafting" ghost). `structure` stays NULL until a successful draft exists.
// - The worker is the ONLY writer of `structure` and the PENDING_REVIEW /
//   FAILED status. AI must never create chapters/topics directly — that
//   happens in the API's confirm flow.
export const syllabusProposals = pgTable(
  'syllabus_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('PENDING_REVIEW'),
    structure: jsonb('structure'),
    generationJobId: uuid('generation_job_id').references(() => jobs.id, {
      onDelete: 'set null',
    }),
    generationError: text('generation_error'),
    sourceMaterialId: uuid('source_material_id').references(() => materials.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('syllabus_proposals_subject_unique').on(table.subjectId)],
);

export type SyllabusProposal = typeof syllabusProposals.$inferSelect;
export type NewSyllabusProposal = typeof syllabusProposals.$inferInsert;