CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"subject_id" uuid,
	"chapter_id" uuid,
	"topic_id" uuid,
	"title" varchar(255) NOT NULL,
	"description" varchar(1000),
	"material_type" varchar(30) NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"file_name" varchar(255),
	"mime_type" varchar(120),
	"file_size" integer,
	"storage_provider" varchar(30) DEFAULT 'local' NOT NULL,
	"storage_key" varchar(1000),
	"text_content" text,
	"processing_status" varchar(20) DEFAULT 'UPLOADED' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_exactly_one_scope" CHECK ((("materials"."subject_id" IS NOT NULL)::int + ("materials"."chapter_id" IS NOT NULL)::int + ("materials"."topic_id" IS NOT NULL)::int) = 1),
	CONSTRAINT "materials_source_consistency" CHECK ((
        CASE "materials"."source_type"
          WHEN 'UPLOAD' THEN "materials"."file_name" IS NOT NULL AND "materials"."storage_key" IS NOT NULL
          WHEN 'TEXT' THEN "materials"."text_content" IS NOT NULL
          ELSE true
        END
      ))
);
--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;