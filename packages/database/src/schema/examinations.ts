import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, unique } from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';
import { users } from './users.js';
import { questions } from './questions.js';

export const assessments = pgTable('assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  instituteId: uuid('institute_id')
    .notNull()
    .references(() => institutes.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes'),
  maxMarks: integer('max_marks'),
  instructions: jsonb('instructions'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  },
  (table) => [
    unique('assessment_questions_unique').on(table.assessmentId, table.questionId),
  ],
);