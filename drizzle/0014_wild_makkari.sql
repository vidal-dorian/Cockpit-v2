CREATE TABLE "write_us_routines" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"fire_url" text NOT NULL,
	"token" text NOT NULL,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_frequency" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_hour" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_weekday" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_user_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_last_run_result" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "routine_last_run_session_url" text;--> statement-breakpoint
ALTER TABLE "write_us_routines" ADD CONSTRAINT "write_us_routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_routine_user_id_users_id_fk" FOREIGN KEY ("routine_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_routine_frequency_check" CHECK ("projects"."routine_frequency" in ('off', 'on_demand', 'daily', 'weekly'));