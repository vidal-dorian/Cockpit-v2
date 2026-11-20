CREATE INDEX "acceptance_criteria_story_idx" ON "acceptance_criteria" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "cloud_launches_session_idx" ON "cloud_launches" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "cloud_launches_run_idx" ON "cloud_launches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "cloud_launches_user_idx" ON "cloud_launches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "run_steps_run_idx" ON "run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_story_idx" ON "runs" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "user_stories_ticket_idx" ON "user_stories" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "user_stories_pr_number_idx" ON "user_stories" USING btree ("pr_number");--> statement-breakpoint
CREATE INDEX "user_stories_issue_number_idx" ON "user_stories" USING btree ("issue_number");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_unprocessed_idx" ON "webhook_deliveries" USING btree ("received_at") WHERE "webhook_deliveries"."processed_at" is null;