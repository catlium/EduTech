-- Lock flag for approved/confirmed resources: update/delete require an
-- explicit unlock (protects against accidental edits/removals).
ALTER TABLE "paper_patterns" ADD COLUMN "is_locked" boolean NOT NULL DEFAULT false;
ALTER TABLE "syllabi" ADD COLUMN "is_locked" boolean NOT NULL DEFAULT false;

-- Backfill: resources already in a terminal status are locked by default,
-- matching the previous immutable-approval behavior but now reversible via
-- an explicit unlock.
UPDATE "paper_patterns" SET "is_locked" = true WHERE "status" = 'APPROVED';
UPDATE "syllabi" SET "is_locked" = true WHERE "status" = 'CONFIRMED';