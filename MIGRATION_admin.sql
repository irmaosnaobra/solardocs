-- Adiciona campo admin na tabela users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Ativa admin para o seu email (substitua pelo seu email)
UPDATE users
SET is_admin = true, plano = 'ilimitado', limite_documentos = 999999
WHERE email = 'SEU_EMAIL_AQUI';
