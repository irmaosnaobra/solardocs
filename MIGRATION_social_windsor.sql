-- ============================================================================
-- Aba "Redes" do /gerador — dados sociais agregados via Windsor.ai
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador IO, NÃO o SolarDoc principal)
-- Sincronizado 1x/dia pelo /cron/master → socialWindsorService.ts
-- Fonte: connectors.windsor.ai (instagram + tiktok_organic da Irmãos na Obra)
-- ============================================================================

-- ── 1) Métricas diárias por rede (uma linha por rede por dia) ───────────────
-- Alimenta os cards "ao vivo" e os gráficos de evolução (seguidores, alcance,
-- views, engajamento). UPSERT por (rede, dia) pra ser idempotente no cron.
CREATE TABLE IF NOT EXISTS social_daily (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rede          text NOT NULL,                 -- 'instagram' | 'tiktok'
  dia           date NOT NULL,
  seguidores    integer,                       -- total no dia (snapshot)
  novos_seg     integer,                        -- novos seguidores no dia
  alcance       integer,                        -- reach
  views         integer,                        -- visualizações de conteúdo
  interacoes    integer,                        -- likes+coments+shares+saves
  contas_engaj  integer,                        -- accounts engaged (só IG)
  comentarios   integer,
  compart       integer,                        -- shares
  perfil_views  integer,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rede, dia)
);

CREATE INDEX IF NOT EXISTS idx_social_daily_rede_dia ON social_daily (rede, dia DESC);

-- ── 2) Posts/vídeos individuais (ranking melhores × piores) ─────────────────
-- UPSERT por media_id; métricas evoluem ao longo do tempo (re-sync atualiza).
CREATE TABLE IF NOT EXISTS social_posts (
  media_id      text PRIMARY KEY,
  rede          text NOT NULL,                 -- 'instagram' | 'tiktok'
  tipo          text,                          -- REELS | IMAGE | CAROUSEL | VIDEO
  legenda       text,
  publicado_em  timestamptz,
  thumbnail_url text,
  permalink     text,
  likes         integer DEFAULT 0,
  comentarios   integer DEFAULT 0,
  alcance       integer DEFAULT 0,
  salvos        integer DEFAULT 0,
  compart       integer DEFAULT 0,
  views         integer DEFAULT 0,
  duracao_seg   numeric,                       -- só vídeo/TikTok
  watch_full    numeric,                       -- % que assistiu até o fim (TikTok)
  engajamento   integer DEFAULT 0,             -- soma calculada p/ ranking rápido
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_rede_eng ON social_posts (rede, engajamento DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_rede_pub ON social_posts (rede, publicado_em DESC);

-- ── 3) Audiência (quem segue / quando está online) ──────────────────────────
-- Uma linha por (rede, dimensao, rotulo). dimensao: 'idade'|'genero'|'cidade'|
-- 'pais'|'hora_online'. Substituído por completo a cada sync (DELETE+INSERT).
CREATE TABLE IF NOT EXISTS social_audience (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rede          text NOT NULL,
  dimensao      text NOT NULL,                 -- idade|genero|cidade|pais|hora_online
  rotulo        text NOT NULL,                 -- "25-34", "Female", "Uberaba", "14h"
  valor         numeric NOT NULL,              -- contagem ou % conforme dimensao
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rede, dimensao, rotulo)
);

CREATE INDEX IF NOT EXISTS idx_social_audience_rede_dim ON social_audience (rede, dimensao);

-- ── RLS: espelha leads_meta — anon SELECT/INSERT/UPDATE (public, true) ──────
-- O backend escreve com a MESMA anon/publishable key (não há service-role pro
-- gerador), então as policies precisam liberar escrita pra `public`, igual
-- leads_meta. RLS aqui não protege escrita; o segredo é a anon key não dar
-- acesso a nada sensível (são métricas públicas das redes mesmo).
ALTER TABLE social_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_audience ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_daily','social_posts','social_audience'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_anon_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_anon_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_anon_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_anon_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true)', t || '_anon_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (true)', t || '_anon_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (true) WITH CHECK (true)', t || '_anon_update', t);
    -- DELETE necessário: syncInstagramAudience apaga+reinsere a audiência a cada
    -- sync. Sem esta policy, o DELETE vira no-op silencioso (cidades viram ghost).
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (true)', t || '_anon_delete', t);
  END LOOP;
END $$;
