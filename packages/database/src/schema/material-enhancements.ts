import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { chapters, subjects, topics } from './academic.js';
import { materials } from './materials.js';
import { syllabi } from './syllabus.js';
import { users } from './users.js';

// Material Intelligence — Phase A (cleaning + syllabus relevance)
//
// MATERIAL_ENHANCEMENT root: `material_enhancements` is the append-only,
// versioned home of the DERIVED enhanced material. `materials.text_content`
// stays the untouched raw extraction; each enhancement row records exactly
// which raw it was derived from (`source_revision` + `source_text_hash`) so
// the derivation is auditable and idempotent — running the same raw through
// again never creates a duplicate version.
//
//   payload   — structured enhanced material: sections/blocks (each carrying
//               page + engine provenance), the re-composed cleaned text, and
//               KEEP/EXCLUDE/REVIEW quality findings with reasons. Derived,
//               never a rewrite of the raw.
//
// SEGMENTATION + SYLLABUS RELEVANCE (normalized, queryable):
//   material_enhancement_segments — logical regions of the material (each
//               introduced by a detected heading, or an unheaded prefix). A
//               segment keeps its page range + the payload block ids it spans,
//               so provenance is retained without copying content. One uploaded
//               Material stays the canonical source — segments never become
//               separate materials.
//   material_enhancement_segment_mappings — a segment → syllabus entity
//               (Subject/Chapter/Topic, or a syllabus Context-unit fallback)
//               association with relevance level + confidence + reason. A
//               segment can map to several entities (multiple rows); entities
//               are never invented — only matched when overlap is found, and
//               irrelevant/unmapped segments are flagged, never deleted.
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

export const materialEnhancementSegments = pgTable(
  'material_enhancement_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enhancementId: uuid('enhancement_id')
      .notNull()
      .references(() => materialEnhancements.id, { onDelete: 'cascade' }),
    segmentNo: integer('segment_no').notNull().default(1),
    // Detected logical structure: chapter | section | other (unheaded prefix)
    kind: varchar('kind', { length: 20 })
      .notNull()
      .$type<'chapter' | 'section' | 'other'>(),
    // Overall syllabus relevance of the segment:
    // relevant | uncertain | irrelevant | unmapped
    level: varchar('level', { length: 20 })
      .notNull()
      .$type<'relevant' | 'uncertain' | 'irrelevant' | 'unmapped'>(),
    title: varchar('title', { length: 500 }),
    // First characters of the segment's cleaned text (display/audit shorthand).
    preview: varchar('preview', { length: 500 }),
    startPage: integer('start_page').notNull(),
    endPage: integer('end_page').notNull(),
    // Payload block ids this segment spans (provenance by reference — content
    // lives only inside the payload jsonb, single source of truth per version).
    blockIds: jsonb('block_ids').notNull().$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('material_enhancement_segments_no_unique').on(table.enhancementId, table.segmentNo),
    index('material_enhancement_segments_enhancement_idx').on(table.enhancementId),
  ],
);

export const materialEnhancementSegmentMappings = pgTable(
  'material_enhancement_segment_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => materialEnhancementSegments.id, { onDelete: 'cascade' }),
    // Associated syllabus entity: subject | chapter | topic | unit
    type: varchar('type', { length: 20 })
      .notNull()
      .$type<'subject' | 'chapter' | 'topic' | 'unit'>(),
    // relevant | uncertain (irrelevant/unmapped live on the segment row)
    level: varchar('level', { length: 20 })
      .notNull()
      .$type<'relevant' | 'uncertain'>(),
    // 0..1 keyword-overlap certainty of this association
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    // Subject/Chapter/Topic references (normalized — downsteam filters on
    // these). Chapter/topic rows also carry names for display.
    syllabusId: uuid('syllabus_id').references(() => syllabi.id),
    subjectId: uuid('subject_id').references(() => subjects.id),
    chapterId: uuid('chapter_id').references(() => chapters.id),
    chapterName: varchar('chapter_name', { length: 255 }),
    topicId: uuid('topic_id').references(() => topics.id),
    topicName: varchar('topic_name', { length: 255 }),
    unitTitle: varchar('unit_title', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A mapping targets exactly one syllabus entity per its `type`, with
    // ancestor context columns carried as display/filter context:
    //   subject = subject_id
    //   chapter = chapter_id (+ subject/syllabus context)
    //   topic   = topic_id (+ optional chapter context above it)
    //   unit    = syllabus_id + unit_title (Context-units fallback)
    check(
      'material_enhancement_mappings_single_entity',
      sql`(
        (${table.type} = 'subject' AND ${table.subjectId} IS NOT NULL AND ${table.chapterId} IS NULL AND ${table.topicId} IS NULL AND ${table.unitTitle} IS NULL)
        OR (${table.type} = 'chapter' AND ${table.chapterId} IS NOT NULL AND ${table.topicId} IS NULL)
        OR (${table.type} = 'topic' AND ${table.topicId} IS NOT NULL)
        OR (${table.type} = 'unit' AND ${table.syllabusId} IS NOT NULL AND ${table.unitTitle} IS NOT NULL AND ${table.chapterId} IS NULL AND ${table.topicId} IS NULL)
      )`,
    ),
    index('material_enhancement_mappings_segment_idx').on(table.segmentId),
    // Downstream Subject → Chapter → Topic relevance queries.
    index('material_enhancement_mappings_topic_idx').on(table.topicId),
    index('material_enhancement_mappings_chapter_idx').on(table.chapterId),
    index('material_enhancement_mappings_subject_idx').on(table.subjectId),
  ],
);

export type MaterialEnhancement = typeof materialEnhancements.$inferSelect;
export type NewMaterialEnhancement = typeof materialEnhancements.$inferInsert;
export type MaterialEnhancementSegment = typeof materialEnhancementSegments.$inferSelect;
export type NewMaterialEnhancementSegment = typeof materialEnhancementSegments.$inferInsert;
export type MaterialEnhancementSegmentMapping = typeof materialEnhancementSegmentMappings.$inferSelect;
export type NewMaterialEnhancementSegmentMapping = typeof materialEnhancementSegmentMappings.$inferInsert;