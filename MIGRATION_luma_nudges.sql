-- Nudges da Luma quando o lead demora pra responder.
--
-- nudge_10min_at: timestamp do último envio de "Fulano, ainda está aí?"
--   disparado quando lead silenciou >10min após pergunta da Luma.
--
-- nudge_18h_at:   timestamp do último envio de "Vamos continuar a negociação?"
--   disparado uma vez ao dia às 18h pra leads que receberam algo da Luma e
--   ficaram em silêncio.

ALTER TABLE sdr_leads
  ADD COLUMN IF NOT EXISTS nudge_10min_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS nudge_18h_at   timestamptz NULL;

CREATE INDEX IF NOT EXISTS sdr_leads_nudge_10min_idx
  ON sdr_leads (aguardando_resposta, nudge_10min_at, ultimo_contato)
  WHERE aguardando_resposta = true;

CREATE INDEX IF NOT EXISTS sdr_leads_nudge_18h_idx
  ON sdr_leads (aguardando_resposta, nudge_18h_at)
  WHERE aguardando_resposta = true;

COMMENT ON COLUMN sdr_leads.nudge_10min_at IS
  'Timestamp do último nudge de 10min (Fulano, ainda está aí?). Resetar quando lead respondeu.';
COMMENT ON COLUMN sdr_leads.nudge_18h_at IS
  'Timestamp do último nudge das 18h (Vamos continuar a negociação?). Dedup diário.';
