-- Phase H — Student subject enrollments: per-student subject SCOPE overrides
-- (D5/§17, D6/§18). A placed student inherits their class's subject set
-- (placement → division → class → class_subjects); this table lets an
-- institute EXCLUDE a subject from one student or ENROLL them into a subject
-- NOT offered by their class (elective). One row per (placement, subject):
-- the unique key makes ENROLLED and EXCLUDED mutually exclusive per placement
-- (no contradictory overrides) and no override history is tracked — deleting
-- a row reverts that student to the class default. Rows are admin-invoked
-- only; nothing auto-creates them, so fresh placements get the class default.
-- `institute_id` mirrors the placement for tenant-scoped queries; the row is
-- pinned to a placement, which already carries year/class.
CREATE TABLE IF NOT EXISTS "student_subject_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_subject_enrollments" ADD CONSTRAINT "student_subject_enrollments_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_subject_enrollments" ADD CONSTRAINT "student_subject_enrollments_placement_id_student_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."student_placements"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_subject_enrollments" ADD CONSTRAINT "student_subject_enrollments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "student_subject_enrollments_placement_subject_unique" ON "student_subject_enrollments" ("placement_id","subject_id");