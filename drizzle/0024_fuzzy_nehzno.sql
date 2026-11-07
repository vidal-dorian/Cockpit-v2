CREATE TABLE "catalog_writes" (
	"project_id" integer NOT NULL,
	"path" text NOT NULL,
	"sha256" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_writes" ADD CONSTRAINT "catalog_writes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_writes_project_path_idx" ON "catalog_writes" USING btree ("project_id","path");