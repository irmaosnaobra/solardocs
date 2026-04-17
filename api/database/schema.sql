-- Tabela users
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  plano             VARCHAR(20) NOT NULL DEFAULT 'free',
  documentos_usados INTEGER NOT NULL DEFAULT 0,
  limite_documentos INTEGER NOT NULL DEFAULT 10,
  data_reset        TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Tabela company
CREATE TABLE IF NOT EXISTS company (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  nome     VARCHAR(255) NOT NULL,
  cnpj     VARCHAR(18) UNIQUE NOT NULL,
  endereco TEXT
);

-- Tabela clients
CREATE TABLE IF NOT EXISTS clients (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  nome      VARCHAR(255) NOT NULL,
  cpf_cnpj  VARCHAR(18),
  endereco  TEXT,
  cep       VARCHAR(9)
);

-- Tabela documents
CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  tipo         VARCHAR(50) NOT NULL,
  cliente_id   UUID REFERENCES clients(id),
  cliente_nome VARCHAR(255),
  dados_json   JSONB,
  content      TEXT,
  modelo_usado VARCHAR(50),
  status       VARCHAR(20) DEFAULT 'draft',
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Colunas Autentique (assinatura digital)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS arquivo_url        TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS autentique_doc_id  TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS assinatura_status  VARCHAR(20) DEFAULT 'nenhuma';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS assinado_em        TIMESTAMP;

-- Tabela suggestions (fórum VIP)
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

-- Índices
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_company_user_id ON company(user_id);

-- Função de reset mensal PRO
CREATE OR REPLACE FUNCTION reset_documentos_pro()
RETURNS void AS $$
BEGIN
  UPDATE users
  SET documentos_usados = 0, data_reset = NOW() + INTERVAL '1 month'
  WHERE plano = 'pro' AND data_reset <= NOW();
END;
$$ LANGUAGE plpgsql;
