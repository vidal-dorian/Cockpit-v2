CREATE FUNCTION history_refuse_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'history is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER history_no_update_delete BEFORE UPDATE OR DELETE ON "history" FOR EACH ROW EXECUTE FUNCTION history_refuse_change();
--> statement-breakpoint
CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON "history" FOR EACH STATEMENT EXECUTE FUNCTION history_refuse_change();
