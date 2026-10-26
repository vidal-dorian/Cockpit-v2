CREATE TABLE "acceptance_criteria" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "acceptance_criteria_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"story_id" integer NOT NULL,
	"position" integer NOT NULL,
	"given_text" text NOT NULL,
	"when_text" text NOT NULL,
	"then_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_dependencies" (
	"story_id" integer NOT NULL,
	"depends_on_id" integer NOT NULL,
	CONSTRAINT "story_dependencies_story_id_depends_on_id_pk" PRIMARY KEY("story_id","depends_on_id"),
	CONSTRAINT "story_dependencies_not_self" CHECK ("story_dependencies"."story_id" <> "story_dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "user_stories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_stories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticket_id" integer NOT NULL,
	"position" integer NOT NULL,
	"as_a" text NOT NULL,
	"i_want" text NOT NULL,
	"so_that" text NOT NULL,
	"notes_md" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"rewrite_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_stories_status_check" CHECK ("user_stories"."status" in ('to_validate', 'to_rewrite', 'ready', 'in_progress', 'in_review', 'done', 'abandoned'))
);
--> statement-breakpoint
ALTER TABLE "history" ADD COLUMN "story_id" integer;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_story_id_user_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."user_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_dependencies" ADD CONSTRAINT "story_dependencies_story_id_user_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."user_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_dependencies" ADD CONSTRAINT "story_dependencies_depends_on_id_user_stories_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."user_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stories" ADD CONSTRAINT "user_stories_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;