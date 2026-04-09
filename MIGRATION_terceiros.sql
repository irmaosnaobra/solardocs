-- Tabela de Terceiros (usada em Contrato PJ e Prestação de Serviço)
CREATE TABLE IF NOT EXISTS terceiros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT DEFAULT 'PJ' CHECK (tipo IN ('PF', 'PJ')),
  cpf_cnpj TEXT,
  endereco TEXT,
  cidade TEXT,
  uf TEXT,
  representante_nome TEXT,
  representante_cpf TEXT,
  email TEXT,
  telefone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Colunas de terceiro na tabela de documentos
ALTER TABLE documents ADD COLUMN IF NOT EXISTS terceiro_id UUID;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS terceiro_nome TEXT;
