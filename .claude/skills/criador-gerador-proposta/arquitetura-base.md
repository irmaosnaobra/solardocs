# Arquitetura base — Gerador de Propostas (multi-tenant)

> Decisões padronizadas pra **todos** os projetos de gerador. Cliente que pedir desvio precisa entrar em `05-arquitetura/decisoes.md` do projeto como exceção justificada.

## Topologia

```
┌──────────────────────────────────────────────────────────────┐
│ Cliente final (lead que recebe a proposta)                   │
└──────────────────────────────────────────────────────────────┘
                              │  abre link da proposta
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Domínio do cliente:  propostas.empresa.com.br                │
│   CNAME → cname.vercel-dns.com                               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Vercel — projeto dedicado por cliente (Gerador-XXXX)         │
│   Next.js 16 (App Router) + dashboard/public/gerador/        │
│   ENV: SUPABASE_URL, SUPABASE_ANON_KEY, TENANT_ID            │
└──────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼─────────────────┐
              ▼               ▼                 ▼
       Supabase           Resend            Vercel Blob
       (DB + Auth)        (email)           (PDFs gerados)
              │
        RLS por tenant_id
```

**Por que projeto Vercel dedicado por cliente** (não multi-tenant num único projeto):

1. Domínio custom: Vercel cobra por domínio em projetos do mesmo time, mas isolamento é mais limpo.
2. Rollback isolado: bug do Cliente A não afeta Cliente B.
3. Branding aplicado em build time (env vars), mais performático.
4. Analytics e logs do Vercel ficam por cliente, facilita SLA.
5. Trade-off: gerenciar N projetos Vercel. Mitiga com CLI + template git.

**Supabase é compartilhado** (1 instância, vários tenants):

- Schema multi-tenant com RLS por `tenant_id`
- Connection pooling via PgBouncer (Supavisor)
- Backup global vale pra todos os tenants
- Trade-off: vazamento de RLS = catástrofe. Auditar.

## Schema do banco

Ver [templates/schema-supabase.sql](templates/schema-supabase.sql) pro DDL completo. Resumo das tabelas:

| Tabela | Função |
|---|---|
| `tenants` | Empresa cliente (id, nome, slug, dominio, plano, limites) |
| `tenant_settings` | Branding, fórmulas, tarifa local (JSONB) |
| `tenant_users` | Vendedores + admin do tenant (FK em auth.users) |
| `equipamentos` | Catálogo (módulos, inversores, kits, mão de obra) |
| `propostas` | Cada proposta gerada |
| `proposta_itens` | Itens da proposta (equipamentos selecionados) |
| `proposta_views` | Tracking de visualização do cliente final |
| `proposta_events` | Eventos da proposta (criada, enviada, vista, fechada) |
| `audit_log` | Trilha de auditoria global (LGPD) |

### Convenções

- Todas as tabelas tenant-scoped têm coluna `tenant_id UUID NOT NULL` + RLS
- `id` sempre `UUID DEFAULT gen_random_uuid()`
- Timestamps: `created_at`, `updated_at` (com trigger), `deleted_at` (soft delete)
- Slugs: `tenant.slug` único, usado em URLs públicas

### RLS — política padrão

```sql
-- Exemplo: tabela propostas
ALTER TABLE propostas ENABLE ROW LEVEL SECURITY;

-- SELECT: usuário só vê propostas do tenant dele
CREATE POLICY tenant_isolation_propostas ON propostas
  FOR SELECT
  USING (
    tenant_id = (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: só pode criar dentro do próprio tenant
CREATE POLICY tenant_insert_propostas ON propostas
  FOR INSERT
  WITH CHECK (
    tenant_id = (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()
    )
  );
```

Vendedor padrão só vê **as próprias** propostas (filtro adicional por `vendedor_id`).
Admin do tenant vê todas do tenant (role check em `tenant_users.role = 'admin'`).

## Autenticação

**Supabase Auth — email + senha.**

- Primeira senha: gerada aleatoriamente, enviada por email no convite
- Forçar troca no primeiro login
- Recuperação por email
- Sem magic link (vendedores não checam email constantemente, atrito alto)
- Sessão: 30 dias com refresh automático
- Logout forçado em troca de senha

**Convite em massa:** script Node lê `04-vendedores/lista.csv` e cria usuários via Admin API + envia welcome email via Resend.

## Branding por tenant

Tudo carregado de `tenant_settings.branding` (JSONB). Estrutura:

