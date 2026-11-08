CREATE TABLE "cloud_launchers" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"fire_url" text NOT NULL,
	"token" text NOT NULL,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_launches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cloud_launches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"story_id" integer NOT NULL,
	"branch" text NOT NULL,
	"team" text,
	"comment" text,
	"result" text,
	"session_id" text,
	"session_url" text,
	"reason" text,
	"run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "in_launcher" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_launchers" ADD CONSTRAINT "cloud_launchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_story_id_user_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."user_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;