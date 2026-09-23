import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { institutes } from './institutes.js';

// Platform administrative audit trail (docs/architecture/platform-audit-trail.md).
// One row per COMMITTED platform-plane mutation, inserted in the SAME
// transaction as the mutation (success-only atomicity). Append-only: no
// updated_at, no UPDATE/DELETE paths. `action`/`resource_type` are open strings
// validated by the app catalogue (PLATFORM_AUDIT_ACTIONS) — deliberately NOT DB
// CHECK-constrained, exactly like permissions.key (vocabulary grows via
// catalogue entries, not migrations). Foreign keys are plain NO ACTION refs:
// users/institutes are never deleted, and a stray delete should fail loudly
// rather than silently rewrite history.
export const platformAuditEvents = pgTable(
  'platform_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable = reserved automated/system actor (scheduled deactivation, future).
    actorUserId: uuid('actor_user_id').references(() => users.id),
    // Dot-notation event vocabulary, e.g. 'institute.create' (see plans of §4).
    action: varchar('action', { length: 64 }).notNull(),
    // Kind of the mutated resource: 'institute' today, 'platform_user' later.
    resourceType: varchar('resource_type', { length: 32 }).notNull(),
    // Id of the mutated resource; for institute events this is institutes.id.
    resourceId: uuid('resource_id').notNull(),
    // Affected tenant. Present on every event today (= resource_id); nullable
    // for future non-institute-scoped events (platform-user lifecycle).
    instituteId: uuid('institute_id').references(() => institutes.id),
    // Per-action shape (§5), fixed at write time by the record helper.
    metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
    // Event timestamp = mutation commit time (DB now()).
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('platform_audit_events_resource_idx').on(table.resourceType, table.resourceId, table.createdAt),
    index('platform_audit_events_institute_idx').on(table.instituteId, table.createdAt),
  ],
);