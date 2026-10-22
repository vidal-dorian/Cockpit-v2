CREATE TABLE "history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"actor" text NOT NULL,
	"origin" text NOT NULL,
	"action" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" text NOT NULL,
	"detail" jsonb,
	CONSTRAINT "history_actor_check" CHECK ("history"."actor" in ('human', 'claude', 'github', 'system')),
	CONSTRAINT "history_origin_check" CHECK ("history"."origin" in ('ui', 'mcp', 'webhook', 'system')),
	CONSTRAINT "history_result_check" CHECK ("history"."result" in ('ok', 'error', 'refused'))
);
