-- Paper-pattern provenance on generated bank questions. A Question Bank
-- retains the approved paper pattern that governed its generation; the
-- reference is nullable and drops (SET NULL) when the pattern is deleted so
-- questions survive the pattern lifecycle.
ALTER TABLE "questions" ADD COLUMN "source_pattern_id" uuid;
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_pattern_id_paper_patterns_id_fk" FOREIGN KEY ("source_pattern_id") REFERENCES "public"."paper_patterns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "questions_source_pattern_id_idx" ON "questions" USING btree ("source_pattern_id");