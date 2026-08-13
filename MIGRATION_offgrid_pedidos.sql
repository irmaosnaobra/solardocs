-- ============================================================================
-- Kit Off-Grid: pedidos de fornecimento
-- Projeto Supabase: solardoc-pro
--
-- O integrador dimensiona o sistema isolado na tela /off-grid, fecha o
-- orçamento e manda a lista pra nós — que somos o fornecedor do kit. Cada
-- pedido guarda o SNAPSHOT do que foi cotado (itens, unitários, frete e a
-- versão da tabela de preços). Quando a tabela mudar, o pedido antigo continua
-- provando o que valia no dia; sem isso, "o preço mudou" vira discussão.
--
-- A regra de negócio (dimensionamento, autonomia, preço) NÃO mora aqui: mora em
-- dashboard/src/lib/offgrid/{constantes,catalogo,engine}.ts. Esta tabela é só o
-- registro do pedido.
-- ============================================================================

create table if not exists public.offgrid_pedidos (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  criado_em           timestamptz not null default now(),

  -- status do fornecimento: novo → cotado → pago → enviado → entregue | cancelado
  status              text not null default 'novo',
  respondido_em       timestamptz,
  nota_interna        text,

  -- obra
  cliente_nome        text,
  cidade              text,
  uf                  text not null,
  observacao          text,

  -- snapshot do dimensionamento (kwp, banco, inversor, autonomia, consumo)
  resumo              jsonb not null default '{}'::jsonb,
  -- snapshot da lista: [{nome, qtd, unitario, total, kg, garantia}]
  itens               jsonb not null default '[]'::jsonb,

  peso_kg             numeric(10,2) not null default 0,
  frete               numeric(12,2) not null default 0,
  custo_fornecimento  numeric(12,2) not null default 0,
  tabela_versao       text not null
);

create index if not exists offgrid_pedidos_user_idx   on public.offgrid_pedidos (user_id, criado_em desc);
create index if not exists offgrid_pedidos_status_idx on public.offgrid_pedidos (status, criado_em desc);

-- A API fala com service role; o cliente do navegador não toca nesta tabela.
alter table public.offgrid_pedidos enable row level security;

-- ── Conferência ──
-- select status, count(*), sum(custo_fornecimento)
--   from public.offgrid_pedidos group by 1 order by 2 desc;

-- ============================================================================
-- ADD-ON "Kit Off-Grid" — acesso vitalício comprado à parte (R$97)
--
-- Não é degrau de plano: a ferramenta é o canal que traz pedido de kit, então
-- trancá-la atrás da assinatura afunilaria justamente quem a gente quer dentro.
-- Grátis pra todo mundo: dimensionar e ver a autonomia. Pago: o PREÇO, a
-- proposta com a marca do integrador e o pedido do kit.
--
-- offgrid_credito: os R$97 voltam como abatimento no PRIMEIRO pedido de kit. O
-- pedido não é uma transação nossa (a cobrança do kit acontece fora da
-- plataforma), então o crédito viaja como recado no e-mail de operação e é
-- zerado aqui quando o pedido sai. Quem nunca pede kit, não usa o crédito.
-- ============================================================================

alter table public.users add column if not exists offgrid_desde   timestamptz;
alter table public.users add column if not exists offgrid_credito numeric(10,2) not null default 0;

create index if not exists users_offgrid_idx on public.users (offgrid_desde)
  where offgrid_desde is not null;

-- ── Conferência ──
-- select count(*) filter (where offgrid_desde is not null) as compraram,
--        count(*) filter (where offgrid_credito > 0)       as com_credito
--   from public.users;
