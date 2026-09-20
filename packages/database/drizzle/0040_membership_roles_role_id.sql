-- Phase C — migrate membership_roles from the free-form `role` string to the
-- `role_id` FK (D2/§14). Preserves every existing membership assignment:
--   1. ensures the three built-in institute system roles exist (idempotent —
--      the API boot sync would seed them anyway; the migration needs them
--      for the backfill);
--   2. verifies every existing `role` value maps to an institute-domain
--      system role — unknown/orphaned values abort the migration rather than
--      being silently lost;
--   3. backfills `role_id`, makes it NOT NULL, FKs it to `roles`, drops the
--      legacy column, and restores membership+role uniqueness on `role_id`.
INSERT INTO "roles" ("key", "name", "description", "kind", "domain")
VALUES
	('INSTITUTE_ADMIN', 'Institute Admin', 'Institute-wide administration. Holds the manage key for every institute resource.', 'system', 'institute'),
	('TEACHER', 'Teacher', 'Teaching staff. Full read/create/update/delete over academic structure and content.', 'system', 'institute'),
	('STUDENT', 'Student', 'Learning surface. Reads academic structure and content; self-scoped attempts and practice.', 'system', 'institute')
ON CONFLICT ("key") WHERE kind = 'system' DO NOTHING;
--> statement-breakpoint
ALTER TABLE "membership_roles" ADD COLUMN "role_id" uuid;
--> statement-breakpoint
DO $$
DECLARE unmapped_count integer;
BEGIN
	SELECT count(*) INTO unmapped_count
	FROM "membership_roles" mr
	LEFT JOIN "roles" r
	  ON r."key" = mr.role AND r."kind" = 'system' AND r."domain" = 'institute'
	WHERE r."id" IS NULL;
	IF unmapped_count > 0 THEN
		RAISE EXCEPTION 'membership_roles: % role value(s) have no institute-domain system role mapping; refusing to migrate', unmapped_count;
	END IF;
END $$;
--> statement-breakpoint
UPDATE "membership_roles" mr
SET "role_id" = r."id"
FROM "roles" r
WHERE r."key" = mr.role AND r."kind" = 'system' AND r."domain" = 'institute';
--> statement-breakpoint
ALTER TABLE "membership_roles" ALTER COLUMN "role_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "membership_roles" DROP COLUMN "role";
--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_role_unique" UNIQUE("membership_id","role_id");