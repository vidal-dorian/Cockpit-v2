ALTER TABLE "user_stories" ADD COLUMN "issue_github_title" text;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "issue_github_body" text;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "issue_diverged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;