-- Adiciona card_message_id em sdr_leads pra permitir DELETE do card antigo
-- antes de reenviar versão atualizada (evita acúmulo no grupo de consultores).
-- Z-API retorna messageId no envio; armazenamos pra usar no DELETE /messages.

ALTER TABLE sdr_leads
  ADD COLUMN IF NOT EXISTS card_message_id text NULL;

COMMENT ON COLUMN sdr_leads.card_message_id IS
  'Z-API messageId do último card enviado pro grupo. Usado pra deletar antes de reenviar.';
