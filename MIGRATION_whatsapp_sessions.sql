CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      VARCHAR(30) UNIQUE NOT NULL,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  messages   JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone ON whatsapp_sessions(phone);
