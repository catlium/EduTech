ALTER TABLE "syllabus_proposals" ALTER COLUMN "structure" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD COLUMN "generation_job_id" uuid;--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD COLUMN "generation_error" text;--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD CONSTRAINT "syllabus_proposals_generation_job_id_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;