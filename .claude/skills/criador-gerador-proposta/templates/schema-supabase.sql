-- ============================================================
-- Schema padrão multi-tenant — Gerador de Propostas
-- Aplicar UMA VEZ no banco Supabase compartilhado entre tenants
-- ============================================================

-- ============================================================
-- 1. TENANTS
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  cnpj TEXT,
  dominio TEXT,
  plano TEXT NOT NULL DEFAULT 'enterprise',
  limites JSONB NOT NULL DEFAULT '{"vendedores": 50, "propostas_mes": 1500}'::JSONB,
  ativo BOOLEAN NOT NULL DEFAULT true,
  go_live_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. TENANT SETTINGS (branding, cálculo, mensagens, financiamento)
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  branding JSONB NOT NULL DEFAULT '{}'::JSONB,
  calculo JSONB NOT NULL DEFAULT '{
    "inflacao_energia_aa": 0.08,
    "degradacao_painel_aa": 0.005,
    "performance_ratio": 0.80,
    "horizonte_simulacao_anos": 25,
    "considera_fio_b": true
  }'::JSONB,
  financiamento JSONB DEFAULT '[]'::JSONB,
  mensagens JSONB DEFAULT '{}'::JSONB,
  textos JSONB DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. TENANT USERS (vendedores + admin do tenant)
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cpf TEXT,
  whatsapp TEXT,
  role TEXT NOT NULL DEFAULT 'vendedor' CHECK (role IN ('vendedor','admin','gerente')),
  equipe TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_user ON tenant_users(user_id);

-- ============================================================
-- 4. EQUIPAMENTOS (catálogo por tenant)
-- ============================================================

CREATE TABLE IF NOT EXISTS equipamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN
    ('modulo','inversor','kit','estrutura','mao_obra','outros')),
  marca TEXT,
  modelo TEXT NOT NULL,
  potencia_w INTEGER,
  potencia_kw NUMERIC(10,3),
  tipo TEXT,
  preco_unitario NUMERIC(10,2) NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'unidade',
  ativo BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_equipamentos_tenant_categoria ON equipamentos(tenant_id, categoria) WHERE ativo;

-- ============================================================
-- 5. PROPOSTAS
-- ============================================================

CREATE TABLE IF NOT EXISTS propostas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendedor_id UUID NOT NULL REFERENCES tenant_users(id),
  codigo TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN
    ('rascunho','enviada','visualizada','fechada','perdida','expirada')),
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT,
  cliente_whatsapp TEXT,
  cliente_cidade TEXT,
  cliente_uf TEXT,
  consumo_mensal_kwh NUMERIC(10,2),
  tarifa_kwh NUMERIC(8,4),
  sistema JSONB NOT NULL DEFAULT '{}'::JSONB,
  financeiro JSONB NOT NULL DEFAULT '{}'::JSONB,
  validade_dias INTEGER DEFAULT 15,
  observacoes TEXT,
  pdf_url TEXT,
  link_publico TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_propostas_tenant ON propostas(tenant_id);
CREATE INDEX idx_propostas_vendedor ON propostas(vendedor_id);
CREATE INDEX idx_propostas_status ON propostas(tenant_id, status);
CREATE INDEX idx_propostas_codigo ON propostas(codigo);

-- ============================================================
-- 6. ITENS DA PROPOSTA (equipamentos selecionados)
-- ============================================================

CREATE TABLE IF NOT EXISTS proposta_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id UUID NOT NULL REFERENCES propostas(id) ON DELETE CASCADE,
  equipamento_id UUID REFERENCES equipamentos(id),
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL,
  quantidade NUMERIC(10,3) NOT NULL DEFAULT 1,
  preco_unitario NUMERIC(10,2) NOT NULL,
  preco_total NUMERIC(10,2) NOT NULL,
  ordem INTEGER DEFAULT 0
);

CREATE INDEX idx_proposta_itens_proposta ON proposta_itens(proposta_id);

-- ============================================================
-- 7. PROPOSTA VIEWS (tracking de visualização do cliente final)
-- ============================================================

