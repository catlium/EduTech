-- Material Intelligence (Phase A): the single-entity check on
-- material_enhancement_segment_mappings was over-strict. The enhancer writes
-- each mapping row with its full syllabus context (a topic row carries the
-- chapter/topic ancestor ids + names for display + downstream filter), but the
-- old check required EXACTLY ONE of subject/chapter/topic/unit to be set, so
-- every chapter/topic/unit mapping violated it and the whole enhancement
-- transaction rolled back. The check is now type-aware: the `type` column
-- declares WHICH entity the mapping targets, and ancestor context columns are
-- allowed on the descendants they anchor.
ALTER TABLE "material_enhancement_segment_mappings" DROP CONSTRAINT "material_enhancement_mappings_single_entity";
--> statement-breakpoint
ALTER TABLE "material_enhancement_segment_mappings" ADD CONSTRAINT "material_enhancement_mappings_single_entity" CHECK (
	(type = 'subject' AND "subject_id" IS NOT NULL AND "chapter_id" IS NULL AND "topic_id" IS NULL AND "unit_title" IS NULL)
	OR (type = 'chapter' AND "chapter_id" IS NOT NULL AND "topic_id" IS NULL)
	OR (type = 'topic' AND "topic_id" IS NOT NULL)
	OR (type = 'unit' AND "syllabus_id" IS NOT NULL AND "unit_title" IS NOT NULL AND "chapter_id" IS NULL AND "topic_id" IS NULL)
);