-- =============================================
-- MIGRATION: Pix RECORRENTE (Asaas) — Pix Automático + fallback assinatura Pix
-- Execute no Supabase SQL Editor (projeto solardoc-pro qdpfwncyzuztibpujlbq)
--
-- Por que Asaas e não Stripe: a conta Stripe da Aioros é BR (acct_1TKNGN…,
-- country=BR) e a doc da Stripe é categórica — "O Pix Automático não está
-- disponível no Brasil". Conferido na conta em 08/08/2026: não existe a
-- capability `pix_payments` e o payment method config traz pix.available=false.
-- O trilho de Pix recorrente sai por um PSP doméstico; o Stripe segue no cartão.
-- =============================================

-- Uma linha por contrato de Pix recorrente do cliente.
CREATE TABLE IF NOT EXISTS asaas_pix_assinaturas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE CASCADE,
  email               text NOT NULL,
  cpf_cnpj            text,
  asaas_customer_id   text NOT NULL,

  -- 'automatico' = autorização Pix Automático (débito automático autorizado 1x no
  -- app do banco). 'assinatura' = assinatura Asaas billingType PIX (QR novo todo
  -- mês, o cliente paga na mão, mas a confirmação é automática por webhook).
  modo                text NOT NULL CHECK (modo IN ('automatico', 'assinatura')),
  authorization_id    text,          -- id da autorização Pix Automático (modo automatico)
  subscription_id     text,          -- id da assinatura Asaas (modo assinatura)
  contract_id         text NOT NULL, -- nosso identificador (≤35 chars, exigência do BCB)

  plano               text NOT NULL, -- 'pro' | 'ilimitado'
  valor               numeric NOT NULL, -- mensalidade cheia

  -- Cupom de adesão (tabela `cupons`, ver MIGRATION_cupons.sql). O desconto vale
  -- SÓ no primeiro mês: `valor` continua sendo o que é cobrado todo mês.
  primeiro_mes        numeric,
  cupom               text,

  -- pendente  = criado, cliente ainda não pagou/autorizou
  -- ativo     = autorização ativa / assinatura em dia
  -- inadimplente = cobrança venceu sem pagamento (acesso segue até plano_expira_em)
  -- cancelado | recusado | expirado = fim de linha (cliente ou banco encerrou)
  status              text NOT NULL DEFAULT 'pendente',

  qr_payload          text,          -- copia-e-cola do primeiro pagamento

  -- Trava do crédito duplo: PAYMENT_CONFIRMED e PAYMENT_RECEIVED chegam quase
  -- juntos para o MESMO pagamento e têm event_id diferentes, então a PK da tabela
  -- de eventos não segura. Só credita quem conseguir gravar aqui um payment id novo.
  -- NOT NULL com default '' de propósito: assim a reivindicação é um UPDATE ...
  -- WHERE ultimo_pagamento_id <> $id, filtro único e atômico. Com NULL na coluna
  -- esse WHERE nunca casaria na primeira cobrança (NULL <> 'x' é UNKNOWN em SQL).
  ultimo_pagamento_id text NOT NULL DEFAULT '',
  ultimo_pagamento_em timestamptz,
  proximo_vencimento  date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Estas três colunas nasceram depois da primeira versão deste arquivo (cupom de
-- primeiro mês + trava de crédito duplo). Ficam aqui pra que rodar a migration
-- de novo, numa base que já tenha a tabela, complete o que falta em vez de dar
-- "column does not exist" na primeira cobrança.
ALTER TABLE asaas_pix_assinaturas ADD COLUMN IF NOT EXISTS primeiro_mes        numeric;
ALTER TABLE asaas_pix_assinaturas ADD COLUMN IF NOT EXISTS cupom               text;
ALTER TABLE asaas_pix_assinaturas ADD COLUMN IF NOT EXISTS ultimo_pagamento_id text NOT NULL DEFAULT '';

-- contract_id é a chave que amarra webhook → linha quando o Asaas devolve só o
-- externalReference. Único de propósito: colisão aqui liberaria o plano errado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asaas_pix_contract     ON asaas_pix_assinaturas(contract_id);
CREATE INDEX        IF NOT EXISTS idx_asaas_pix_user         ON asaas_pix_assinaturas(user_id);
CREATE INDEX        IF NOT EXISTS idx_asaas_pix_customer     ON asaas_pix_assinaturas(asaas_customer_id);
CREATE INDEX        IF NOT EXISTS idx_asaas_pix_auth         ON asaas_pix_assinaturas(authorization_id) WHERE authorization_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_asaas_pix_subscription ON asaas_pix_assinaturas(subscription_id)  WHERE subscription_id  IS NOT NULL;

-- Idempotência do webhook: o Asaas entrega "at least once" e reenvia por 14 dias
-- quando não recebe 2xx. A PK no id do evento é a trava — reentrega bate em 23505
-- e é descartada ANTES de empurrar mais um mês de acesso.
CREATE TABLE IF NOT EXISTS asaas_webhook_events (
  event_id    text PRIMARY KEY,
  event       text NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  payload     jsonb
);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_recebido ON asaas_webhook_events(recebido_em DESC);
