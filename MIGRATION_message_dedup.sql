-- Dedup de mensagens recebidas pra evitar processar 2x
-- (webhook Z-API redelivery + race entre webhook e polling).
-- A chave é INSERT com UNIQUE — primeiro a inserir vence, segundos retornam erro 23505 e são puladrs.

CREATE TABLE IF NOT EXISTS sdr_message_dedup (
  message_id   text        PRIMARY KEY,
  phone        text        NULL,
  source       text        NULL,            -- 'webhook' | 'poll'
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sdr_message_dedup_phone_processed_idx
  ON sdr_message_dedup (phone, processed_at DESC);

CREATE INDEX IF NOT EXISTS sdr_message_dedup_processed_at_idx
  ON sdr_message_dedup (processed_at);

COMMENT ON TABLE sdr_message_dedup IS
  'Dedup atômico de mensagens recebidas. Webhook insere whk:<messageId>; polling insere poll:<phone>:<lastMessageTime>. Cleanup via cron remove entradas > 7 dias.';
