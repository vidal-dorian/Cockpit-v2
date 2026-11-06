ALTER TABLE "acceptance_criteria" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD COLUMN "result_run_id" integer;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_result_run_id_runs_id_fk" FOREIGN KEY ("result_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_result_check" CHECK ("acceptance_criteria"."result" in ('passed', 'failed'));