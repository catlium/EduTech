-- Phase G — Student academic placements: a STUDENT membership (student =
-- institute member) is placed into ONE division per academic year (D5/§17).
-- Student → Division → (Class + Academic Year): the division carries its year
-- and class, so `class_id` is never mirrored; `academic_year_id` is written
-- server-side from the division (never client-supplied) purely so the partial
-- unique index can enforce "one ACTIVE placement per (student, year)". An
-- inactive (historical) row allows re-placement; promotions/transfers add a
-- fresh row while the prior row is soft-deactivated. Divisions group students
-- ONLY — there is NO `division_subjects`: curriculum stays class-scoped via
-- `class_subjects`, shared by every division of a class/year.
CREATE TABLE IF NOT EXISTS "student_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_placements" ADD CONSTRAINT "student_placements_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_placements" ADD CONSTRAINT "student_placements_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_placements" ADD CONSTRAINT "student_placements_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_placements" ADD CONSTRAINT "student_placements_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "student_placements_active_unique" ON "student_placements" ("academic_year_id","membership_id") WHERE "status" = 'active';