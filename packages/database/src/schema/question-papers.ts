import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  unique,
} from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';
import { users } from './users.js';
import { questions } from './questions.js';
import { paperPatterns } from './paper-patterns.js';
import { subjects } from './academic.js';

export const questionPapers = pgTable('question_papers', {
  id: uuid('id').primaryKey().defaultRandom(),
  instituteId: uuid('institute_id')
    .notNull()
    .references(() => institutes.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  blueprintId: uuid('blueprint_id').references(() => paperPatterns.id, {
    onDelete: 'set null',
  }),
  durationMinutes: integer('duration_minutes'),
  maxMarks: integer('max_marks'),
  instructions: jsonb('instructions'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const questionPaperQuestions = pgTable(
  'question_paper_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => questionPapers.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    marks: integer('marks').notNull().default(1),
    section: varchar('section', { length: 100 }).notNull().default('General'),
  },
  (table) => [unique('question_paper_questions_unique').on(table.paperId, table.questionId)],
);
