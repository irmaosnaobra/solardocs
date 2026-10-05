# Migração SolarDoc: Stripe → Kiwify

> Decisão do Thiago (13/06/2026): migração **total** pra Kiwify. Motivação: PIX de verdade, taxa/recebimento, menos código.
> Este doc é o plano honesto — o que muda, o que quebra, e a ordem de fazer.

---

## ⚠️ A DECISÃO QUE VEM ANTES DE TUDO: o trial morre no PIX

Hoje o funil é **cartão**: "7 dias grátis → cartão guardado → cobra no dia 8 automático".
Quase toda assinatura recente no Stripe está `trialing` — esse é o coração do funil.

**PIX não guarda cartão.** Então "grátis 7 dias e depois cobra sozinho" **não existe no PIX.**
Isso é regra do meio de pagamento, não limitação da Kiwify. Você tem que escolher:

- **Opção 1 — PIX primário (recomendado se PIX é o motivo):** o funil deixa de ser "7 dias grátis"
  e vira **"assine pra entrar"** (paga já, no PIX ou cartão). Mexe na LP e na oferta — não é só trocar botão.
- **Opção 2 — manter trial:** continua cartão-primeiro (trial 7d no cartão), e o PIX vira só um
  botão secundário pra quem prefere pagar à vista. Aí o PIX não é o carro-chefe.

👉 **Escolher isto é o passo zero.** Tudo abaixo depende dessa escolha.

Na assinatura PIX da Kiwify: se não pagar na renovação, são **5 dias de atraso** (emails diários) e
depois o acesso é cortado automático. Funciona, mas a experiência é diferente do trial atual.

---

## O LOGIN: continua sendo NOSSO sistema (Kiwify não cria conta no SolarDoc)

A Kiwify cobra e entrega acesso à **área de membros DELA** (feita pra curso/ebook).
O SolarDoc é app próprio (Supabase, plano, limite de docs, login em solardoc.app).
**A Kiwify não insere user na nossa tabela.** O login continua sendo provisionado por nós.

→ Caminho: **webhook `compra_aprovada` da Kiwify → nosso endpoint cria o user já liberado → email "defina sua senha".**
É o mesmo trabalho que o webhook do Stripe já faz hoje, **reescrito** pro formato Kiwify.

**Sinceridade sobre "parar de manter código":** esse webhook é inevitável. Você troca o gateway,
mas o código que cria a conta continua existindo (reescrito). A motivação #3 é só **parcialmente** atendida —
você para de manter Stripe sync/sweep, mas ganha o webhook Kiwify pra manter no lugar.

**Bônus:** esse webhook **mata o órfão de vez** — a conta nasce no pagamento, não depende da pessoa voltar
no /auth. O buraco "pagou e sumiu" (Fábio 12/06) deixa de existir por construção.

---

## OS 23 QUE JÁ PAGAM NO STRIPE: não se mexe

- Assinatura com cartão guardado **não migra** de gateway. Ponto.
- **NÃO** mandar email pedindo pra recadastrar cartão na Kiwify → isso vira evento de churn, perde gente.
- Plano: **vendas novas → Kiwify**; os 23 ativos **continuam no Stripe** até churn natural.
- Consequência: **2 gateways rodando em paralelo por meses.** O /admin tem que ler os dois.
- O `stripeSyncService` continua vivo pros legados; o novo fluxo Kiwify roda ao lado.

---

## WEBHOOKS DA KIWIFY (confirmados na doc oficial — 10 eventos)

`boleto_gerado`, `pix_gerado`, `carrinho_abandonado`, `compra_recusada`, **`compra_aprovada`**,
`compra_reembolsada`, `chargeback`, **`subscription_canceled`**, **`subscription_late`**, **`subscription_renewed`**

Mapeamento pro SolarDoc:
| Evento Kiwify | O que o nosso webhook faz |
|---|---|
| `compra_aprovada` | cria/libera user no Supabase com plano (PRO/VIP) + email define-senha |
| `subscription_renewed` | mantém plano ativo (estende vigência) |
| `subscription_late` | marca atraso (grace 5d da Kiwify) — opcional avisar |
| `subscription_canceled` | **downgrade** (suspende/free) — substitui o que o stripeSync faz hoje |
| `compra_reembolsada` / `chargeback` | revoga acesso |

Validação: webhook Kiwify usa **`token`** (configurado na criação) — nosso endpoint confere antes de agir.
⚠️ Formato exato do payload (nomes de campo) está numa página Notion deles — confirmar na implementação.

---

## ORDEM DE EXECUÇÃO (quando você bater o martelo na oferta)

1. **[VOCÊ DECIDE]** Oferta: PIX-primário (muda LP) ou cartão-primeiro com PIX secundário.
2. Criar produto de assinatura na Kiwify (PRO R$27, VIP R$67 — espelhar preços atuais).
3. **[EU ESCREVO]** Endpoint `/webhooks/kiwify` na API: valida token, trata os 5 eventos da tabela,
   cria/libera/downgrade user no Supabase. Idempotente (system_state, como o do Stripe).
4. Trocar o CTA da LP: botão "assinar" → checkout Kiwify (em vez do createPublicCheckout Stripe).
5. Ajustar `/auth` pós-Kiwify: pessoa cai pra **definir senha** (conta já existe), não pra preencher tudo.
6. /admin: somar receita Kiwify + Stripe (a atribuição UTM→receita muda de fonte).
7. **Stripe fica ligado** só pros 23 legados — não desligar nada deles.

---

## ITENS ABERTOS (confirmar antes de codar)

- [ ] **Oferta PIX vs trial** — decisão do Thiago (passo zero acima).
- [ ] Kiwify suporta **período de teste grátis** em assinatura? (doc não confirmou; se não, reforça "sem trial").
- [ ] **PIX Automático/recorrente** real (renovação sem ação do cliente) — a doc fala em renovação com
      aviso, confirmar se é automático ou se cliente paga PIX de novo todo mês.
- [ ] Payload exato do `compra_aprovada` (nomes de campo) — pegar no painel Kiwify na hora.
- [ ] Taxa Kiwify vs Stripe no seu volume — comparar números reais (motivação #2).

---

## RESUMO EM 3 LINHAS
1. PIX mata o trial-no-cartão → **decida a oferta primeiro** (passo zero).
2. Kiwify cobra, mas **o login é sempre nosso** → webhook que cria conta (reescrito, não eliminado).
3. Os **23 do Stripe ficam no Stripe** → 2 gateways por meses, /admin lê os dois.
