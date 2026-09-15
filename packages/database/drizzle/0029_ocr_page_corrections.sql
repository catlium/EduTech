-- Manual per-page OCR corrections. Keyed by (source_type, source_id, page) —
-- NOT by chunk/job — so corrections survive a re-run of the same material
-- (a retry creates a new job + chunks but addresses the same physical pages).
CREATE TABLE "ocr_page_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"corrected_text" text NOT NULL,
	"corrected_by" uuid NOT NULL,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_page_corrections" ADD CONSTRAINT "ocr_page_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ocr_page_corrections" ADD CONSTRAINT "ocr_page_corrections_page_range" CHECK ("ocr_page_corrections"."page" >= 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_page_corrections_source_page_unique" ON "ocr_page_corrections" USING btree ("source_type","source_id","page");