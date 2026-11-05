ALTER TABLE "user_stories" ADD COLUMN "pr_ci_state" text;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "pr_review_state" text;--> statement-breakpoint
ALTER TABLE "user_stories" ADD CONSTRAINT "user_stories_pr_ci_state_check" CHECK ("user_stories"."pr_ci_state" in ('pending', 'success', 'failure'));--> statement-breakpoint
ALTER TABLE "user_stories" ADD CONSTRAINT "user_stories_pr_review_state_check" CHECK ("user_stories"."pr_review_state" in ('approved', 'changes_requested'));