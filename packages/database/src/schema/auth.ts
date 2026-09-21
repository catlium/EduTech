import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // Phase K (D7/§19): parent session pointer for refresh lineage revocation
  // (reuse of a spent token revokes the family), and device metadata for
  // session listing/per-session revocation.
  rotatedFromSid: uuid('rotated_from_sid').references((): AnyPgColumn => authSessions.id, {
    onDelete: 'set null',
  }),
  userAgent: varchar('user_agent', { length: 255 }),
  lastIp: varchar('last_ip', { length: 64 }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One-time password-reset tokens (D7/§19 F5 / audit M2). The plaintext token
// handed to the user is `${id}.${secret}`; only the bcrypt hash of the secret
// is stored. `used_at` makes consumption atomic; `expires_at` bounds validity.
export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});