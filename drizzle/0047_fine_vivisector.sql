CREATE TABLE "project_invitations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_invitations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"role" text NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_invitations_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "project_members" DROP CONSTRAINT "project_members_role_check";--> statement-breakpoint
DROP INDEX "project_members_project_id_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_invitations_invitee_idx" ON "project_invitations" USING btree ("project_id","github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_owner_idx" ON "project_members" USING btree ("project_id") WHERE "project_members"."role" = 'owner';--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_role_check" CHECK ("project_members"."role" in ('owner', 'can_launch', 'can_validate', 'read_only'));