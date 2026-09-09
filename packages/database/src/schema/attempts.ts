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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { users } from './users.js';
import { assessments } from './examinations.js';
import { questions } from './questions.js';

// Student examination attempt. The question set is SNAPSHOTTED into
// attempt_questions when the attempt starts (immutable thereafter) — later
// edits to the assessment's question links or the source questions never
// affect an in-flight attempt. The snapshot payload retains the teacher
// payload (correct answers) server-side for Phase 10 evaluation; student-facing
// responses are always sanitized by the API.
export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    status: varchar('status', { length: 20 }).notNull().default('IN_PROGRESS'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    deadline: timestamp('deadline', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    score: integer('score'),
    totalMarks: integer('total_marks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Exactly one IN_PROGRESS attempt per (assessment, student). The API
    // pre-checks for a friendly 409; this index makes concurrent `start`
    // requests atomic (the second one fails the unique violation, which the
    // service maps to a 409). Submitted/expired attempts do not block retakes.
    uniqueIndex('attempts_one_in_progress_unique')
      .on(table.assessmentId, table.studentId)
      .where(sql`status = 'IN_PROGRESS'`),
  ],
);

// Immutable per-question snapshot taken at attempt start. `payload` mirrors the
// source question's full payload (including answer fields) for later
// evaluation; `stem`/`questionType` are copied so the attempt survives edits
// to the source question. One row per (attempt, question).
export const attemptQuestions = pgTable(
  'attempt_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    sortOrder: integer('sort_order').notNull().default(0),
    marks: integer('marks').notNull().default(1),
    questionType: varchar('question_type', { length: 30 }).notNull(),
    stem: text('stem').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (table) => [unique('attempt_questions_unique').on(table.attemptId, table.questionId)],
);

// Student's saved answer for a snapshotted question. Evaluation fields
// (isCorrect / marksAwarded) are written by Phase 10. ON CONFLICT on the
// (attempt, attemptQuestion) unique key makes re-saving idempotent.
export const attemptResponses = pgTable(
  'attempt_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    attemptQuestionId: uuid('attempt_question_id')
      .notNull()
      .references(() => attemptQuestions.id, { onDelete: 'cascade' }),
    answer: jsonb('answer').notNull(),
    isCorrect: boolean('is_correct'),
    marksAwarded: integer('marks_awarded'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('attempt_responses_unique').on(table.attemptId, table.attemptQuestionId)],
);

export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
export type AttemptQuestion = typeof attemptQuestions.$inferSelect;
export type NewAttemptQuestion = typeof attemptQuestions.$inferInsert;
export type AttemptResponse = typeof attemptResponses.$inferSelect;
export type NewAttemptResponse = typeof attemptResponses.$inferInsert;