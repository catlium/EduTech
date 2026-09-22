-- LOW-1 remediation — trusted job ownership.
--
-- jobs gains `created_by` — the verifiable job owner, stamped from the
-- authenticated actor at issue time (never from the request payload), used
-- by the QUESTION_EXTRACT/QP_EXTRACT/PATTERN_EXTRACT sweep owner-gates.
-- NULL for system-generated jobs (PROCESS_SYLLABUS, OCR/CORRECTION-triggered
-- MATERIAL_ENHANCE) — precedent: materialEnhancements.createdBy is nullable.
--
-- Backfill adopts the old ad-hoc owner keys, preferring `userId` over
-- `requestedBy`. Payload values are text but created_by is uuid, so the cast
-- is guarded by the uuid regex: values that don't parse (the old public
-- POST /jobs accepted arbitrary payload.userId) become NULL — those rows stay
-- classified as system jobs, the safe default. Rows with neither key stay NULL.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "created_by" uuid;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "jobs" SET "created_by" = COALESCE(
    CASE WHEN payload->>'userId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (payload->>'userId')::uuid END,
    CASE WHEN payload->>'requestedBy' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (payload->>'requestedBy')::uuid END
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_created_by_idx" ON "jobs" ("created_by");