CREATE TABLE "workflow_proposals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_proposals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"path" text NOT NULL,
	"reason" text NOT NULL,
	"before" text,
	"content" text NOT NULL,
	"decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_launches" DROP CONSTRAINT "cloud_launches_story_xor_routine";--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD COLUMN "workflow_path" text;--> statement-breakpoint
ALTER TABLE "workflow_proposals" ADD CONSTRAINT "workflow_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_proposals_pending" ON "workflow_proposals" USING btree ("project_id","path") WHERE "workflow_proposals"."decision" is null;--> statement-breakpoint
ALTER TABLE "cloud_launches" ADD CONSTRAINT "cloud_launches_one_target" CHECK (num_nonnulls("cloud_launches"."story_id", "cloud_launches"."routine_id", "cloud_launches"."workflow_path") = 1);