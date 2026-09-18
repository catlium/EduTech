import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { materials } from './materials.js';
import { users } from './users.js';

// Material Intelligence — Phase A (cleaning & enhancement)
//
// `material_enhancements` is the append-only, versioned home of the DERIVED
// enhanced material. `materials.text_content` stays the untouched raw
// extraction; each enhancement row records exactly which raw it was derived
// from (`source_revision` + `source_text_hash`) so the derivation is auditable
// and idempotent — running the same raw through again never creates a
// duplicate version.
//
// Columns:
//   payload   — structured enhanced material: sections/blocks (each carrying
//               page + source provenance), the re-composed cleaned text, and
//               KEEP/EXCLUDE/REVIEW quality findings with reasons. Derived,
//               never a rewrite of the raw.
//   alignment — syllabus alignment analysis as pure metadata (syllabusId +
//               matched unit + block ids + confidence). Never modifies content.
export const materialEnhancements = pgTable(
  'material_enhancements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    materialId: uuid('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    // Why this version exists: OCR_COMPLETE | CORRECTION | TEXT_SOURCE | MANUAL
    trigger: varchar('trigger', { length: 30 }).notNull(),
    // provenance of the derivation — fingerprint of the exact raw input
    sourceRevision: integer('source_revision').notNull(),
    sourceTextHash: varchar('source_text_hash', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    alignment: jsonb('alignment'),
    // System-driven enhancements have no user; manual re-enhancements do.
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Append-only versioning: duplicate version numbers per material are
    // impossible (same backstop as content_versions).
    unique('material_enhancements_material_version_unique').on(table.materialId, table.version),
  ],
);

export type MaterialEnhancement = typeof materialEnhancements.$inferSelect;
export type NewMaterialEnhancement = typeof materialEnhancements.$inferInsert;