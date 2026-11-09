CREATE TABLE IF NOT EXISTS wa_sessions (
  session_id uuid PRIMARY KEY,
  sales_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES wa_sessions(session_id) ON DELETE RESTRICT,
  chat_id text NOT NULL CHECK (length(chat_id) BETWEEN 5 AND 255),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, chat_id)
);
CREATE INDEX IF NOT EXISTS conversations_session_recent_idx ON conversations(session_id, last_message_at DESC);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  gateway_id text NOT NULL CHECK (length(gateway_id) BETWEEN 1 AND 255),
  body text NOT NULL,
  sent_at timestamptz NOT NULL,
  direction text NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
  UNIQUE(conversation_id, gateway_id)
);
CREATE INDEX IF NOT EXISTS messages_conversation_time_idx ON messages(conversation_id, sent_at, id);
