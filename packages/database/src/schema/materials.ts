import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  jsonb,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { subjects, chapters, topics } from './academic.js';
import { users } from './users.js';

export const materials = pgTable(
  'materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: varchar('description', { length: 1000 }),
    materialType: varchar('material_type', { length: 30 }).notNull(),
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    fileName: varchar('file_name', { length: 255 }),
    mimeType: varchar('mime_type', { length: 120 }),
    fileSize: integer('file_size'),
    storageProvider: varchar('storage_provider', { length: 30 }).notNull().default('local'),
    storageKey: varchar('storage_key', { length: 1000 }),
    textContent: text('text_content'),
    processingStatus: varchar('processing_status', { length: 20 }).notNull().default('UPLOADED'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    metadata: jsonb('metadata'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Subject is required. Topic implies chapter, chapter implies subject.
    check(
      'materials_scope_chain',
      sql`(
        ${table.subjectId} IS NOT NULL
        AND (${table.topicId} IS NULL OR ${table.chapterId} IS NOT NULL)
      )`,
    ),
    check(
      'materials_source_consistency',
      sql`(
        CASE ${table.sourceType}
          WHEN 'UPLOAD' THEN ${table.fileName} IS NOT NULL AND ${table.storageKey} IS NOT NULL
          WHEN 'TEXT' THEN ${table.textContent} IS NOT NULL
          ELSE true
        END
      )`,
    ),
  ],
);
