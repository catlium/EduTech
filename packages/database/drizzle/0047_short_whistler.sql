CREATE TABLE "institute_subscriptions" (
	"institute_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "institutes" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "institute_subscriptions" ADD CONSTRAINT "institute_subscriptions_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institute_subscriptions" ADD CONSTRAINT "institute_subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutes" ADD CONSTRAINT "institutes_status_check" CHECK ("institutes"."status" IN ('active', 'deactivated'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" IN ('active', 'deactivated'));--> statement-breakpoint
-- Platform plan catalog seed (starter/growth/institute). Idempotent: exists
-- only when missing, so re-runs and populated DBs are safe.
INSERT INTO "plans" ("code", "name", "description", "is_active")
VALUES
  ('starter', 'Starter', 'Getting-started plan for small institutes.', true),
  ('growth', 'Growth', 'Expanding institutes with more capacity.', true),
  ('institute', 'Institute', 'Full-facility institutes.', true)
ON CONFLICT ("code") DO NOTHING;