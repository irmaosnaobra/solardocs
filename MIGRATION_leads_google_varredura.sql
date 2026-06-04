-- ============================================================================
-- Varredura estadual de leads (Google Places) — job resumível browser-driven
-- Projeto Supabase: qdpfwncyzuztibpujlbq (SolarDoc principal)
-- Tela: /admin/leads-google  ·  Backend: api/src/routes/admin.ts
-- Aplicada em: 2026-06-04 (via Supabase MCP, migration "leads_google_varredura")
--
-- A Google Places Text Search devolve no máx ~60 leads (3 páginas) por termo.
-- Pra passar disso a varredura roda {categoria} {município} {UF} em CADA cidade
-- da UF (lista do IBGE), deduplicando por place_id e empilhando numa "busca" só.
-- Como a API é serverless (300s) atrás do proxy /_api, a varredura é um job:
-- a LINHA é o estado do worker, cada /tick processa uma fatia de municípios,
-- e a ABA aberta chama /tick em loop até terminar. Estas colunas guardam o
-- cursor (municipios_processados), o lease lock e a flag de cancelamento.
-- ============================================================================

-- ── 1) Limpar duplicatas pré-existentes ANTES do índice único ───────────────
-- Sem isto, o CREATE UNIQUE INDEX abaixo falha se já houver (search_id, place_id)
-- repetido. place_id é NOT NULL (sem edge case de NULL). Mantém a linha mais
-- antiga de cada par. (Conferido 2026-06-04: 0 duplicatas — rodou como no-op.)
DELETE FROM google_leads WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY search_id, place_id ORDER BY criado_em, id
    ) AS rn
    FROM google_leads
  ) t WHERE rn > 1
);

-- ── 2) Colunas de job em google_lead_searches ───────────────────────────────
-- status continua TEXT (não enum): linhas legadas usam 'concluido'. Estados da
-- varredura: 'rodando' | 'concluido' | 'parado' | 'erro'.
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS uf text;
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS categoria text;
-- progresso + cursor (municipios_processados = índice na lista IBGE ordenada por id)
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS municipios_total int NOT NULL DEFAULT 0;
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS municipios_processados int NOT NULL DEFAULT 0;
-- requests à Google (≠ leads: conta dupes/páginas vazias). ÚNICO contador que ACUMULA.
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS requests_feitos int NOT NULL DEFAULT 0;
-- lease lock: claim atômico impede 2 abas / cron dirigirem o mesmo job
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS locked_until timestamptz;
-- botão Parar: tick checa a flag e finaliza como 'parado'
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS cancelar boolean NOT NULL DEFAULT false;
-- municípios que falharam mesmo após retry (não bloqueiam o cursor): [{id,nome}]
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS falhas jsonb NOT NULL DEFAULT '[]'::jsonb;
-- blips do IBGE: 3 consecutivos sem avançar → status 'erro'
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS falhas_consecutivas int NOT NULL DEFAULT 0;
-- 'single' (busca rápida, legado) | 'varredura' (estadual). Buscas antigas = 'single'.
ALTER TABLE google_lead_searches ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'single';

-- total_resultados / com_telefone já existem e passam a ser RECOMPUTADOS por
-- count a cada tick (idempotente em retry) — não precisam de coluna nova.

-- ── 3) Índice único pra dedup entre fatias ──────────────────────────────────
-- O dedup não pode ser Set em memória (morre entre invocações serverless).
-- O tick faz upsert ignoreDuplicates contra este índice.
CREATE UNIQUE INDEX IF NOT EXISTS google_leads_search_place_uidx
  ON google_leads (search_id, place_id);
