-- Paper Pattern ↔ Subject many-to-many: replace single required subject_id
-- with a junction table so patterns can be associated with zero (General),
-- one, or many subjects. A unique constraint prevents duplicate associations.
CREATE TABLE "paper_pattern_subjects" (
	"pattern_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "paper_pattern_subjects_pattern_id_subject_id_pk" PRIMARY KEY("pattern_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "paper_pattern_subjects" ADD CONSTRAINT "paper_pattern_subjects_pattern_id_paper_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."paper_patterns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "paper_pattern_subjects" ADD CONSTRAINT "paper_pattern_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Backfill existing single-subject associations into the junction table.
INSERT INTO "paper_pattern_subjects" ("pattern_id", "subject_id")
SELECT "id", "subject_id" FROM "paper_patterns" WHERE "subject_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Drop the old required single-subject FK + column.
ALTER TABLE "paper_patterns" DROP CONSTRAINT "paper_patterns_subject_id_subjects_id_fk";
--> statement-breakpoint
ALTER TABLE "paper_patterns" DROP COLUMN "subject_id";
