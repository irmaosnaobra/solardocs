-- Manutenção preventiva (SolarDoc): relatório de campo com checklist, fotos e assinaturas.
-- Aplicar no Supabase antes de usar a tela /manutencao. Só cria tabela nova.
CREATE TABLE IF NOT EXISTS manutencoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cliente_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  cliente_nome   VARCHAR(255),
  codigo         VARCHAR(16),
  status         VARCHAR(20) NOT NULL DEFAULT 'em_andamento',  -- em_andamento | concluida
  selo           VARCHAR(20),                                   -- conforme | atencao | nao_conforme (gravado ao concluir)
  data_inspecao  DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date),
  proxima_visita DATE,
  dados          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- formulário, dono é o cliente (PUT substitui)
  fotos          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- dono é o servidor: { grupo: [{path, ts}] }
  assinaturas    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- dono é o servidor: { tecnico: {path,nome,registro,ts}, cliente: {path,nome,ts} }
  concluida_em   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_manutencoes_user_codigo ON manutencoes(user_id, codigo) WHERE codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manutencoes_user_created ON manutencoes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manutencoes_user_proxima ON manutencoes(user_id, proxima_visita) WHERE status = 'concluida';
-- RLS ligado e sem policy: só a service key do backend lê e escreve (a anon key não enxerga).
ALTER TABLE manutencoes ENABLE ROW LEVEL SECURITY;
