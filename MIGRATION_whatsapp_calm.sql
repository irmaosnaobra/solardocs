-- WhatsApp atendimento tranquilo: opt-out, reply tracking, single-shot reminders
-- Aplicar no Supabase antes do deploy

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_inactive_ping_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_whatsapp_opt_out ON users(whatsapp_opt_out) WHERE whatsapp_opt_out = true;
