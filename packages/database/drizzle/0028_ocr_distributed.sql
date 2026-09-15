-- Distributed OCR: external computation workers + page-range chunk tasks.
-- The worker registry is platform-global (NOT tenant-scoped); chunks live
-- beneath the existing `jobs` row and are tenant-scoped via `institute_id`.
CREATE TABLE "ocr_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"current_chunk_id" uuid,
	"last_heartbeat_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"version" varchar(50),
	"capabilities" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_workers_token_hash_unique" ON "ocr_workers" USING btree ("token_hash");
--> statement-breakpoint
CREATE TABLE "ocr_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"institute_id" uuid NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_page" integer NOT NULL,
	"end_page" integer NOT NULL,
	"document_pages" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"claimed_by" uuid,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_chunks" ADD CONSTRAINT "ocr_chunks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ocr_chunks" ADD CONSTRAINT "ocr_chunks_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ocr_chunks" ADD CONSTRAINT "ocr_chunks_claimed_by_ocr_workers_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."ocr_workers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ocr_chunks" ADD CONSTRAINT "ocr_chunks_page_range" CHECK ("ocr_chunks"."start_page" >= 1 AND "ocr_chunks"."end_page" >= "ocr_chunks"."start_page");
--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_chunks_job_chunk_unique" ON "ocr_chunks" USING btree ("job_id","chunk_index");
--> statement-breakpoint
CREATE INDEX "ocr_chunks_claim_idx" ON "ocr_chunks" USING btree ("status","lease_expires_at");