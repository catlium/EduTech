import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  jsonb,
  timestamp,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { subjects, chapters, topics } from './academic.js';
import { users } from './users.js';

export const contentItems = pgTable(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
    source: varchar('source', { length: 30 }).notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'content_items_exactly_one_scope',
      sql`((${table.subjectId} IS NOT NULL)::int + (${table.chapterId} IS NOT NULL)::int + (${table.topicId} IS NOT NULL)::int) = 1`,
    ),
  ],
);

export const contentVersions = pgTable(
  'content_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull(),
    renderedHtml: text('rendered_html'),
    aiContext: jsonb('ai_context'),
    sourceReference: jsonb('source_reference'),
    changeType: varchar('change_type', { length: 30 }).notNull(),
    changeReason: varchar('change_reason', { length: 500 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('content_versions_content_version_unique').on(table.contentId, table.version)],
);
