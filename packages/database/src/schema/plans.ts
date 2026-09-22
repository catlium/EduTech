import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';

// Platform plan catalog (starter/growth/institute seeded by migration 0047).
// No billing/feature columns yet — lifecycle foundation only; the subscription
// merely records which plan an institute is on.
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const instituteSubscriptions = pgTable('institute_subscriptions', {
  instituteId: uuid('institute_id')
    .primaryKey()
    .references(() => institutes.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});