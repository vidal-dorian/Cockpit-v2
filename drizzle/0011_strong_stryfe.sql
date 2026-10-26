ALTER TABLE "tickets" ADD COLUMN "stories_written_at" timestamp with time zone;--> statement-breakpoint
-- Tickets written before this column, in one call (decision 017 before row N), are closed.
UPDATE "tickets" SET "stories_written_at" = now() WHERE "id" IN (SELECT "ticket_id" FROM "user_stories");
