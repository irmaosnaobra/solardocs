# 🔐 Runbook de Segurança — SolarDoc

Atualizado em 2026-06-26. Estado da blindagem.

## ✅ ROTAÇÃO COMPLETA (26/06 — verificado em prod)
- ✅ SUPABASE: nova sb_secret no Vercel + legada JWT DESABILITADA no painel.
  API lendo o banco (200). O que vazou no git NÃO funciona mais.
- ✅ ANTHROPIC: nova key (solardoc-prod) no Vercel. IA respondendo (200).
- ✅ STRIPE secret key: rolada (sk_live novo) no Vercel. Cria checkout (200).
  Antiga expira em 24h (transição segura).
- ✅ Cron/bootstrap/mcp secrets: rotacionados (valor antigo → 401).

## ⏳ Sobrou (decidido deixar pra depois, BAIXA urgência)
- Stripe WEBHOOK secret: NÃO rotacionado (menos crítico — só valida origem da
  notificação; vazado no máximo forja "pagamento aprovado" falso). Quando quiser:
  dashboard.stripe.com/webhooks → endpoint solardocs-api → Revogar segredo →
  copiar novo whsec → me pedir pra setar STRIPE_WEBHOOK_SECRET no Vercel.
- JWT_SECRET: não rotacionado (rotacionar desloga os 127 usuários). Opcional.
- 🚨 CRON_SECRET no GitHub: AINDA falta criar (crons parados). Ver item 0 abaixo.
- Anthropic: a key antiga do git (3wg...) já não está na lista do painel
  (removida antes). As 6 outras keys são de OUTROS projetos — não deletar.

## ✅ JÁ FEITO (automático, no ar, verificado)
- Secrets removidos do git + `.gitignore` reforçado (não vaza mais env).
- Fallbacks hardcoded de secret removidos do código (JWT, MCP, cron, bootstrap).
- Endpoints fechados: `/mcp` (fail-closed), `/quiz/leads*` (admin-only),
  `delete-bootstrap` (env key + anti-injection). Testados em prod (401).
- Secrets self-defined ROTACIONADOS (valor vazado já NÃO funciona):
  cron (testado old→401/new→200), bootstrap, mcp.
- **SUPABASE service key ROTACIONADA** → nova `sb_secret_...` no Vercel, API
  verificada lendo o banco (leitura + query complexa, 200). ZERO downtime. ✅

---

## 🔴 PENDENTE — retomar quando voltar pra segurança

### 0. 🚨 CRONS PARADOS — criar GitHub Secret (2 min) — MAIS URGENTE
Os workflows mandam `${{ secrets.CRON_SECRET }}` mas o Secret não existe →
GitHub envia vazio → 401 → Bia/SDR/dunning parados.
- github.com/irmaosnaobra/solardocs → Settings → Secrets and variables →
  Actions → New repository secret.
- Nome: `CRON_SECRET`
- Valor: `b8684209dd6875c0868d056f6bc3ac174047486c39835d05`

### 1. Revogar a service_role LEGADA do Supabase (fecha o vazamento do banco)
A nova já está no ar; falta MATAR a legada que vazou no git.
- Painel Supabase (projeto qdpfwncyzuztibpujlbq) → API Keys → aba
  "Legacy anon, service_role API keys" → "Disable JWT-based API keys".
- Verificado: NADA usa a anon/service legada do projeto principal → seguro.

### 2. Rotacionar STRIPE (live key + webhook) — estávamos AQUI quando paramos
- Secret key: dashboard.stripe.com/apikeys (modo LIVE) → ••• na "Secret key"
  → "Roll key" → copie a nova `sk_live_...` → me peça pra setar no Vercel
  (`STRIPE_SECRET_KEY`) + redeploy. (Código sem fallback hardcoded — confirmado.)
- Webhook secret: dashboard.stripe.com/webhooks → seu endpoint → roll signing
  secret → atualizar `STRIPE_WEBHOOK_SECRET` no Vercel.

### 3. Rotacionar ANTHROPIC_API_KEY
- console.anthropic.com/settings/keys → criar nova, atualizar no Vercel, revogar antiga.

### 4. JWT_SECRET — CRÍTICO (estava no .env commitado = forja de sessão)
- Rotacionar invalida o que vazou MAS desloga os 127 usuários (re-login).
- Posso fazer pelo Vercel quando você autorizar (ciente do logout em massa).

### 5. Atualizar MCP_TOKEN no conector claude.ai
- O MCP_TOKEN foi rotacionado no servidor → o conector Z-API no claude.ai
  precisa do valor novo: `64b6c2534b65c3a8ad9400f6573407142853b233fd9a923c`

---

## ⚠️ Em aberto no código (não fechei pra não quebrar)
- Webhook Kiwify: aceita sem validar assinatura (KIWIFY_WEBHOOK_TOKEN não setado).
- Webhooks Z-API: sem validação de assinatura (Z-API não assina).
