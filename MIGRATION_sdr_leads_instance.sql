-- Adiciona coluna `instance` em sdr_leads para identificar qual linha Z-API atendeu o lead.
-- 'solardoc' = linha B2B (Carla/SolarDoc) — default histórico
-- 'io'       = linha B2C (Luma/Irmãos na Obra)
-- Isto permite que o follow-up use a linha correta pra cada lead.

ALTER TABLE sdr_leads
  ADD COLUMN IF NOT EXISTS instance text NOT NULL DEFAULT 'solardoc';

CREATE INDEX IF NOT EXISTS idx_sdr_leads_instance ON sdr_leads (instance);
