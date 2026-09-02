CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"subject_id" uuid,
	"chapter_id" uuid,
	"topic_id" uuid,
	"stem" text NOT NULL,
	"question_type" varchar(30) NOT NULL,
	"difficulty" varchar(20) DEFAULT 'MEDIUM' NOT NULL,
	"explanation" text,
	"payload" jsonb NOT NULL,
	"source" varchar(20) DEFAULT 'MANUAL' NOT NULL,
	"approval_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_exactly_one_scope" CHECK ((("questions"."subject_id" IS NOT NULL)::int + ("questions"."chapter_id" IS NOT NULL)::int + ("questions"."topic_id" IS NOT NULL)::int) = 1)
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;