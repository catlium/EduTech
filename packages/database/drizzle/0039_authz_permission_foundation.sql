-- Phase B — Permission System foundation (D2/§14 + D3/§15).
-- Centralized catalogue mirror + role/grant storage for the authorization
-- overhaul. Data is seeded by the API's PermissionSyncService at boot (never
-- by this migration).
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"domain" varchar(20) NOT NULL,
	"resource" varchar(50) NOT NULL,
	"action" varchar(20) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key"),
	CONSTRAINT "permissions_resource_action_unique" UNIQUE("resource","action")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"kind" varchar(20) NOT NULL,
	"domain" varchar(20) NOT NULL,
	"institute_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_kind_check" CHECK ("kind" IN ('system', 'institute')),
	CONSTRAINT "roles_domain_check" CHECK ("domain" IN ('institute', 'platform')),
	CONSTRAINT "roles_institute_kind_domain_check" CHECK (NOT ("kind" = 'institute' AND "domain" <> 'institute')),
	CONSTRAINT "roles_platform_kind_check" CHECK (NOT ("domain" = 'platform' AND "kind" <> 'system')),
	CONSTRAINT "roles_institute_owner_check" CHECK (NOT ("kind" = 'institute' AND "institute_id" IS NULL)),
	CONSTRAINT "roles_system_owner_check" CHECK (NOT ("kind" = 'system' AND "institute_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "platform_user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE INDEX "roles_key_idx" ON "roles" ("key");
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_unique" ON "roles" ("key") WHERE kind = 'system';
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_institute_key_unique" ON "roles" ("institute_id","key") WHERE kind = 'institute';
--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" ("permission_id");
--> statement-breakpoint
CREATE INDEX "platform_user_roles_role_idx" ON "platform_user_roles" ("role_id");
--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_user_roles" ADD CONSTRAINT "platform_user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_user_roles" ADD CONSTRAINT "platform_user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;