CREATE TABLE IF NOT EXISTS proposta_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id UUID NOT NULL REFERENCES propostas(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  duracao_segundos INTEGER,
  secao_final TEXT,
  baixou_pdf BOOLEAN DEFAULT false,
  clicou_whatsapp BOOLEAN DEFAULT false,
  device_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_proposta_views_proposta ON proposta_views(proposta_id);

-- ============================================================
-- 8. PROPOSTA EVENTS (linha do tempo)
-- ============================================================

CREATE TABLE IF NOT EXISTS proposta_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id UUID NOT NULL REFERENCES propostas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN
    ('criada','enviada_whatsapp','enviada_email','visualizada',
     'pdf_baixado','reaberta','fechada','perdida')),
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_proposta_events_proposta ON proposta_events(proposta_id);

-- ============================================================
-- 9. IRRADIAÇÃO POR CIDADE (compartilhado entre tenants)
-- ============================================================

CREATE TABLE IF NOT EXISTS irradiacao_cidades (
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  hsp_anual NUMERIC(4,2) NOT NULL,
  hsp_mes JSONB,
  PRIMARY KEY (cidade, uf)
);

-- ============================================================
-- 10. AUDIT LOG (operações sensíveis)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT,
  diff JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);

-- ============================================================
-- 11. TRIGGERS de updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename IN ('tenants','tenant_settings','tenant_users','equipamentos','propostas')
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS set_updated_at ON %I;
      CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
    ', r.tablename, r.tablename);
  END LOOP;
END $$;

-- ============================================================
-- 12. RLS — POLÍTICAS DE ISOLAMENTO POR TENANT
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposta_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposta_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposta_events ENABLE ROW LEVEL SECURITY;

-- Helper function: tenant_id do usuário atual
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid() AND ativo LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Helper function: role do usuário atual
CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT AS $$
  SELECT role FROM tenant_users WHERE user_id = auth.uid() AND ativo LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- POLÍTICAS: tenant_users
CREATE POLICY tu_select ON tenant_users FOR SELECT
  USING (tenant_id = current_tenant_id());

CREATE POLICY tu_admin_all ON tenant_users FOR ALL
  USING (tenant_id = current_tenant_id() AND current_user_role() = 'admin');

-- POLÍTICAS: equipamentos
CREATE POLICY eq_select ON equipamentos FOR SELECT
  USING (tenant_id = current_tenant_id());

CREATE POLICY eq_admin_all ON equipamentos FOR ALL
  USING (tenant_id = current_tenant_id() AND current_user_role() IN ('admin','gerente'));

-- POLÍTICAS: propostas (vendedor vê só as suas, admin vê todas do tenant)
CREATE POLICY prop_vendedor_select ON propostas FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND (
      vendedor_id = (SELECT id FROM tenant_users WHERE user_id = auth.uid())
      OR current_user_role() IN ('admin','gerente')
    )
  );

CREATE POLICY prop_vendedor_insert ON propostas FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND vendedor_id = (SELECT id FROM tenant_users WHERE user_id = auth.uid())
  );

CREATE POLICY prop_vendedor_update ON propostas FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND (
      vendedor_id = (SELECT id FROM tenant_users WHERE user_id = auth.uid())
      OR current_user_role() IN ('admin','gerente')
    )
  );

-- POLÍTICAS: tenant_settings (só admin pode mexer)
CREATE POLICY ts_select ON tenant_settings FOR SELECT
  USING (tenant_id = current_tenant_id());

CREATE POLICY ts_admin_update ON tenant_settings FOR UPDATE
  USING (tenant_id = current_tenant_id() AND current_user_role() = 'admin');

-- ============================================================
-- 13. SEEDS de exemplo (remover em produção)
-- ============================================================

-- INSERT INTO tenants (slug, nome, cnpj, dominio) VALUES
-- ('demo', 'Empresa Demo', '00.000.000/0001-00', 'propostas.demo.com.br');
