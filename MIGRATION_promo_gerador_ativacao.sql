-- Promo Gerador — ativação automática de 10 créditos via Dani
-- (response handler do WhatsApp detecta e-mail na msg do user e ativa).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS promo_gerador_creditos_em timestamptz,
  ADD COLUMN IF NOT EXISTS promo_gerador_email_capturado text;

CREATE INDEX IF NOT EXISTS idx_users_promo_gerador_ativados
  ON users(promo_gerador_creditos_em)
  WHERE promo_gerador_creditos_em IS NOT NULL;
