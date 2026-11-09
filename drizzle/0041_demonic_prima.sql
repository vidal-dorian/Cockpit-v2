CREATE TABLE "template_requests" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"template" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"private" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_requests" ADD CONSTRAINT "template_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;