```json
{
  "logo_url": "https://...",
  "logo_dark_url": "https://...",
  "favicon_url": "https://...",
  "cores": {
    "primaria": "#FAC775",
    "secundaria": "#1A1A2E",
    "sucesso": "#10B981",
    "alerta": "#EF4444",
    "texto": "#1F2937",
    "fundo": "#FFFFFF"
  },
  "tipografia": {
    "principal": "Inter",
    "titulos": "Inter"
  },
  "nome_exibicao": "Empresa S.A.",
  "tagline": "Energia limpa pra sua casa.",
  "email_from": "propostas@empresa.com.br",
  "whatsapp_contato": "(34) 99136-0223"
}
```

CSS via custom properties:

```css
:root {
  --color-primary: var(--tenant-primary, #FAC775);
  --color-secondary: var(--tenant-secondary, #1A1A2E);
  /* ... */
}
```

Injeção: middleware do Next.js lê `tenant_settings`, define CSS vars no `<html>`.

## Catálogo de equipamentos

Estrutura genérica permite módulo, inversor, kit, mão de obra, estrutura, outros:

```sql
CREATE TABLE equipamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  categoria TEXT NOT NULL CHECK (categoria IN
    ('modulo','inversor','kit','estrutura','mao_obra','outros')),
  marca TEXT,
  modelo TEXT NOT NULL,
  potencia_w INTEGER,           -- pra módulo
  potencia_kw NUMERIC(10,3),    -- pra inversor
  tipo TEXT,                    -- string|micro|hibrido, ceramica|fibrocimento|solo
  preco_unitario NUMERIC(10,2) NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'unidade',  -- unidade|kwp|m2|hora
  ativo BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Admin do tenant gerencia via painel CRUD. Sem mexer em código.

## Fórmulas de cálculo

Padrão de mercado solar. Documentadas em `tenant_settings.calculo`:

```json
{
  "inflacao_energia_aa": 0.08,
  "degradacao_painel_aa": 0.005,
  "performance_ratio": 0.80,
  "horizonte_simulacao_anos": 25,
  "irradiacao_padrao_kwh_m2_dia": 5.2,
  "fator_disponibilidade_kwh": 100,
  "considera_fio_b": true
}
```

Vendedor pode sobrescrever localmente na proposta (ex: tarifa específica daquele cliente final).

## Pre-cálculo de irradiação

Base de dados de irradiação por cidade em `irradiacao_cidades` (carregada uma vez):

```sql
CREATE TABLE irradiacao_cidades (
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  hsp_anual NUMERIC(4,2) NOT NULL,
  hsp_mes JSONB,
  PRIMARY KEY (cidade, uf)
);
```

Dados originais: arquivo `dashboard/public/gerador/solar-data.js` já tem ~5000 cidades brasileiras. Migrar pra Supabase no primeiro setup, usar pra todos os tenants.

## Geração de PDF

Cliente click "Baixar PDF" → API Vercel function:

1. Render server-side de `proposta.html` com Puppeteer (chrome headless) ou `@vercel/og` se for página estática
2. Salva em Vercel Blob com TTL 90 dias
3. Retorna URL pro cliente

Custo: Puppeteer pesado, considerar `@vercel/og` se layout permite.

## Tracking de visualização

Pixel transparente OU evento JS no `proposta.html`:

- Cada abertura: `INSERT INTO proposta_views`
- Eventos: viewport entrou em seção, clicou no botão WhatsApp, baixou PDF
- Dashboard do vendedor: linha do tempo "Cliente abriu às 14:23, viu por 4min, parou na seção 'Financiamento'"

## Capacidade e limites

**Por tenant padrão:**
- 96 usuários (vendedores + admin)
- 3.000 propostas/mês
- 100GB tráfego/mês
- Storage 10GB

**Excedente:** cobrar à parte ou upgrade de plano.

**Stress test pré-go-live:** simular 100 propostas simultâneas com k6. Identificar bottlenecks.

## Cron e automações

- Limpeza diária de propostas em rascunho (>30 dias sem update)
- Backup semanal do tenant (export JSON)
- Reset mensal de contadores
- Avisos de limite (80%, 100% do plano)

## Observabilidade

- **Sentry** pra erros JS/server (free tier suficiente)
- **Vercel Analytics** pra page views
- **Supabase logs** pra queries lentas
- **Custom dashboard admin** (Aioros) com saúde de todos os tenants

## Segurança

- HTTPS forçado (Vercel)
- RLS obrigatório em toda tabela tenant-scoped
- Audit log de operações críticas (mudança de preço, deleção, export)
- Senhas hash bcrypt (Supabase default)
- Backup com retenção 30 dias
- LGPD: contrato como operador, cliente como controlador
