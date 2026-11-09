-- Decision 078 D, the one exception to 010 A: the trigger lets a DELETE through only while erase_account_history runs. The setting is transaction-local (set_config(..., true)), so it is off again when the function returns and nothing is disabled globally. UPDATE and TRUNCATE stay refused.
-- shortcut: any role of the connection can set cockpit.erasing itself; with a restricted app role at a host (decisions 008 and 010), make erase_account_history SECURITY DEFINER SET search_path = public, owned by a role with DELETE on history, and have the trigger check that role instead.
CREATE OR REPLACE FUNCTION history_refuse_change() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' AND current_setting('cockpit.erasing', true) = 'on' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'history is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION erase_account_history(p_user_id integer, p_project_ids integer[]) RETURNS void AS $$
BEGIN
	PERFORM set_config('cockpit.erasing', 'on', true);
	DELETE FROM history WHERE user_id = p_user_id OR project_id = ANY(p_project_ids);
	PERFORM set_config('cockpit.erasing', 'off', true);
	INSERT INTO history (actor, origin, action, args, result) VALUES ('system', 'system', 'account_deleted', '{}', 'ok');
END;
$$ LANGUAGE plpgsql;
