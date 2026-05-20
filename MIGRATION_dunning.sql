-- Dunning de inadimplência (cobrança falhada) — 7 dias de tolerância com avisos
-- email + WhatsApp em D0/D2/D4/D6, suspensão soft no D7.
-- billing_status fica SEPARADO de plano (plano intocado durante dunning) pra
-- restauração trivial quando o cliente paga: só limpa billing_status='active'.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS billing_status         TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS past_due_since         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dunning_last_day_sent  INT;

-- billing_status valores: 'active' | 'past_due' | 'suspended'
--   active     → tudo normal
--   past_due   → cobrança falhou, ainda dentro dos 7 dias de tolerância (acesso liberado)
--   suspended  → 7 dias se passaram sem pagamento (acesso bloqueado, deixa entrar só
--                em /conta pra atualizar cartão; Stripe Smart Retries continua tentando)
--
-- past_due_since         → carimbado UMA vez por invoice.payment_failed, intocado por
--                          subscription.updated (idempotência: evita reset do relógio)
-- dunning_last_day_sent  → último dia (0/2/4/6/7) cuja notificação já foi enviada,
--                          NULL = nenhuma. Garante idempotência do cron diário.

CREATE INDEX IF NOT EXISTS idx_users_past_due_since
  ON users (past_due_since)
  WHERE past_due_since IS NOT NULL;
