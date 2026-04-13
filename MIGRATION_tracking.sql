-- =============================================
-- MIGRATION: Landing Page Tracking
-- Execute no Supabase SQL Editor
-- =============================================

-- Tabela de visitas à landing page
CREATE TABLE IF NOT EXISTS page_visits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  referrer     TEXT,
  landing_url  TEXT,
  user_agent   TEXT,
  ip           TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de eventos granulares (scroll, seções, cliques, tempo)
CREATE TABLE IF NOT EXISTS lp_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  event_type  TEXT NOT NULL,  -- 'scroll' | 'section' | 'cta_click' | 'time_on_page'
  event_data  JSONB,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_page_visits_created_at ON page_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_visits_session    ON page_visits(session_id);
CREATE INDEX IF NOT EXISTS idx_lp_events_session      ON lp_events(session_id);
CREATE INDEX IF NOT EXISTS idx_lp_events_type         ON lp_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lp_events_created_at   ON lp_events(created_at DESC);
