CREATE INDEX "code_sources_criterion_idx" ON "code_sources" USING btree ("criterion_id");--> statement-breakpoint
CREATE INDEX "code_sources_commit_path_idx" ON "code_sources" USING btree ("commit_sha","path");--> statement-breakpoint
ALTER TABLE "code_sources" ADD CONSTRAINT "code_sources_start_check" CHECK ("code_sources"."start_line" >= 1);