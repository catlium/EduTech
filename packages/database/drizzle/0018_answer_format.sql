ALTER TABLE "questions" ALTER COLUMN "question_type" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "answer_format" varchar(50);