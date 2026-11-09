ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS webhook_id text;
ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS consented_at timestamptz;
ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_direction_check;
ALTER TABLE messages ADD CONSTRAINT messages_direction_check CHECK (direction IN ('inbound', 'outbound'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'received';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_id text;
CREATE INDEX IF NOT EXISTS conversations_retention_idx ON conversations(last_message_at) WHERE pinned = false;
