CREATE TABLE IF NOT EXISTS wa_session_provisions (
  sales_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('provisioning', 'active', 'failed')),
  session_id uuid UNIQUE,
  last_error text,
  lease_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_session_provisions_state_idx ON wa_session_provisions(state, lease_expires_at);
