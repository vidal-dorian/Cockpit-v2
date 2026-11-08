CREATE TABLE "night_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "night_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"night_id" integer NOT NULL,
	"story_id" integer NOT NULL,
	"position" integer NOT NULL,
	"run_id" integer,
	"outcome" text,
	CONSTRAINT "night_items_outcome_check" CHECK ("night_items"."outcome" in ('pr', 'paused', 'ci_failed', 'failed', 'skipped', 'not_started'))
);
--> statement-breakpoint
CREATE TABLE "nights" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "nights_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "nights_status_check" CHECK ("nights"."status" in ('planned', 'running', 'finished', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_status_check";--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "night_item_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "night_start_hour" integer DEFAULT 22 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "night_end_hour" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "night_time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "night_items" ADD CONSTRAINT "night_items_night_id_nights_id_fk" FOREIGN KEY ("night_id") REFERENCES "public"."nights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_items" ADD CONSTRAINT "night_items_story_id_user_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."user_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_items" ADD CONSTRAINT "night_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nights" ADD CONSTRAINT "nights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nights_one_open_per_user_idx" ON "nights" USING btree ("user_id") WHERE "nights"."status" in ('planned', 'running');--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_night_item_id_night_items_id_fk" FOREIGN KEY ("night_item_id") REFERENCES "public"."night_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('running', 'succeeded', 'failed', 'stopped', 'closed_manually', 'paused'));