import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  unique,
} from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';
import { users } from './users.js';
import { contentItems } from './content.js';
import { topics } from './academic.js';

// Ungraded student practice session — FAR from formal examination scoring
// (PRAC-03): a session never touches `attempts`, never records a scorable
// result, and is excluded from all examination analytics. FLASHCARD sessions
// snapshot a content FLASHCARD_SET; QUESTION sessions snapshot the approved
// ACTIVE question bank (optionally scoped to a topic). Source items are
// SNAPSHOTTED at session start, mirroring the attempts immutability rule.
export const practiceSessions = pgTable('practice_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  instituteId: uuid('institute_id')
    .notNull()
    .references(() => institutes.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  mode: varchar('mode', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('IN_PROGRESS'),
  // FLASHCARD -> contentId; QUESTION -> topicId (null = whole institute bank).
  contentId: uuid('content_id').references(() => contentItems.id),
  topicId: uuid('topic_id').references(() => topics.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Immutable per-item snapshot. `prompt`/`reveal` are copied so a session
// survives edits to the source content/question. For QUESTION items `payload`
// retains the answer fields server-side for grading feedback; student-facing
// serialization always sanitizes it (see practice.service.ts).
export const practiceSessionItems = pgTable(
  'practice_session_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    sourceKey: varchar('source_key', { length: 100 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    prompt: text('prompt').notNull(),
    reveal: text('reveal'),
    questionType: varchar('question_type', { length: 30 }),
    payload: jsonb('payload').notNull(),
  },
  (table) => [unique('practice_session_items_unique').on(table.sessionId, table.sourceKey)],
);

// Student's recorded action for one practice item. FLASHCARD -> rating
// (self-assessed, ungraded); QUESTION -> answer + isCorrect. One row per
// (session item) — re-answering upserts idempotently.
export const practiceSessionResponses = pgTable(
  'practice_session_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionItemId: uuid('session_item_id')
      .notNull()
      .references(() => practiceSessionItems.id, { onDelete: 'cascade' }),
    answer: jsonb('answer'),
    rating: varchar('rating', { length: 20 }),
    isCorrect: boolean('is_correct'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('practice_session_responses_unique').on(table.sessionItemId)],
);

export type PracticeSession = typeof practiceSessions.$inferSelect;
export type NewPracticeSession = typeof practiceSessions.$inferInsert;
export type PracticeSessionItem = typeof practiceSessionItems.$inferSelect;
export type NewPracticeSessionItem = typeof practiceSessionItems.$inferInsert;
export type PracticeSessionResponse = typeof practiceSessionResponses.$inferSelect;
export type NewPracticeSessionResponse = typeof practiceSessionResponses.$inferInsert;