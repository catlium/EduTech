import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { users } from './users.js';

/** Question type definitions are DATA, not a compiled enum:
 * - NULL institute_id = a global predefined starter template.
 * - non-NULL institute_id = a custom type created by that institute.
 * The `code` is the stable key stored on questions / paper-pattern sections /
 * practice items, so renaming the display name never breaks references. */
export const questionTypes = pgTable(
  'question_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .references(() => institutes.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    instructions: text('instructions'),
    answerFormat: varchar('answer_format', { length: 50 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    defaultMarks: integer('default_marks'),
    allowedDifficulties: jsonb('allowed_difficulties')
      .$type<string[]>()
      .default(sql`'["EASY","MEDIUM","HARD"]'::jsonb`),
    evaluationConfig: jsonb('evaluation_config').$type<Record<string, unknown>>(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('question_types_global_code_idx')
      .on(table.code)
      .where(sql`${table.instituteId} IS NULL`),
    uniqueIndex('question_types_scoped_code_idx').on(table.code, table.instituteId),
  ],
);