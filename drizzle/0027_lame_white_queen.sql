ALTER TABLE "findings" ALTER COLUMN "commit_sha" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "github_alert_type" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "github_alert_number" integer;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "github_closed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_github_alert_idx" ON "findings" USING btree ("project_id","github_alert_type","github_alert_number");--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_github_check" CHECK (("findings"."source" = 'github') = ("findings"."github_alert_type" is not null and "findings"."github_alert_number" is not null) and ("findings"."github_alert_type" is null) = ("findings"."github_alert_number" is null));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_commit_check" CHECK ("findings"."source" = 'github' or "findings"."commit_sha" is not null);