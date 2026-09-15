import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  jsonb,
  text,
  timestamp,
  check,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { jobs } from './jobs.js';
import { institutes } from './institutes.js';
import { users } from './users.js';

// Distributed OCR worker registry (platform-global, NOT tenant-scoped).
//
// External OCR workers are computation-only: they claim page-range chunk tasks
// over HTTPS, OCR locally, and submit results. `tokenHash` is SHA-256 of the
// secret portion of the `owr_...` API key (never stored plaintext). Derived
// status (processing/idle/offline/disabled) is computed from
// `last_heartbeat_at` + `current_chunk_id` — never stored.
export const ocrWorkers = pgTable(
  'ocr_workers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    currentChunkId: uuid('current_chunk_id'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    version: varchar('version', { length: 50 }),
    capabilities: jsonb('capabilities'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ocr_workers_token_hash_unique').on(table.tokenHash)],
);

// Page-range chunk task — the unit of OCR work owned by the server-side
// coordinator beneath the existing `jobs` row.
//
// Status: pending → claimed → submitted (terminal good), or → failed
// (retryable until `attempts >= maxAttempts`), or → cancelled.
// `source_id` is polymorphic (materials or syllabi row) so it carries no FK.
// `document_pages` is the reported total page count of the source document
// (worker reports it when it sees the full PDF header); the coordinator uses
// it to materialize chunks 2..ceil(N/chunkSize) after chunk 1 completes and
// to prove READY coverage (contiguous pages 1..N exactly once).
export const ocrChunks = pgTable(
  'ocr_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    startPage: integer('start_page').notNull(),
    endPage: integer('end_page').notNull(),
    documentPages: integer('document_pages'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    claimedBy: uuid('claimed_by').references(() => ocrWorkers.id, { onDelete: 'set null' }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    error: jsonb('error'),
    result: jsonb('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('ocr_chunks_page_range', sql`${table.startPage} >= 1 AND ${table.endPage} >= ${table.startPage}`),
    // One chunk per index per job + a claim-serving index on (status, lease).
    uniqueIndex('ocr_chunks_job_chunk_unique').on(table.jobId, table.chunkIndex),
    index('ocr_chunks_claim_idx').on(table.status, table.leaseExpiresAt),
  ],
);

// Manual per-page correction over the extracted text of a processed source.
//
// Keyed by (sourceType, sourceId, page) — NOT by chunk/job — so corrections
// survive a re-run of the same material (a retry creates a new job + chunks
// but addresses the same physical pages). Metadata preserves who corrected a
// page and when; `corrected_text` is the corrected output, while the original
// OCR output stays immutable in the owning chunk's `result.pages[].text`.
export const ocrPageCorrections = pgTable(
  'ocr_page_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    page: integer('page').notNull(),
    correctedText: text('corrected_text').notNull(),
    correctedBy: uuid('corrected_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    correctedAt: timestamp('corrected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('ocr_page_corrections_page_range', sql`${table.page} >= 1`),
    uniqueIndex('ocr_page_corrections_source_page_unique').on(
      table.sourceType,
      table.sourceId,
      table.page,
    ),
  ],
);