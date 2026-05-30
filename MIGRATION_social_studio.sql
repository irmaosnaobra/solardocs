-- ============================================================================
-- Estúdio de conteúdo (aba Redes do /gerador) — fila de produção de vídeos
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador IO)
-- Cada linha = um item de conteúdo que percorre TODOS os estágios:
--   ideia → roteirizado → video_pronto → aprovado → postado | descartado
-- As integrações ainda bloqueadas (Ad Library, HeyGen) só PREENCHEM colunas
-- quando ligarem — a estrutura já está pronta pra recebê-las.
-- ============================================================================

CREATE TABLE IF NOT EXISTS social_studio (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- origem do tema
  fonte         text NOT NULL DEFAULT 'manual',  -- 'ad_library' | 'manual' | 'curadoria'
  fonte_url     text,                            -- link do vídeo viral (bate-pronto) ou anúncio
  tema          text,                            -- assunto-isca resumido
  -- roteiro gerado pela IA
  arquetipo     text,                            -- 'fernando' | 'larcabral' | 'lucas'
  gancho        text,                            -- primeira frase (3s)
  roteiro       text,                            -- corpo do roteiro
  legenda       text,                            -- legenda pronta + hashtags
  cta           text,                            -- ex: "comenta SOLAR que te mando o cálculo"
  -- vídeo (HeyGen) — preenchido quando a integração existir
  video_url     text,
  video_status  text DEFAULT 'pendente',         -- pendente | gerando | pronto | erro
  -- fluxo de aprovação
  status        text NOT NULL DEFAULT 'ideia',   -- ideia|roteirizado|video_pronto|aprovado|postado|descartado
  -- onde já foi postado (controle do repurposing manual)
  postado_ig    boolean DEFAULT false,
  postado_tt    boolean DEFAULT false,
  postado_yt    boolean DEFAULT false,
  postado_fb    boolean DEFAULT false,
  postado_kw    boolean DEFAULT false,
  -- metadados
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_studio_status ON social_studio (status, criado_em DESC);

-- RLS espelhando leads_meta/social_*: anon SELECT/INSERT/UPDATE/DELETE (public, true).
-- Backend e front usam a MESMA anon key; conteúdo não é sensível.
ALTER TABLE social_studio ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS social_studio_anon_select ON social_studio;
  DROP POLICY IF EXISTS social_studio_anon_insert ON social_studio;
  DROP POLICY IF EXISTS social_studio_anon_update ON social_studio;
  DROP POLICY IF EXISTS social_studio_anon_delete ON social_studio;
  CREATE POLICY social_studio_anon_select ON social_studio FOR SELECT USING (true);
  CREATE POLICY social_studio_anon_insert ON social_studio FOR INSERT WITH CHECK (true);
  CREATE POLICY social_studio_anon_update ON social_studio FOR UPDATE USING (true) WITH CHECK (true);
  CREATE POLICY social_studio_anon_delete ON social_studio FOR DELETE USING (true);
END $$;
