CREATE TABLE "code_maps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "code_maps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"module_path" text NOT NULL,
	"module_name" text NOT NULL,
	"module_kind" text NOT NULL,
	"commit_sha" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_maps_module_kind_check" CHECK ("code_maps"."module_kind" in ('web', 'api', 'mobile', 'library', 'other'))
);
--> statement-breakpoint
ALTER TABLE "code_maps" ADD CONSTRAINT "code_maps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_maps_project_module_idx" ON "code_maps" USING btree ("project_id","module_path");