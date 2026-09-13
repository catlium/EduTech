CREATE TABLE IF NOT EXISTS "syllabi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" varchar(255) NOT NULL,
	"program" varchar(255),
	"academic_year" varchar(20),
	"source_type" varchar(20) DEFAULT 'UPLOAD' NOT NULL,
	"file_name" varchar(255),
	"mime_type" varchar(120),
	"file_size" integer,
	"storage_provider" varchar(30) DEFAULT 'local' NOT NULL,
	"storage_key" varchar(1000),
	"text_content" text,
	"processing_status" varchar(20) DEFAULT 'UPLOADED' NOT NULL,
	"processing_job_id" uuid,
	"processing_error" text,
	"analysis_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"analysis_job_id" uuid,
	"analysis_error" text,
	"context" jsonb,
	"structure" jsonb,
	"status" varchar(20) DEFAULT 'PROPOSED' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_processing_job_id_jobs_id_fk" FOREIGN KEY ("processing_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_analysis_job_id_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "syllabi_subject_version_unique" ON "syllabi" USING btree ("subject_id","version");--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_source_consistency" CHECK (CASE "source_type" WHEN 'UPLOAD' THEN "file_name" IS NOT NULL AND "storage_key" IS NOT NULL WHEN 'TEXT' THEN "text_content" IS NOT NULL ELSE true END);
--> statement-breakpoint
INSERT INTO "syllabi" ("institute_id","subject_id","version","title","source_type","text_content","processing_status","processing_job_id","processing_error","analysis_status","analysis_job_id","analysis_error","context","structure","status","confirmed_at","created_by","updated_by","created_at","updated_at")
SELECT sp."institute_id", sp."subject_id", 1, COALESCE(s."name", 'Syllabus'), 'IMPORTED', NULL, 'READY', NULL, NULL,
  CASE sp."status" WHEN 'CONFIRMED' THEN 'READY' WHEN 'FAILED' THEN 'FAILED' ELSE 'READY' END,
  NULL, sp."generation_error", NULL, sp."structure",
  CASE sp."status" WHEN 'CONFIRMED' THEN 'CONFIRMED' ELSE 'PROPOSED' END,
  CASE sp."status" WHEN 'CONFIRMED' THEN COALESCE(sp."confirmed_at", now()) ELSE NULL END,
  sp."created_by", sp."updated_by", sp."created_at", sp."updated_at"
FROM "syllabus_proposals" sp LEFT JOIN "subjects" s ON s."id" = sp."subject_id";
--> statement-breakpoint
DROP TABLE "syllabus_proposals";
--> statement-breakpoint
DROP INDEX "jobs_active_generation_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_generation_unique" ON "jobs" USING btree ("institute_id",((payload -> 'operation')),((payload -> 'source' ->> 'type')),((payload -> 'source' ->> 'id'))) WHERE type IN ('AI_GENERATE_NOTE', 'AI_GENERATE_SUMMARY', 'AI_GENERATE_FLASHCARDS', 'AI_GENERATE_CONCEPTS', 'AI_GENERATE_CONTENT_PACKAGE', 'AI_GENERATE_QUESTIONS', 'AI_GENERATE_BLUEPRINT', 'AI_GENERATE_STARTER_MATERIAL', 'AI_ANALYZE_SYLLABUS') AND status IN ('queued', 'processing');