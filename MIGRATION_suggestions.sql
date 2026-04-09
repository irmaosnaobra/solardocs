-- Migration: tabela de sugestões VIP
CREATE TABLE IF NOT EXISTS suggestions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  titulo         VARCHAR(255) NOT NULL,
  descricao      TEXT NOT NULL,
  arquivo_nome   VARCHAR(255),
  arquivo_base64 TEXT,
  status         VARCHAR(30) NOT NULL DEFAULT 'recebido',
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suggestions_user_id ON suggestions(user_id);
