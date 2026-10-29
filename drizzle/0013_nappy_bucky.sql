ALTER TABLE "mcp_tokens" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "refresh_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "refresh_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_refresh_hash_unique" UNIQUE("refresh_hash");