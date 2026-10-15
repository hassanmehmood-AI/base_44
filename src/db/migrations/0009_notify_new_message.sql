-- Realtime notification for the Social Media inbox: fires pg_notify after a
-- message row is committed, so the separate realtime-ws-service (see
-- scripts/realtime-ws-service) can forward a bare pointer to authorized,
-- company-scoped browser clients. Deliberately a DB trigger rather than an
-- application-code call after each insert — it can never be forgotten at a
-- future insert site, and Postgres only actually delivers a NOTIFY queued
-- inside a transaction once that transaction commits (and silently drops it
-- on rollback), which is a stronger "only after a successful write"
-- guarantee than an application-level call sitting next to the insert.
--
-- Purely additive: does not touch the existing append-only trigger from
-- 0001_append_only_triggers.sql, does not modify any row, and only ever
-- runs on INSERT (append-only already blocks UPDATE/DELETE on this table).
-- The payload is intentionally minimal (conversationId, companyId,
-- messageId) — never message body/content — the realtime path is a
-- "something changed, go re-fetch" pointer, not a message-delivery channel.

CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM conversations WHERE id = NEW.conversation_id;
  IF v_company_id IS NOT NULL THEN
    PERFORM pg_notify(
      'social_messages',
      json_build_object(
        'conversationId', NEW.conversation_id,
        'companyId', v_company_id,
        'messageId', NEW.id
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER messages_notify_insert
  AFTER INSERT ON "messages"
  FOR EACH ROW EXECUTE FUNCTION notify_new_message();
