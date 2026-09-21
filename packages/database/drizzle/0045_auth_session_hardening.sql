-- Phase K — Authentication/session hardening (D7/§19, audit F1-F6/H1-H7).
--
-- auth_sessions grows the F2/F6 columns:
--   rotated_from_sid  -- parent pointer for refresh lineage revocation (a
--                        replayed/spent token revokes its token family)
--   user_agent        -- device metadata for session listing (F3)
--   last_ip           -- device metadata for session listing (F3)
--   last_used_at      -- last rotation, for the device list (F3)
-- plus a user_id index so the per-request session-aware access check (F1)
-- and the listing/GC queries stay indexed.
--
-- password_resets stores one-time password-reset tokens (F5 / audit M2).
-- The plaintext token is `${id}.${secret}`; only the bcrypt hash of the
-- secret is persisted. used_at makes consumption atomic.
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "rotated_from_sid" uuid;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "user_agent" varchar(255);
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "last_ip" varchar(64);
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_rotated_from_sid_auth_sessions_id_fk" FOREIGN KEY ("rotated_from_sid") REFERENCES "public"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_resets_user_id_idx" ON "password_resets" ("user_id");