-- Append-only enforcement: activities, messages, and ticket_messages should
-- never be updated or deleted once written. The service layer already never
-- exposes those operations; this trigger is defense-in-depth so a bug or a
-- direct DB client can't silently violate the append-only guarantee.

CREATE OR REPLACE FUNCTION reject_update_or_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed on this table', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER activities_append_only
  BEFORE UPDATE OR DELETE ON "activities"
  FOR EACH ROW EXECUTE FUNCTION reject_update_or_delete();
--> statement-breakpoint

CREATE TRIGGER messages_append_only
  BEFORE UPDATE OR DELETE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION reject_update_or_delete();
--> statement-breakpoint

CREATE TRIGGER ticket_messages_append_only
  BEFORE UPDATE OR DELETE ON "ticket_messages"
  FOR EACH ROW EXECUTE FUNCTION reject_update_or_delete();
