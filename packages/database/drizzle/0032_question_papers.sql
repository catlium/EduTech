-- Question Papers: a separate entity from Assessments for fixed question
-- paper selection and export. Each paper snapshots the metadata of its source
-- pattern (duration, marks, instructions) and links selected questions via
-- the junction table. "Create Assessment from QP" copies these rows into
-- assessment_questions.
CREATE TABLE "question_papers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "institute_id" uuid NOT NULL REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action,
  "title" varchar(255) NOT NULL,
  "description" text,
  "blueprint_id" uuid REFERENCES "public"."paper_patterns"("id") ON DELETE set null ON UPDATE no action,
  "duration_minutes" integer,
  "max_marks" integer,
  "instructions" jsonb,
  "created_by" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  "updated_by" uuid REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Junction: selected questions for a question paper.
CREATE TABLE "question_paper_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "paper_id" uuid NOT NULL REFERENCES "public"."question_papers"("id") ON DELETE cascade ON UPDATE no action,
  "question_id" uuid NOT NULL REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action,
  "sort_order" integer NOT NULL DEFAULT 0,
  "marks" integer NOT NULL DEFAULT 1,
  "section" varchar(100) NOT NULL DEFAULT 'General',
  CONSTRAINT "question_paper_questions_unique" UNIQUE ("paper_id", "question_id")
);
--> statement-breakpoint
CREATE INDEX "question_papers_institute_id_idx" ON "question_papers" USING btree ("institute_id");
--> statement-breakpoint
CREATE INDEX "question_papers_blueprint_id_idx" ON "question_papers" USING btree ("blueprint_id");
