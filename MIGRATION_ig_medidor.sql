-- ============================================================================
-- Medidor do Instagram @irmaosnaobra__ (23/11/2026)
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador IO, NAO o SolarDoc principal)
-- Coletado 1x/dia (06h de Brasilia) pelo /cron/master -> api/src/services/instagram/igMedidor.ts
-- Interruptor na API: IG_MEDIDOR_LIGADO ('1' ou 'true').
-- So CREATE TABLE IF NOT EXISTS e indices: nada de DROP nem ALTER em tabela existente.
-- ATENCAO: este arquivo NAO prova que a migration rodou. Confira com sonda (select nas duas tabelas).
-- ============================================================================

-- 1) Uma linha por post por dia de coleta (o historico mostra como o post evolui).
CREATE TABLE IF NOT EXISTS ig_metricas_post (
  media_id           text        NOT NULL,
  coletado_em        date        NOT NULL,            -- dia da coleta em America/Sao_Paulo
  conta              text,                            -- id da conta do Instagram
  tipo               text,                            -- REELS | CAROUSEL_ALBUM | IMAGE | VIDEO | STORY
  publicado_em       timestamptz,
  legenda            text,
  permalink          text,
  reach              integer,                         -- null = a Meta nao devolve a metrica para este tipo
  views              integer,
  likes              integer,
  comments           integer,
  saved              integer,
  shares             integer,
  follows            integer,
  profile_visits     integer,
  total_interactions integer,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, coletado_em)
);

CREATE INDEX IF NOT EXISTS idx_ig_metricas_post_dia      ON ig_metricas_post (coletado_em DESC);
CREATE INDEX IF NOT EXISTS idx_ig_metricas_post_conta_pub ON ig_metricas_post (conta, publicado_em DESC);

-- 2) Uma linha por dia da conta.
CREATE TABLE IF NOT EXISTS ig_metricas_conta (
  conta         text        NOT NULL,
  dia           date        NOT NULL,
  seguidores    integer,
  ganho_dia     integer,                              -- seguidores de hoje menos o ultimo dia gravado; null sem dia anterior
  posts         integer,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conta, dia)
);

CREATE INDEX IF NOT EXISTS idx_ig_metricas_conta_dia ON ig_metricas_conta (conta, dia DESC);

-- 3) RLS ligada e SEM policy: so a service_role (a API) le e escreve. O anon nao enxerga nada.
ALTER TABLE ig_metricas_post  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_metricas_conta ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
