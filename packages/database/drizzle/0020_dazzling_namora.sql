-- Academic scope chain: relax exactly_one_scope checks, backfill full chains,
-- then apply the new scope_chain constraints.

-- 1. Drop old exactly_one_scope constraints so backfill may set more than one.
ALTER TABLE "materials" DROP CONSTRAINT IF EXISTS "materials_exactly_one_scope";--> statement-breakpoint
ALTER TABLE "content_items" DROP CONSTRAINT IF EXISTS "content_items_exactly_one_scope";--> statement-breakpoint
ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_exactly_one_scope";--> statement-breakpoint

-- 2. Backfill materials: topic-only -> chapter+subject; chapter-only -> subject.
UPDATE "materials" m
SET "chapter_id" = t.chapter_id,
    "subject_id" = COALESCE(m.subject_id, c.subject_id)
FROM "topics" t
JOIN "chapters" c ON t.chapter_id = c.id
WHERE m."topic_id" = t.id
  AND m."chapter_id" IS DISTINCT FROM t.chapter_id;
UPDATE "materials" m
SET "subject_id" = c.subject_id
FROM "chapters" c
WHERE m."chapter_id" = c.id
  AND m."subject_id" IS NULL;--> statement-breakpoint

-- 3. Backfill content_items.
UPDATE "content_items" ci
SET "chapter_id" = t.chapter_id,
    "subject_id" = COALESCE(ci.subject_id, c.subject_id)
FROM "topics" t
JOIN "chapters" c ON t.chapter_id = c.id
WHERE ci."topic_id" = t.id
  AND ci."chapter_id" IS DISTINCT FROM t.chapter_id;
UPDATE "content_items" ci
SET "subject_id" = c.subject_id
FROM "chapters" c
WHERE ci."chapter_id" = c.id
  AND ci."subject_id" IS NULL;--> statement-breakpoint

-- 4. Backfill questions.
UPDATE "questions" q
SET "chapter_id" = t.chapter_id,
    "subject_id" = COALESCE(q.subject_id, c.subject_id)
FROM "topics" t
JOIN "chapters" c ON t.chapter_id = c.id
WHERE q."topic_id" = t.id
  AND q."chapter_id" IS DISTINCT FROM t.chapter_id;
UPDATE "questions" q
SET "subject_id" = c.subject_id
FROM "chapters" c
WHERE q."chapter_id" = c.id
  AND q."subject_id" IS NULL;--> statement-breakpoint

-- 5. Apply scope_chain constraints (leaf implies full chain; scope may be empty).
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_scope_chain" CHECK ((
        ("content_items"."topic_id" IS NOT NULL AND "content_items"."chapter_id" IS NOT NULL AND "content_items"."subject_id" IS NOT NULL)
        OR ("content_items"."topic_id" IS NULL AND "content_items"."chapter_id" IS NOT NULL AND "content_items"."subject_id" IS NOT NULL)
        OR ("content_items"."topic_id" IS NULL AND "content_items"."chapter_id" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_scope_chain" CHECK ((
        "materials"."subject_id" IS NOT NULL
        AND ("materials"."topic_id" IS NULL OR "materials"."chapter_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_scope_chain" CHECK ((
        ("questions"."topic_id" IS NOT NULL AND "questions"."chapter_id" IS NOT NULL AND "questions"."subject_id" IS NOT NULL)
        OR ("questions"."topic_id" IS NULL AND "questions"."chapter_id" IS NOT NULL AND "questions"."subject_id" IS NOT NULL)
        OR ("questions"."topic_id" IS NULL AND "questions"."chapter_id" IS NULL)
      ));