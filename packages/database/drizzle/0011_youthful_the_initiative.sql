CREATE TABLE "practice_session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_key" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"prompt" text NOT NULL,
	"reveal" text,
	"question_type" varchar(30),
	"payload" jsonb NOT NULL,
	CONSTRAINT "practice_session_items_unique" UNIQUE("session_id","source_key")
);
--> statement-breakpoint
CREATE TABLE "practice_session_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_item_id" uuid NOT NULL,
	"answer" jsonb,
	"rating" varchar(20),
	"is_correct" boolean,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_session_responses_unique" UNIQUE("session_item_id")
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"mode" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'IN_PROGRESS' NOT NULL,
	"content_id" uuid,
	"topic_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "practice_session_items" ADD CONSTRAINT "practice_session_items_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_session_responses" ADD CONSTRAINT "practice_session_responses_session_item_id_practice_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."practice_session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;