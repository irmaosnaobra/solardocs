-- =============================================
-- MIGRATION: origem da venda (quem fechou: anúncio, follow-up ou direto)
--
-- Decisão de 14/08/2026: o Meta só pode receber VENDA NOVA. Venda que o
-- follow-up fechou (cupom da Giovanna, link de recuperação/dunning/winback) e
-- recompra de quem já comprou antes deixam de virar Purchase no pixel — elas
-- passam a aparecer SÓ internamente (painel) e no aviso do WhatsApp, com a
-- origem escrita por extenso pra saber de onde a pessoa chegou.
--
-- `meta_skip_motivo` guarda o PORQUÊ de não ter ido. A linha continua com
-- meta_response_ok = true (estado terminal) — senão o cron reDrivePending-
-- Purchases reenviaria amanhã justamente o que a gente decidiu não mandar.
--
-- Forward-only e aditivo: colunas nullable, venda antiga fica com origem NULL
-- (o painel mostra "—", não inventa "direto").
-- Execute no Supabase SQL Editor (projeto solardoc-pro).
-- =============================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS origem           TEXT,  -- 'anuncio' | 'followup' | 'direto'
  ADD COLUMN IF NOT EXISTS origem_detalhe   TEXT,  -- 'cupom ACESSO19', 'campanha 12025...', 'sem UTM'
  ADD COLUMN IF NOT EXISTS meta_skip_motivo TEXT;  -- NULL = foi pro Meta | 'followup' | 'recompra'

-- Agrupar venda por origem no painel (só linhas já classificadas).
CREATE INDEX IF NOT EXISTS idx_sales_origem
  ON sales(origem) WHERE origem IS NOT NULL;
