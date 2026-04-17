-- =============================================
-- MIGRATION: Analytics — source column + simulador funnel
-- Execute no Supabase SQL Editor
-- =============================================

-- Adiciona coluna source em quiz_events (quiz | simulador)
ALTER TABLE quiz_events ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL;

-- Índice para filtrar por fonte rapidamente
CREATE INDEX IF NOT EXISTS idx_quiz_events_source ON quiz_events(source);
CREATE INDEX IF NOT EXISTS idx_quiz_events_created_at ON quiz_events(created_at DESC);
