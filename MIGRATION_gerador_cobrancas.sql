-- ─────────────────────────────────────────────────────────────────────────────
-- COBRANÇAS DO GERADOR (Asaas) — registro do que foi cobrado e do que sobrou
--
-- RODAR NO PROJETO SUPABASE **PRINCIPAL** (solardoc-pro qdpfwncyzuztibpujlbq),
-- NÃO no do Gerador. É a exceção deliberada à regra "coisa do /gerador mora no
-- projeto do Gerador": o projeto do Gerador é lido pela tela estática com a
-- chave publishable, e esta tabela guarda CPF, telefone e valor de cliente.
-- Aqui entra só o service_role da API, e a tela enxerga o que passar pelo
-- endpoint /gerador/cobranca/* — que exige COBRANCA_TOKEN.
--
-- Tela:    /gerador/cobrancas/index.html
-- Backend: api/src/services/asaas/asaasCobrancas.ts
--
-- Por que guardar, se o Asaas já guarda: o Asaas sabe o que foi COBRADO. Ele não
-- sabe quanto o Thiago queria RECEBER, nem que a diferença entre os dois é a
-- taxa que ele decidiu repassar. Sem esta linha, ninguém consegue responder
-- depois "quanto essa venda deu de verdade" sem refazer a conta à mão.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gerador_cobrancas (
  id                 bigserial PRIMARY KEY,

  -- id do Asaas. Qual id depende do tipo:
  --   link          → id do paymentLink  (link_xxx)
  --   avulsa        → id do payment      (pay_xxx)
  --   parcelamento  → id do installment  (ins_xxx), NÃO o da primeira parcela:
  --                   é o installment que a antecipação aceita e que agrupa as 18.
  asaas_id           text NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('link', 'avulsa', 'parcelamento')),

  -- 'sandbox' | 'prod'. Fica na LINHA, não só no ambiente do servidor: cobrança
  -- de teste e cobrança real convivem na mesma tabela durante um deploy, e sem
  -- isto a lista mistura as duas sem ninguém perceber.
  ambiente           text NOT NULL DEFAULT 'sandbox',
  external_ref       text,

  cliente_nome       text NOT NULL,
  cliente_doc        text,
  cliente_telefone   text,
  descricao          text NOT NULL,

  meio               text NOT NULL CHECK (meio IN ('link', 'pix', 'boleto', 'cartao')),
  parcelas           int  NOT NULL DEFAULT 1,

  -- Os três números que contam a história inteira da venda:
  valor_bruto        numeric NOT NULL,   -- o que o cliente paga
  valor_parcela      numeric NOT NULL,   -- o que ele paga por mês
  valor_liquido      numeric NOT NULL,   -- o que cai na conta (previsto)
  taxa_asaas         numeric NOT NULL DEFAULT 0,
  custo_antecipacao  numeric NOT NULL DEFAULT 0,
  antecipar          boolean NOT NULL DEFAULT false,

  url                text,
  status             text NOT NULL DEFAULT 'PENDING',
  antecipacao_id     text,
  antecipacao_status text,

  criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gerador_cobrancas_criado ON gerador_cobrancas (criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gerador_cobrancas_asaas ON gerador_cobrancas (asaas_id);

-- RLS ligada e NENHUMA policy: anon e authenticated não leem nada. É de
-- propósito — o único caminho até esta tabela é o service_role da API, atrás do
-- COBRANCA_TOKEN. Se um dia a tela precisar ler direto, a decisão de abrir tem
-- que ser consciente, não herdada.
ALTER TABLE gerador_cobrancas ENABLE ROW LEVEL SECURITY;
