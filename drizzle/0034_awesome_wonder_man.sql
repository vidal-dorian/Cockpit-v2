ALTER TABLE "cloud_launches" ADD COLUMN "relaunch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "relaunch_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_relaunch" boolean DEFAULT false NOT NULL;