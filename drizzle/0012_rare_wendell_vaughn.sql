ALTER TABLE "history" ADD COLUMN "github_effects" jsonb;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "issue_number" integer;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "issue_body_hash" text;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "issue_claimed_at" timestamp with time zone;