# 🔐 Runbook de Segurança — SolarDoc

Gerado em 2026-06-26. Estado após a blindagem automática desta sessão.

## ✅ JÁ FEITO (automático, no ar)
- Secrets removidos do tracking do git (`.env.vercel.local`, `.env.local.temp`,
  `.claude/settings.local.json`) + `.gitignore` reforçado pra nunca mais vazar.
- Fallbacks hardcoded de secret removidos do código (JWT, MCP, cron, bootstrap).
- Endpoints fechados: `/mcp` (fail-closed), `/quiz/leads*` (admin-only),
  `delete-bootstrap` (env key + anti-injection).
- **Secrets self-defined ROTACIONADOS** (valor que vazou já NÃO funciona mais):
  - `GITHUB_CRON_SECRET` → novo, sincronizado nos workflows + Vercel. ✓ testado.
  - `BOOTSTRAP_KEY` → novo. ✓
  - `MCP_TOKEN` → novo (⚠️ ver pendência abaixo).

---

## 🚨 URGENTE AGORA — CRONS ESTÃO PARADOS até você fazer isto (2 min)
O cron secret foi rotacionado. Os workflows do GitHub agora usam
`${{ secrets.CRON_SECRET }}`, mas esse GitHub Secret AINDA NÃO EXISTE → os
crons (process-messages/Bia/SDR, dunning, Stripe sync, reagendar) estão
falhando com 401 até você criar:
1. github.com/irmaosnaobra/solardocs → Settings → Secrets and variables →
   Actions → New repository secret.
2. Nome: `CRON_SECRET` · Valor: (o valor novo — peça pra mim mostrar, ou
   `vercel env pull` no projeto da API e copie de GITHUB_CRON_SECRET).
3. Pronto — o próximo ciclo de cron já volta a passar.

---

## 🔴 PENDENTE — SÓ VOCÊ PODE FAZER (nos painéis). ~15 min.

> **Por que importa:** o histórico do git (já no GitHub) ainda contém estas
> chaves. Elas continuam VÁLIDAS até você rotacionar. Enquanto isso, quem viu o
> repo tem acesso. Rotacionar é o que "mata" o que vazou — não dá pra limpar o
> histórico (já foi pro GitHub; é irreversível).

### 1. SUPABASE_SERVICE_KEY ⚠️ A MAIS CRÍTICA
Essa chave ignora TODA a segurança do banco (lê/apaga tudo dos 127 clientes).
- Painel: https://supabase.com/dashboard/project/qdpfwncyzuztibpujlbq/settings/api
- Em "Project API keys" → role `service_role` → **Reset/Reveal** → copie a nova.
- Cole no Vercel (projeto solardocs-api): `vercel env rm SUPABASE_SERVICE_KEY production` depois add com a nova.
- Redeploy da API.

### 2. STRIPE (live key + webhook secrets)
A chave `sk_live_...` estava no `.claude/settings.local.json` commitado.
- Painel: https://dashboard.stripe.com/apikeys → **Roll** a secret key live.
- Atualize no Vercel: `STRIPE_SECRET_KEY`.
- Webhook secret: https://dashboard.stripe.com/webhooks → seu endpoint → roll signing secret → atualize `STRIPE_WEBHOOK_SECRET` no Vercel.

### 3. ANTHROPIC_API_KEY
- Painel: https://console.anthropic.com/settings/keys → revogue a antiga, crie nova.
- Atualize no Vercel: `ANTHROPIC_API_KEY`.

### 4. JWT_SECRET — CRÍTICO (mesma gravidade da service key)
O JWT_SECRET estava no `.env.vercel.local` commitado → está no histórico do
GitHub. Com ele, qualquer um FORJA uma sessão válida de qualquer um dos 127
usuários (impersonação total de conta). NÃO é opcional.
- Custo de rotacionar: desloga todos os 127 (re-login) e quebra links de
  unsubscribe pendentes — que é o resultado CORRETO pra um secret vazado.
- Como: `openssl rand -hex 32` → troca `JWT_SECRET` no Vercel → redeploy.
- Posso fazer isso por você (tenho acesso ao Vercel da API + valor gerado) —
  é só me autorizar, ciente de que desloga todo mundo.

### 5. (você) atualizar o MCP_TOKEN no conector claude.ai
- O `MCP_TOKEN` foi rotacionado no servidor. O conector do Z-API no claude.ai
  ainda usa o valor antigo → vai dar 401 até você atualizar lá com o valor novo.
- Valor novo: está no Vercel (`vercel env pull` no projeto da API pra ver), ou
  me peça pra gerar/mostrar de novo.

### 6. (você) migrar o cron secret pra GitHub Secret (higiene, sem pressa)
- Hoje o secret novo está hardcoded nos `.github/workflows/*.yml` (melhor que o
  antigo, mas ainda no repo). Ideal: criar um GitHub repo Secret `CRON_SECRET`
  e trocar nos YAMLs `Bearer <valor>` por `Bearer ${{ secrets.CRON_SECRET }}`.

---

## ⚠️ Ainda em aberto no código (não fechei pra não quebrar)
- **Webhook Kiwify** (`limpaproController.ts`): aceita sem validar assinatura
  porque `KIWIFY_WEBHOOK_TOKEN` não está setado no Vercel. Pra fechar: pegue o
  token no painel da Kiwify, set `KIWIFY_WEBHOOK_TOKEN` no Vercel, e me peça pra
  tornar o webhook fail-closed (rejeitar sem assinatura).
- **Webhooks Z-API** (`webhook.ts`): sem validação de assinatura (Z-API não
  assina). Risco aceitável por ora; mitigado por dedup + rate-limit.
