import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';
import { subjects } from './academic.js';
import { materials } from './materials.js';
import { users } from './users.js';

// A paper pattern is a reusable, tenant-scoped exam blueprint. The `structure`
// jsonb holds the PaperPatternStructure contract; it stays null until the
// teacher provides one (MANUAL source) or an AI analysis completes (TEXT /
// MATERIAL / PREVIOUS_YEAR_PAPER source). Status lifecycle is app-controlled
// (DRAFT → REVIEW → APPROVED); APPROVED patterns are immutable through the API
// and are the only ones that can drive generation or assessment creation.
export const paperPatterns = pgTable('paper_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  instituteId: uuid('institute_id')
    .notNull()
    .references(() => institutes.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: varchar('description', { length: 1000 }),
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  sourceType: varchar('source_type', { length: 30 }).notNull().default('MANUAL'),
  sourceMaterialId: uuid('source_material_id').references(() => materials.id, {
    onDelete: 'set null',
  }),
  structure: jsonb('structure'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});