-- Soft-delete flag for the subject tree. Deleting a subject marks the whole
-- tree (subject -> chapters -> topics -> questions / materials / content /
-- syllabi) deleted in one transaction instead of cascading the rows away, so a
-- careless delete is reversible via Restore. Queries filter deleted_at IS NULL.
ALTER TABLE "subjects" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "chapters" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "topics" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "questions" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "materials" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "content_items" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "syllabi" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
-- Scoped question papers: a General (no-subject) pattern needs a subject to
-- select questions from, so the paper remembers which subject scoped it.
ALTER TABLE "question_papers" ADD COLUMN "subject_id" uuid REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "question_papers_subject_id_idx" ON "question_papers" USING btree ("subject_id");