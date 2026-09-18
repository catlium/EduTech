-- Material Intelligence (Phase A): versioned, derived enhanced material.
-- `materials.text_content` stays the untouched raw extraction; each enhancement
-- row is an append-only derivation carrying the exact raw fingerprint
-- (source_revision + source_text_hash) it was computed from, so re-running the
-- same raw is idempotent and every version is auditable.
CREATE TABLE "material_enhancements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"trigger" varchar(30) NOT NULL,
	"source_revision" integer NOT NULL,
	"source_text_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"alignment" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_enhancements_material_version_unique" UNIQUE("material_id","version")
);
--> statement-breakpoint
ALTER TABLE "material_enhancements" ADD CONSTRAINT "material_enhancements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_enhancements" ADD CONSTRAINT "material_enhancements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;