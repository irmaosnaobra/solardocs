# SolarDoc Pro — Contexto Completo do Projeto

Você é um especialista na plataforma SolarDoc Pro. Você conhece cada detalhe da arquitetura, stack, padrões e decisões tomadas neste projeto.

## Stack

- **Frontend (Dashboard):** Next.js App Router, TypeScript, CSS Modules — deploy no Vercel (`solardocs-dashboard.vercel.app`)
- **Backend (API):** Node.js + Express + TypeScript — deploy no Vercel (`solardocs-api-irmaosnaobra-aioros.vercel.app`)
- **Banco de dados:** Supabase (PostgreSQL) — projeto `qdpfwncyzuztibpujlbq` em `sa-east-1`
- **Landing Page:** HTML puro — repositório `irmaosnaobra/solardocs` branch `master`, deploy no Vercel (`solardocs-landing.vercel.app`)
- **Pagamentos:** Stripe (webhooks + checkout sessions)
- **IA:** Anthropic SDK (`claude-haiku-4-5-20251001` para chat/suporte, Claude Opus para geração de documentos)
- **Armazenamento:** Supabase Storage (bucket `documentos`)
- **Analytics:** Meta Pixel `542698941724217`, CAPI server-side

## Repositório

- **Monorepo:** `https://github.com/irmaosnaobra/solardocs`
- `api/` → API Express
- `dashboard/` → Next.js App Router
- `landing/` → HTML estático (tem `.git` próprio com branch `master`)
- Push na `main` → deploy automático do dashboard e API
- Push na `master` da landing → deploy automático da landing

## Planos e Limites

| Plano | Preço | Docs/mês | Histórico |
|-------|-------|----------|-----------|
| Iniciante | R$27 | 30 | Sem histórico |
| PRO | R$47 | 90 | 30 dias |
| VIP | R$97 | Ilimitado | Permanente |

- Stripe Price IDs nas env vars: `STRIPE_PRICE_INICIANTE`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_VIP`
- Controle de limite em `api/src/services/planService.ts`
- Limites aplicados em `api/src/controllers/paymentsController.ts` no `PLAN_MAP`

## Banco de Dados (Supabase)

Tabelas principais:
- `users` — id, email, password_hash, plano, limite_documentos, documentos_usados, data_reset, is_admin, reset_token, reset_token_expires
- `company` — user_id, nome, cnpj, endereco, logo_base64, whatsapp
- `clients` — id, user_id, nome, cpf, endereco, etc.
- `terceiros` — id, user_id, nome, cnpj, etc.
- `documents` — id, user_id, tipo, cliente_nome, content, arquivo_url, created_at
- `page_visits` — visitas à landing com UTMs
- `lp_events` — eventos de scroll, seção, CTA na landing
- `quiz_events` — session_id, event_type, step, score, UTMs
- `quiz_events` serve o funil de conversão em `/quiz/funnel`

## Arquitetura da API

Rotas:
- `/auth` — register, login, forgot-password, reset-password, me
- `/company` — CRUD empresa
- `/clients` — CRUD clientes
- `/terceiros` — CRUD terceiros
- `/documents` — generate (IA ou template), save (com upload Storage), list (filtrado por plano)
- `/payments` — create-checkout, webhook Stripe
- `/admin` — users, analytics, meta-funnel, reset-monthly
- `/chat` — Claude Haiku, agente "Sol", max 300 tokens
- `/quiz` — event (salva no banco), funnel (retorna funil)
- `/cron` — cleanup-pro-docs, monthly-reset (protegido por `CRON_SECRET`)
- `/tracking` — page_visits, lp_events

## Variáveis de Ambiente da API

```
SUPABASE_URL, SUPABASE_SERVICE_KEY
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_INICIANTE, STRIPE_PRICE_PRO, STRIPE_PRICE_VIP
ANTHROPIC_API_KEY
OPENAI_API_KEY
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
DASHBOARD_URL, CORS_ORIGIN
META_PIXEL_TOKEN, META_AD_ACCOUNT_ID
CRON_SECRET
```

## Dashboard — Estrutura de Páginas

```
/login, /register, /esqueci-senha, /redefinir-senha
/(dashboard)/empresa
/(dashboard)/clientes
/(dashboard)/terceiros
/(dashboard)/documentos/contrato-solar
/(dashboard)/documentos/procuracao
/(dashboard)/documentos/proposta-bancaria
/(dashboard)/documentos/prestacao-servico
/(dashboard)/documentos/contrato-pj
/(dashboard)/planos
/(dashboard)/historico — Meus Documentos (PRO+VIP)
/(dashboard)/funil — Funil de Conversão (VIP+Admin)
/(dashboard)/dashboard — Analytics (VIP+Admin)
/(dashboard)/admin — Painel Admin
/(dashboard)/sugestoes — Sugestões VIP
```

## Padrões de Código

- CSS Modules para estilo (ex: `page.module.css`)
- `api` service via axios em `dashboard/src/services/api.ts`
- Auth via JWT em cookie/localStorage, middleware `authMiddleware`
- Erros via `ApiError` com statusCode
- Validação com Zod nos controllers
- Todas as páginas do dashboard são `'use client'`

## Meta Pixel & Funil de Aquisição

- **Pixel:** `542698941724217` — landing + quiz
- **Funil completo:**
  1. Quiz: PageView → ViewContent → QuizStarted → QuizStep(1-4) → Lead → InitiateCheckout
  2. Landing: PageView → CTA clicks
  3. Plataforma: Purchase (via Stripe webhook CAPI)
- Eventos salvos no banco via `/quiz/event` para funil interno
- CAPI server-side em `api/src/utils/metaPixel.ts`

## Agente de Suporte "Sol"

- Model: `claude-haiku-4-5-20251001`
- Max tokens: 300
- System prompt especializado em `api/src/routes/chat.ts`
- Widget injetado via Script no `dashboard/src/app/layout.tsx`
- WhatsApp fallback: `https://wa.me/5534991360223`

## PWA

- `dashboard/public/sw.js` — service worker
- `dashboard/src/app/manifest.ts` — manifest via Next.js App Router
- Botão de instalação na tela de login com detecção iOS/Android/Chrome iOS

## Crons (Vercel)

- `0 3 * * *` → `/cron/cleanup-pro-docs` — apaga docs PRO >30 dias
- `0 3 * * *` → `/cron/monthly-reset` — reseta contador mensal

---

## Como Criar Quiz para Este Projeto

Ao criar um novo quiz:
1. HTML puro na pasta `landing/`
2. Inicializar pixel `542698941724217`
3. Usar a função `track()` para enviar eventos para `https://solardocs-api-irmaosnaobra-aioros.vercel.app/quiz/event`
4. Eventos padrão: `page_view`, `view_content`, `started`, `step` (com `{step: N, answer}`), `completed`, `cta_click`
5. Preservar UTMs e `fbclid` em todos os eventos
6. Gerar `session_id` via `sessionStorage`
7. CTA final deve apontar para `https://solardocs-landing.vercel.app/` com UTMs

## Como Criar Landing Page para Este Projeto

1. HTML puro ou próxima página Next.js na landing
2. Usar o mesmo pixel `542698941724217`
3. Registrar visitas via `POST /tracking/visit` com UTMs
4. Registrar eventos via `POST /tracking/event`
5. Deploy: commit no branch `master` da pasta `landing/`

---

Use este contexto para responder perguntas sobre o projeto, criar novos quizzes, landing pages ou funcionalidades seguindo os mesmos padrões.
