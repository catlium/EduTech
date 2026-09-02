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
    questionType: varchar('question_type', { length: 30 }).notNull(),
    difficulty: varchar('difficulty', { length: 20 }).notNull().default('MEDIUM'),
    explanation: text('explanation'),
    payload: jsonb('payload').notNull(),
    source: varchar('source', { length: 20 }).notNull().default('MANUAL'),
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
    check(
      'questions_exactly_one_scope',
      sql`((${table.subjectId} IS NOT NULL)::int + (${table.chapterId} IS NOT NULL)::int + (${table.topicId} IS NOT NULL)::int) = 1`,
    ),
  ],
);