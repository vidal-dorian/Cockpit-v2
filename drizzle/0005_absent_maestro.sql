CREATE TABLE "instance_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"public_url" text NOT NULL,
	"github_app_id" text NOT NULL,
	"github_app_slug" text NOT NULL,
	"github_client_id" text NOT NULL,
	"github_client_secret" text NOT NULL,
	"github_private_key" text NOT NULL,
	"github_webhook_secret" text NOT NULL,
	"admin_claim_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_single_row" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;