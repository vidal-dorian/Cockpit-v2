CREATE TABLE "code_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "code_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"criterion_id" integer NOT NULL,
	"position" integer NOT NULL,
	"path" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"commit_sha" text NOT NULL,
	CONSTRAINT "code_sources_lines_check" CHECK ("code_sources"."start_line" <= "code_sources"."end_line")
);
--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD COLUMN "reasoning" text;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD COLUMN "doubt" text;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD COLUMN "object_names" text[];--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD COLUMN "takeover_state" text;--> statement-breakpoint
ALTER TABLE "user_stories" ADD COLUMN "kind" text DEFAULT 'feature' NOT NULL;--> statement-breakpoint
ALTER TABLE "code_sources" ADD CONSTRAINT "code_sources_criterion_id_acceptance_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."acceptance_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_takeover_state_check" CHECK ("acceptance_criteria"."takeover_state" in ('pending', 'kept'));--> statement-breakpoint
ALTER TABLE "user_stories" ADD CONSTRAINT "user_stories_kind_check" CHECK ("user_stories"."kind" in ('feature', 'takeover'));