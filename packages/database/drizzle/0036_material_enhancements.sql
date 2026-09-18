-- Material Intelligence (Phase A): versioned, derived enhanced material +
-- logical segmentation with normalized syllabus-relevance associations.
-- `materials.text_content` stays the untouched raw extraction; each enhancement
-- row is an append-only derivation carrying the exact raw fingerprint
-- (source_revision + source_text_hash) it was computed from, so re-running the
-- same raw is idempotent and every version is auditable. Segments reference
-- payload block ids + page ranges (provenance without duplicating content);
-- mappings associate a segment with at most one Subject/Chapter/Topic (or a
-- syllabus Context-unit fallback) and carry relevance level + confidence.
CREATE TABLE "material_enhancements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"trigger" varchar(30) NOT NULL,
	"source_revision" integer NOT NULL,
	"source_text_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_enhancements_material_version_unique" UNIQUE("material_id","version")
);
--> statement-breakpoint
CREATE TABLE "material_enhancement_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enhancement_id" uuid NOT NULL,
	"segment_no" integer DEFAULT 1 NOT NULL,
	"kind" varchar(20) NOT NULL,
	"level" varchar(20) NOT NULL,
	"title" varchar(500),
	"preview" varchar(500),
	"start_page" integer NOT NULL,
	"end_page" integer NOT NULL,
	"block_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_enhancement_segments_no_unique" UNIQUE("enhancement_id","segment_no")
);
--> statement-breakpoint
CREATE TABLE "material_enhancement_segment_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"level" varchar(20) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"syllabus_id" uuid,
	"subject_id" uuid,
	"chapter_id" uuid,
	"chapter_name" varchar(255),
	"topic_id" uuid,
	"topic_name" varchar(255),
	"unit_title" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_enhancement_mappings_single_entity" CHECK (
		(CASE WHEN "subject_id" IS NOT NULL THEN 1 ELSE 0 END +
		 CASE WHEN "chapter_id" IS NOT NULL THEN 1 ELSE 0 END +
		 CASE WHEN "topic_id" IS NOT NULL THEN 1 ELSE 0 END +
		 CASE WHEN ("syllabus_id" IS NOT NULL AND "unit_title" IS NOT NULL) THEN 1 ELSE 0 END) = 1
	)
);
--> statement-breakpoint
CREATE INDEX "material_enhancement_segments_enhancement_idx" ON "material_enhancement_segments" ("enhancement_id");
--> statement-breakpoint
CREATE INDEX "material_enhancement_mappings_segment_idx" ON "material_enhancement_segment_mappings" ("segment_id");
--> statement-breakpoint
CREATE INDEX "material_enhancement_mappings_topic_idx" ON "material_enhancement_segment_mappings" ("topic_id");
--> statement-breakpoint
CREATE INDEX "material_enhancement_mappings_chapter_idx" ON "material_enhancement_segment_mappings" ("chapter_id");
--> statement-breakpoint
CREATE INDEX "material_enhancement_mappings_subject_idx" ON "material_enhancement_segment_mappings" ("subject_id");
--> statement-breakpoint
ALTER TABLE "material_enhancements" ADD CONSTRAINT "material_enhancements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancements" ADD CONSTRAINT "material_enhancements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancement_segments" ADD CONSTRAINT "material_enhancement_segments_enhancement_id_material_enhancements_id_fk" FOREIGN KEY ("enhancement_id") REFERENCES "public"."material_enhancements"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancement_segment_mappings" ADD CONSTRAINT "material_enhancement_segment_mappings_segment_id_material_enhancement_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."material_enhancement_segments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancement_segment_mappings" ADD CONSTRAINT "material_enhancement_segment_mappings_syllabus_id_syllabi_id_fk" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancement_segment_mappings" ADD CONSTRAINT "material_enhancement_segment_mappings_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancement_segment_mappings" ADD CONSTRAINT "material_enhancement_segment_mappings_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancement_segment_mappings" ADD CONSTRAINT "material_enhancement_segment_mappings_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;