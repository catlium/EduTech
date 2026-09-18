-- Authoritative question scope for Question Papers and Assessments. The scope
-- (Subject required, Chapter/Topic optional) is the ONLY source of questions —
-- the paper pattern stays pure structure/evaluation and never supplies or
-- infers scope. Chain is enforced with the same shape as questions_scope_chain.
ALTER TABLE "question_papers" ADD COLUMN "chapter_id" uuid REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "question_papers" ADD COLUMN "topic_id" uuid REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "question_papers" ADD CONSTRAINT "question_papers_scope_chain" CHECK (("topic_id" IS NOT NULL AND "chapter_id" IS NOT NULL AND "subject_id" IS NOT NULL) OR ("topic_id" IS NULL AND "chapter_id" IS NOT NULL AND "subject_id" IS NOT NULL) OR ("topic_id" IS NULL AND "chapter_id" IS NULL));
--> statement-breakpoint
CREATE INDEX "question_papers_chapter_id_idx" ON "question_papers" USING btree ("chapter_id");
CREATE INDEX "question_papers_topic_id_idx" ON "question_papers" USING btree ("topic_id");
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "subject_id" uuid REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "assessments" ADD COLUMN "chapter_id" uuid REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "assessments" ADD COLUMN "topic_id" uuid REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_scope_chain" CHECK (("topic_id" IS NOT NULL AND "chapter_id" IS NOT NULL AND "subject_id" IS NOT NULL) OR ("topic_id" IS NULL AND "chapter_id" IS NOT NULL AND "subject_id" IS NOT NULL) OR ("topic_id" IS NULL AND "chapter_id" IS NULL));
--> statement-breakpoint
CREATE INDEX "assessments_subject_id_idx" ON "assessments" USING btree ("subject_id");
CREATE INDEX "assessments_chapter_id_idx" ON "assessments" USING btree ("chapter_id");
CREATE INDEX "assessments_topic_id_idx" ON "assessments" USING btree ("topic_id");