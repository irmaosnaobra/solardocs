-- Email opt-out + reminder count para cadência decrescente
-- Aplicar no Supabase (SQL Editor) antes do deploy

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_opt_out boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_reminder_count int DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_email_opt_out ON users(email_opt_out) WHERE email_opt_out = true;
