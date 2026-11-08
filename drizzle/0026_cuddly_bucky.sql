CREATE TABLE "findings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'claude' NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"severity" text NOT NULL,
	"effort" text,
	"status" text DEFAULT 'open' NOT NULL,
	"ticket_id" integer,
	"dismiss_reason" text,
	"commit_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_ticket_check" CHECK (("findings"."status" = 'ticketed') = ("findings"."ticket_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "code_sources" ALTER COLUMN "criterion_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "code_sources" ADD COLUMN "finding_id" integer;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_project_idx" ON "findings" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "code_sources" ADD CONSTRAINT "code_sources_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_sources_finding_idx" ON "code_sources" USING btree ("finding_id");--> statement-breakpoint
ALTER TABLE "code_sources" ADD CONSTRAINT "code_sources_owner_check" CHECK (("code_sources"."criterion_id" is null) <> ("code_sources"."finding_id" is null));