-- ════════════════════════════════════════════════════════════
-- URL pública padronizada por empresa: {slug}.{YYYYNNNN}
-- Ex: irmaosnaobra.20260001 (primeira proposta de 2026 da empresa)
-- ════════════════════════════════════════════════════════════
--
-- slug: derivado de company.nome (lowercase + sem acentos + alnum),
--       atribuído lazy no 1ª proposta gerada se faltar.
-- codigo_curto: YYYY + 4-digit sequence escopo empresa-ano.
-- Mantém codigo de 12-dig (YYYYUUUUNNNN) e UUID como fallback no /p/:id.

-- 1. Slug único na company (nullable até backfill / 1ª geração)
ALTER TABLE company ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_slug ON company(slug) WHERE slug IS NOT NULL;

-- 2. codigo_curto em documents (formato YYYYNNNN, ex: 20260001)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS codigo_curto TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_codigo_curto ON documents(codigo_curto) WHERE codigo_curto IS NOT NULL;
