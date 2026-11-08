CREATE TABLE "queue_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "queue_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"story_id" integer NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_items_story_id_unique" UNIQUE("story_id")
);
--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "from_queue" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "queue_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "queue_paused_reason" text;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_story_id_user_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."user_stories"("id") ON DELETE no action ON UPDATE no action;