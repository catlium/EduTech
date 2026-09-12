import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { subjects, chapters, topics } from './academic.js';
import { users } from './users.js';

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    stem: text('stem').notNull(),
    questionType: varchar('question_type', { length: 64 }).notNull(),
    // The answer format the payload follows. Set from the question-type
    // definition (or worker output) at write time so grading and practice
    // rendering stay correct even if the type's definition changes later.
    answerFormat: varchar('answer_format', { length: 50 }),
    difficulty: varchar('difficulty', { length: 20 }).notNull().default('MEDIUM'),
    explanation: text('explanation'),
    payload: jsonb('payload').notNull(),
    source: varchar('source', { length: 20 }).notNull().default('MANUAL'),
    // AI-generation provenance: operation, jobId, provider, model, generatedAt,
    // source reference (filled by the worker for AI_GENERATED questions).
    provenance: jsonb('provenance'),
    approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('PENDING'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Question may be subject-only, subject+chapter, or full chain; a topic may
    // never appear without its chapter, nor a chapter without its subject.
    check(
      'questions_scope_chain',
      sql`(
        (${table.topicId} IS NOT NULL AND ${table.chapterId} IS NOT NULL AND ${table.subjectId} IS NOT NULL)
        OR (${table.topicId} IS NULL AND ${table.chapterId} IS NOT NULL AND ${table.subjectId} IS NOT NULL)
        OR (${table.topicId} IS NULL AND ${table.chapterId} IS NULL)
      )`,
    ),
  ],
);