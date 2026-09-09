CREATE TABLE "paper_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" varchar(1000),
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_type" varchar(30) DEFAULT 'MANUAL' NOT NULL,
	"source_material_id" uuid,
	"structure" jsonb,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"validated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "jobs_active_generation_unique";--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "blueprint_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_patterns" ADD CONSTRAINT "paper_patterns_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_patterns" ADD CONSTRAINT "paper_patterns_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_patterns" ADD CONSTRAINT "paper_patterns_source_material_id_materials_id_fk" FOREIGN KEY ("source_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_patterns" ADD CONSTRAINT "paper_patterns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_patterns" ADD CONSTRAINT "paper_patterns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_blueprint_id_paper_patterns_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."paper_patterns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_generation_unique" ON "jobs" USING btree ("institute_id",((payload -> 'operation')),((payload -> 'source' ->> 'type')),((payload -> 'source' ->> 'id'))) WHERE type IN ('AI_GENERATE_NOTE', 'AI_GENERATE_SUMMARY', 'AI_GENERATE_FLASHCARDS', 'AI_GENERATE_CONCEPTS', 'AI_GENERATE_SYLLABUS', 'AI_GENERATE_QUESTIONS', 'AI_GENERATE_BLUEPRINT') AND status IN ('queued', 'processing');