-- ============================================================================
-- PRODUTO_COBRANCAS: cobranca Pix do Asaas por produto da loja "Para crescer"
-- Projeto Supabase: SolarDoc principal.
--
-- Uma linha por cobranca Pix gerada dentro do app (Venda Off-Grid, Estoque em Dia,
-- Fecha Vendas, LimpaPro). O pagamento confirmado (webhook do Asaas ou consulta da
-- tela) libera o produto pela mesma concessao que a Kiwify usa; `liberado_em` e o
-- carimbo que segura a liberacao dupla (webhook repetido, webhook mais tela).
--
-- Nao serve a tabela antiga de Pix avulso: aquele fluxo mora em system_state
-- (chave pix_avulso:<uuid>), nao tem usuario nem produto, e e de R$ 67 fixo.
--
-- ORDEM: aplicar esta migration ANTES do deploy da api (as rotas /produtos/pix
-- leem e gravam aqui). Idempotente: pode rodar mais de uma vez.
-- RLS ligada e NENHUMA politica: so a chave de servico da api enxerga a tabela.
-- O CPF e guardado so com digitos, para o upsell de um toque; nunca sai inteiro
-- pela api (GET /produtos/cpf devolve mascarado).
-- ============================================================================

create table if not exists public.produto_cobrancas (
  id                uuid primary key default gen_random_uuid(),
  -- set null (e nao cascade): apagar a conta nao apaga o registro financeiro da cobranca.
  user_id           uuid references public.users(id) on delete set null,
  -- id do produto no catalogo (api/src/services/produtos/catalogo.ts)
  produto           text not null,
  valor             numeric(10,2) not null check (valor > 0),
  cpf               text not null,
  asaas_payment_id  text not null unique,
  asaas_customer_id text,
  status            text not null default 'pendente'
                      check (status in ('pendente', 'pago', 'expirado', 'cancelado', 'reembolsado')),
  qr_payload        text,
  -- PNG em base64 puro (sem o prefixo data:)
  qr_imagem         text,
  expira_em         timestamptz,
  criado_em         timestamptz not null default now(),
  pago_em           timestamptz,
  liberado_em       timestamptz,
  -- ultima vez que a api perguntou ao Asaas (trava de 5 s por cobranca)
  consultado_em     timestamptz,
  -- ultimo alerta de falha enviado a operacao para esta cobranca (no maximo 1 por hora)
  alertado_em       timestamptz
);

-- ── Tabela que ja existia (versao anterior desta migration): ajusta sem recriar ──────────────────────────────
alter table public.produto_cobrancas add column if not exists consultado_em timestamptz;
alter table public.produto_cobrancas add column if not exists alertado_em   timestamptz;

-- user_id aceita nulo e a FK vira ON DELETE SET NULL (apagar a conta nao apaga o registro financeiro).
alter table public.produto_cobrancas alter column user_id drop not null;
alter table public.produto_cobrancas drop constraint if exists produto_cobrancas_user_id_fkey;
alter table public.produto_cobrancas
  add constraint produto_cobrancas_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

create index if not exists produto_cobrancas_user_idx
  on public.produto_cobrancas (user_id, criado_em desc);
-- (asaas_payment_id ja tem indice proprio, o do UNIQUE: o indice repetido da versao anterior sai.)
drop index if exists public.produto_cobrancas_pagamento_idx;

alter table public.produto_cobrancas enable row level security;
