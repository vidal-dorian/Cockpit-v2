CREATE TABLE "routines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "routines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"instruction" text NOT NULL,
	"agents" jsonb NOT NULL,
	"project_ids" jsonb NOT NULL,
	"frequency" text NOT NULL,
	"hour" integer,
	"weekday" integer,
	"time_zone" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_launches" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_launches" ALTER COLUMN "story_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_launches" ALTER COLUMN "branch" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "routine_id" integer;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_story_xor_routine" CHECK (("cloud_launches"."story_id" is null) <> ("cloud_launches"."routine_id" is null));