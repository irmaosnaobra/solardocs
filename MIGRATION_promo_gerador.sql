-- Promo Gerador de Proposta — broadcast one-shot pros users plano=free
-- (27/05/2026 06:50 BRT). Idempotente via promo_gerador_sent_at.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS promo_gerador_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_promo_gerador_pending
  ON users(plano)
  WHERE promo_gerador_sent_at IS NULL
    AND plano = 'free'
    AND whatsapp IS NOT NULL
    AND whatsapp_opt_out IS NOT TRUE;
