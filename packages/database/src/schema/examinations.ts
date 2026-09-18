import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { users } from './users.js';
import { questions } from './questions.js';
import { paperPatterns } from './paper-patterns.js';
import { subjects, chapters, topics } from './academic.js';

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    // Authoritative question scope (never derived from the pattern). Subject is
    // always set for new assessments; Chapter/Topic are optional refinements.
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes'),
    maxMarks: integer('max_marks'),
    instructions: jsonb('instructions'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
    // Provenance: when an assessment was created from an approved paper pattern,
    // the pattern id is recorded here (set null if the pattern is ever removed).
    blueprintId: uuid('blueprint_id').references(() => paperPatterns.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Scope chain matches questions: subject-only, subject+chapter, or the full
    // chain; a topic may never appear without its chapter, nor a chapter
    // without its subject.
    check(
      'assessments_scope_chain',
      sql`(
        (${table.topicId} IS NOT NULL AND ${table.chapterId} IS NOT NULL AND ${table.subjectId} IS NOT NULL)
        OR (${table.topicId} IS NULL AND ${table.chapterId} IS NOT NULL AND ${table.subjectId} IS NOT NULL)
        OR (${table.topicId} IS NULL AND ${table.chapterId} IS NULL)
      )`,
    ),
  ],
);

export const assessmentQuestions = pgTable(
  'assessment_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    marks: integer('marks').notNull().default(1),
    // Paper-pattern section this question belongs to ('General' when the
    // assessment has no blueprint or the question was added without a section).
    section: varchar('section', { length: 100 }).notNull().default('General'),
  },
  (table) => [unique('assessment_questions_unique').on(table.assessmentId, table.questionId)],
);
