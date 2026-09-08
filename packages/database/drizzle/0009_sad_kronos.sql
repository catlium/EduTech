CREATE TABLE "syllabus_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING_REVIEW' NOT NULL,
	"structure" jsonb NOT NULL,
	"source_material_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "syllabus_proposals_subject_unique" UNIQUE("subject_id")
);
--> statement-breakpoint
DROP INDEX "jobs_active_generation_unique";--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD CONSTRAINT "syllabus_proposals_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD CONSTRAINT "syllabus_proposals_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD CONSTRAINT "syllabus_proposals_source_material_id_materials_id_fk" FOREIGN KEY ("source_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD CONSTRAINT "syllabus_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_proposals" ADD CONSTRAINT "syllabus_proposals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_generation_unique" ON "jobs" USING btree ("institute_id",((payload -> 'operation')),((payload -> 'source' ->> 'type')),((payload -> 'source' ->> 'id'))) WHERE type IN ('AI_GENERATE_NOTE', 'AI_GENERATE_SUMMARY', 'AI_GENERATE_FLASHCARDS', 'AI_GENERATE_CONCEPTS', 'AI_GENERATE_SYLLABUS') AND status IN ('queued', 'processing');