-- ════════════════════════════════════════════════════════════
-- Sistema de código sequencial pra Proposta Solar
-- Formato: YYYYUUUUNNNN  (ex: 202600010001)
--   YYYY = ano
--   UUUU = numero sequencial do user na plataforma (4 digits)
--   NNNN = numero da proposta desse user no ano (4 digits)
-- ════════════════════════════════════════════════════════════

-- 1. Coluna numero_seq em users (atribuída no 1ª proposta gerada se faltar)
ALTER TABLE users ADD COLUMN IF NOT EXISTS numero_seq INTEGER UNIQUE;

-- 2. Coluna codigo em documents (12 dígitos, opcional pra docs antigos)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS codigo TEXT;

-- 3. Index pra lookup rápido por código no /p/:id
CREATE INDEX IF NOT EXISTS idx_documents_codigo ON documents(codigo) WHERE codigo IS NOT NULL;

-- 4. Index pra contar propostas do user no ano
CREATE INDEX IF NOT EXISTS idx_documents_user_tipo_year
  ON documents(user_id, tipo, created_at)
  WHERE tipo = 'propostaSolar';
