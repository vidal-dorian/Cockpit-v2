ALTER TABLE "tickets" ADD COLUMN "github_issue_number" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_project_issue_idx" ON "tickets" USING btree ("project_id","github_issue_number");