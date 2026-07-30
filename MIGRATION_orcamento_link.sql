-- ════════════════════════════════════════════════════════════════════════════
-- Orçamento de 1 página com link compartilhável — Solar e Eletroposto
--
-- O orçamento do eletroposto passa a viver na MESMA tabela `propostas` do solar.
-- Não é preguiça: é o que faz o link, a expiração de 7 dias (get_proposta_pub),
-- o rastreio de abertura (registrar_acesso_ev + proposta_acessos), o contador de
-- acessos e o histórico funcionarem nos dois produtos sem duplicar nada.
--
-- Todas as colunas específicas de solar (kwp, geracao_kwh, telhado, fase,
-- inversor, qtd_inversor, qtd_placas) já são NULLABLE, então a linha de
-- eletroposto entra com elas vazias e o `dados` jsonb carrega o resto.
--
-- Migração ADITIVA: nenhuma linha existente muda de comportamento — todas as
-- propostas de hoje viram tipo='solar' pelo DEFAULT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Discriminador de produto. 'solar' | 'eletroposto'
ALTER TABLE propostas
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'solar';

-- 2. Só os dois valores que o front sabe renderizar entram — linha com tipo
--    inventado quebraria o viewer na frente do cliente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'propostas_tipo_check'
  ) THEN
    ALTER TABLE propostas
      ADD CONSTRAINT propostas_tipo_check CHECK (tipo IN ('solar', 'eletroposto'));
  END IF;
END $$;

-- 3. O histórico e o CRM filtram por tipo em toda listagem.
CREATE INDEX IF NOT EXISTS idx_propostas_tipo_created
  ON propostas (tipo, created_at DESC);
