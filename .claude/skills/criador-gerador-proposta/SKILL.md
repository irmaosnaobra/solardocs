---
name: criador-gerador-proposta
description: Orquestra entrega de projetos white-label do Gerador de Propostas Solares (SaaS B2B). Use quando o usuário falar de "novo gerador", "Gerador #XXXX", "cliente do gerador", "onboarding de cliente do gerador", "aplicar questionário", "setup tenant", ou quando entrar/editar arquivos em `Geradores/Gerador-*/`.
---

# Criador de Gerador de Proposta

Sou o playbook executável pra entregar projetos do **Gerador de Propostas Solares** white-label da Aioros Group / SolarDoc — base do produto que roda em [solardoc.app/gerador](https://solardoc.app/gerador), adaptado por cliente.

**Cada projeto vira pasta numerada:** `Geradores/Gerador-1001/`, `Geradores/Gerador-1002/`, etc.

## Quando me invocar

- Thiago disse "novo cliente do gerador" / "fechei o Gerador #XXXX" / "vou começar o projeto X"
- Thiago pediu pra "aplicar o questionário" pro cliente
- Thiago pediu pra "criar setup técnico" pra um cliente
- Edição/leitura de arquivos em `Geradores/Gerador-*/`
- Pediu pra gerar artefatos: schema SQL, lista de vendedores, branding config, contrato

## Base técnica de partida (NÃO reinventar)

O gerador estrela vive em `dashboard/public/gerador/` no monorepo SolarDoc:

| Arquivo | O que faz |
|---|---|
| `index.html` (2.5k linhas) | Formulário guiado de proposta |
| `proposta.html` (~2k linhas) | Página interativa que o cliente final vê |
| `solar-data.js` | Tabelas de irradiação por cidade, kits padrão |
| `tabelas.js` | Equipamentos (módulos, inversores) e fórmulas de dimensionamento |
| `style.css` | Identidade visual |
| `sw.js` | Service Worker (PWA offline básico) |

A versão admin `dashboard/src/app/(dashboard)/admin/gerador-propostas/page.tsx` é apenas um **iframe** pro mesmo `/gerador/index.html`. Não duplicar lógica.

**Estratégia de white-label:** clonar o `/gerador`, transformar dados hardcoded em consultas Supabase por tenant, injetar branding e equipamentos via config carregado por tenant.

## Workflow padrão (30–45 dias)

Cada fase tem um doc dedicado no skill — leia conforme o estágio.

| Fase | Dias | Arquivo de apoio |
|---|---|---|
| 1. Discovery (questionário) | 1–3 | [questionario.md](questionario.md) |
| 2. Setup técnico (infra + tenant) | 4–7 | [playbook-setup.md](playbook-setup.md) |
| 3. Customização (branding + catálogo + fórmulas) | 8–21 | [playbook-customizacao.md](playbook-customizacao.md) |
| 4. Homologação (cliente valida staging) | 22–28 | [playbook-homologacao.md](playbook-homologacao.md) |
| 5. Go-live + onboarding (treinamento + suporte) | 29–45 | [playbook-golive.md](playbook-golive.md) |

## Decisões arquiteturais padrão (NÃO renegociar por cliente)

- **Stack:** Next.js 16 (App Router) + Supabase (Postgres + Auth + RLS) + Vercel (hosting) + Resend (email)
- **Multi-tenant:** **um projeto Vercel por cliente**, todos consumindo o mesmo Supabase com RLS por `tenant_id`. Justificativa: isolamento total de domínio, branding e analytics; rollback de bug de cliente A não afeta cliente B.
- **Banco:** ver [arquitetura-base.md](arquitetura-base.md) — schema padronizado com tabelas `tenants`, `tenant_users`, `equipamentos`, `propostas`, `proposta_views`.
- **Domínio:** prefira subdomínio do cliente (`propostas.empresa.com.br`) sobre subpath. CNAME apontando pro Vercel.
- **Auth:** Supabase Auth (email/senha). Sem magic link pra não criar fricção pros 96 vendedores que não checam email constantemente.
- **Storage de PDFs gerados:** Supabase Storage, bucket por tenant, retenção 90 dias (depois cliente faz backup local).
- **Limites por tenant:** definidos no contrato, validados no app (`tenant_settings.limites`).

## Padrão de pastas de cada projeto

```
Geradores/Gerador-XXXX/
├── README.md                       ← visão geral + status atual do projeto
├── 01-briefing/
│   ├── questionario-respondido.md  ← respostas do cliente ao questionário
│   └── decisor.md                  ← contato, cargo, perfil
├── 02-branding/
│   ├── logos/                      ← PNG, SVG, monocromático
│   ├── paleta.md                   ← hex codes documentados
│   └── tipografia.md
├── 03-catalogo/
│   ├── modulos.csv
│   ├── inversores.csv
│   ├── kits.csv
│   └── mao-de-obra.md
├── 04-vendedores/
│   └── lista.csv                   ← nome, email, CPF, whatsapp, função
├── 05-arquitetura/
│   ├── decisoes.md                 ← diffs do padrão (se houver)
│   ├── schema.sql                  ← schema final aplicado
│   └── seeds.sql                   ← seeds de equipamentos
├── 06-cronograma/
│   └── milestones.md               ← datas reais vs planejadas
├── 07-entregaveis/
│   ├── credenciais.md              ← URLs, IDs, secrets (cuidado: gitignore)
│   ├── domain-setup.md             ← passo a passo DNS aplicado
│   └── checklist-golive.md
├── 08-proposta-comercial/
│   ├── proposta.md                 ← cópia da proposta enviada
│   ├── contrato.md                 ← contrato assinado (link/cópia)
│   └── pagamentos.md               ← status financeiro
├── 09-treinamento/
│   ├── roteiro-sessao-1.md
│   ├── roteiro-sessao-2.md
│   └── material-apoio.md
└── 10-suporte/
    ├── sla.md
    ├── tickets-abertos.md
    └── post-mortems.md
```

## Como me usar (orientação pro Claude)

Quando invocado, **sempre comece** identificando em qual fase o projeto está:

1. Leia `Geradores/Gerador-XXXX/README.md` se existir (status atual)
2. Identifique a próxima fase pendente
3. Carregue o playbook da fase
4. Execute as ações da fase, atualizando os arquivos do projeto à medida que avança

**NUNCA improvise estrutura ou decisões arquiteturais.** Siga o padrão. Se o cliente pedir algo fora, marca em `05-arquitetura/decisoes.md` como exceção justificada.

**NUNCA pule o questionário.** Toda customização que não está no questionário respondido = retrabalho garantido depois.

**NUNCA commite credenciais.** A pasta `07-entregaveis/` deve estar em `.gitignore` se for repo público.

## Templates inclusos

- [templates/schema-supabase.sql](templates/schema-supabase.sql) — DDL completo padronizado
- [templates/seed-equipamentos.csv](templates/seed-equipamentos.csv) — exemplo de catálogo
- [templates/seed-vendedores.csv](templates/seed-vendedores.csv) — formato esperado da lista
- [templates/branding-config.json](templates/branding-config.json) — config visual
- [templates/env-vars.txt](templates/env-vars.txt) — variáveis Vercel necessárias
- [templates/contrato-padrao.md](templates/contrato-padrao.md) — contrato comercial
- [templates/checklist-golive.md](templates/checklist-golive.md) — checklist de virada

## Custos de referência (pra dimensionar mensalidade do cliente)

Por tenant ativo, custo mensal real pra Aioros:

- Vercel Pro: rateado se múltiplos tenants no mesmo projeto, ou ~R$ 220 se projeto dedicado
- Supabase Pro (compartilhado entre tenants): rateio R$ 15–40 por tenant
- Resend Pro: rateio R$ 10–30 por tenant
- Storage PDFs: ~R$ 5–20 por tenant
- **Custo total por tenant ativo: R$ 250–310/mês**

**Mensalidade mínima ética:** R$ 1.500/mês (margem ~80%, viável dar suporte).
**Mensalidade alvo (96 vendedores):** R$ 9.000–12.000/mês.
**Setup mínimo:** R$ 15.000.
**Setup alvo (96 vendedores):** R$ 25.000.
