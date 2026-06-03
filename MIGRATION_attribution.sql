-- =============================================
-- MIGRATION: Atribuição UTM → Stripe (receita por campanha)
-- Liga o session_id da LP (sd_lp_session) + UTMs à conta paga.
-- Forward-only: só vale pra checkouts feitos APÓS rodar esta migração.
-- Todas as colunas são nullable → fluxo sem UTM continua igual (aditivo).
-- Execute no Supabase SQL Editor (projeto SolarDoc).
-- =============================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS utm_source             TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium             TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign           TEXT,
  ADD COLUMN IF NOT EXISTS utm_content            TEXT,
  ADD COLUMN IF NOT EXISTS utm_term               TEXT,
  ADD COLUMN IF NOT EXISTS checkout_session_id    TEXT,         -- id da Checkout Session do Stripe
  ADD COLUMN IF NOT EXISTS attribution_session_id TEXT,         -- sd_lp_session (session_id da landing)
  ADD COLUMN IF NOT EXISTS attribution_captured_at TIMESTAMP WITH TIME ZONE;

-- Índice pra agrupar receita por campanha (só linhas atribuídas).
CREATE INDEX IF NOT EXISTS idx_users_utm_campaign
  ON users(utm_campaign) WHERE utm_campaign IS NOT NULL;

-- Índice pra filtrar por janela de atribuição no endpoint /admin/revenue.
CREATE INDEX IF NOT EXISTS idx_users_attribution_captured_at
  ON users(attribution_captured_at) WHERE attribution_captured_at IS NOT NULL;
