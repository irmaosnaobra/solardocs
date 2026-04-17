-- =============================================
-- MIGRATION: Pix payment support
-- Execute no Supabase SQL Editor
-- =============================================

-- Coluna para controlar expiração de acesso via Pix (NULL = sem expiração = assinante cartão)
ALTER TABLE users ADD COLUMN IF NOT EXISTS plano_expira_em TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_plano_expira_em ON users(plano_expira_em) WHERE plano_expira_em IS NOT NULL;
