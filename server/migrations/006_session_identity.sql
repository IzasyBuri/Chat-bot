-- Replacing a gateway session must keep conversation history attached to the
-- sales account, so the conversation foreign key follows the identity update.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_session_id_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES wa_sessions(session_id) ON UPDATE CASCADE ON DELETE RESTRICT;
