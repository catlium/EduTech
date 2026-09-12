CREATE TABLE "question_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"instructions" text,
	"answer_format" varchar(50) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"default_marks" integer,
	"allowed_difficulties" jsonb DEFAULT '["EASY","MEDIUM","HARD"]'::jsonb,
	"evaluation_config" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_types" ADD CONSTRAINT "question_types_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_types" ADD CONSTRAINT "question_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_types" ADD CONSTRAINT "question_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "question_types_global_code_idx" ON "question_types" USING btree ("code") WHERE "question_types"."institute_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "question_types_scoped_code_idx" ON "question_types" USING btree ("code","institute_id");--> statement-breakpoint

-- Predefined starter question-type templates (institute_id NULL = global).
INSERT INTO "question_types" ("code", "name", "description", "instructions", "answer_format", "kind", "default_marks")
VALUES
  ('MCQ', 'Multiple Choice', 'Choose the single correct option.', 'Choose the best answer from the options given.', 'MCQ', 'OBJECTIVE', 1),
  ('TRUE_FALSE', 'True / False', 'Decide whether the statement is true or false.', 'State whether the statement is True or False.', 'TRUE_FALSE', 'OBJECTIVE', 1),
  ('FILL_IN_BLANK', 'Fill in the Blank', 'Complete the sentence with the missing word(s).', 'Write the missing word or phrase in the blank.', 'FILL_IN_BLANK', 'OBJECTIVE', 1),
  ('DEFINITION', 'Definition', 'Define the given term precisely.', 'Define the term in one or two sentences.', 'TEXT', 'SUBJECTIVE', 2),
  ('VERY_SHORT_ANSWER', 'Very Short Answer', 'One or two line answer.', 'Answer in one or two sentences.', 'TEXT', 'SUBJECTIVE', 1),
  ('SHORT_ANSWER', 'Short Answer', 'Concise answer covering key points.', 'Answer in a short paragraph (3-5 lines).', 'TEXT', 'SUBJECTIVE', 2),
  ('BRIEF_ANSWER', 'Brief / Explain', 'Explain briefly with supporting points.', 'Explain your answer in a short paragraph with reasons.', 'TEXT', 'SUBJECTIVE', 4),
  ('LONG_ANSWER', 'Long / Descriptive Answer', 'Detailed descriptive answer.', 'Write a detailed answer covering all the points.', 'TEXT', 'SUBJECTIVE', 8),
  ('MATCH_THE_FOLLOWING', 'Match the Following', 'Match items from two columns.', 'Match each item in the left column to its pair on the right.', 'MATCHING', 'OBJECTIVE', 2),
  ('CASE_STUDY', 'Case Study / Case Analysis', 'Analyse a scenario and answer.', 'Read the case carefully and answer the questions that follow.', 'TEXT', 'SUBJECTIVE', 5),
  ('NUMERICAL', 'Numerical / Problem Solving', 'Solve the numerical problem.', 'Show your working and give the final answer.', 'NUMERICAL', 'OBJECTIVE', 2)
ON CONFLICT ("code") WHERE "institute_id" IS NULL DO NOTHING;--> statement-breakpoint

-- Question types are open codes (predefined or custom) — widen the column.
ALTER TABLE "questions" ALTER COLUMN "question_type" SET DATA TYPE varchar(64);