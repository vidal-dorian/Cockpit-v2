ALTER TABLE "project_members" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" text DEFAULT 'dark' NOT NULL;