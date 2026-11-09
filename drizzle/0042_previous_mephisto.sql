ALTER TABLE "questions" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "planned_steps" jsonb;