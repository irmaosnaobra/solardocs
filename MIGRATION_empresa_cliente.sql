-- Novos campos na tabela company
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS socio_adm         TEXT,
  ADD COLUMN IF NOT EXISTS engenheiro_nome   TEXT,
  ADD COLUMN IF NOT EXISTS engenheiro_cpf    TEXT,
  ADD COLUMN IF NOT EXISTS engenheiro_crea   TEXT,
  ADD COLUMN IF NOT EXISTS engenheiro_endereco TEXT,
  ADD COLUMN IF NOT EXISTS tecnico_nome      TEXT,
  ADD COLUMN IF NOT EXISTS tecnico_cpf       TEXT,
  ADD COLUMN IF NOT EXISTS tecnico_endereco  TEXT;

-- Novo campo na tabela clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS nacionalidade TEXT DEFAULT 'brasileiro(a)';
