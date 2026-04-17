-- Migration: Modelo freemium — 10 documentos gratuitos vitalícios
-- Executa no Supabase SQL Editor

-- 1. Corrige todos os usuários free com limite antigo (1 ou 3)
UPDATE users
SET limite_documentos = 10
WHERE plano = 'free'
  AND limite_documentos < 10;

-- 2. Garante que trial_expires_at seja null para todos os free (remove lógica de expiração)
UPDATE users
SET trial_expires_at = NULL
WHERE plano = 'free';

-- 3. Atualiza o DEFAULT da coluna para novos cadastros
ALTER TABLE users
ALTER COLUMN limite_documentos SET DEFAULT 10;

-- Verificação: mostra resultado
SELECT plano, limite_documentos, COUNT(*) as total
FROM users
GROUP BY plano, limite_documentos
ORDER BY plano;
