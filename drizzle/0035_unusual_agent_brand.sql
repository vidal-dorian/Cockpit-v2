ALTER TABLE "cloud_launches" ADD COLUMN "cost_usd" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "budget_usd" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "budget_run_usd" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "budget_night_usd" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "budget_month_usd" double precision;