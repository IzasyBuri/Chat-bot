ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS verified_phone text;
ALTER TABLE wa_sessions DROP CONSTRAINT IF EXISTS wa_sessions_verified_phone_check;
ALTER TABLE wa_sessions ADD CONSTRAINT wa_sessions_verified_phone_check
  CHECK (verified_phone IS NULL OR verified_phone ~ '^[0-9]{5,15}$');
