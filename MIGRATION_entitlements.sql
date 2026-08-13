-- ============================================================================
-- ENTITLEMENTS — uma fonte só pra "quem pode usar o quê"
-- Projeto Supabase: solardoc-pro
--
-- Hoje cada produto tem o seu caminho: o curso vive em kit_pedidos, o off-grid
-- numa coluna de users, e ferramenta "paga" é só o campo plano. Com cinco
-- produtos isso vira colisão garantida — o cliente paga e não consegue usar.
-- Esta tabela passa a ser a resposta.
--
-- O QUE ENTRA AQUI: só acesso que alguém CONQUISTOU e que não se perde sozinho.
--   compra   — pagou avulso. Vitalício.
--   cortesia — a gente deu (grandfathering, suporte, parceria).
--   admin    — liberado na mão.
--
-- O QUE NÃO ENTRA: acesso por ASSINATURA. Esse é derivado na leitura, a partir
-- de users.plano. Se virasse linha aqui, cancelar a assinatura exigiria alguém
-- lembrar de apagar — e o dia em que esquecer, o ex-assinante segue usando. Um
-- estado a menos pra envelhecer errado.
--
-- ORDEM: esta migration pode rodar ANTES ou DEPOIS da MIGRATION_offgrid_pedidos.
-- O backfill do off-grid abaixo confere se a coluna existe em vez de assumir —
-- migration que quebra no meio deixa metade aplicada, e aí ninguém sabe mais
-- em que estado o banco está.
-- ============================================================================

create table if not exists public.entitlements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  -- id do produto no catálogo (api/src/services/produtos/catalogo.ts)
  produto    text not null,
  origem     text not null check (origem in ('compra', 'cortesia', 'admin')),
  desde      timestamptz not null default now(),
  -- null = não expira. Compra avulsa é vitalícia.
  expira_em  timestamptz,
  -- pedido da Kiwify/Stripe que gerou. Serve de idempotência e de prova.
  order_id   text,
  obs        text,
  unique (user_id, produto)
);

create index if not exists entitlements_user_idx    on public.entitlements (user_id);
create index if not exists entitlements_produto_idx on public.entitlements (produto, desde desc);

alter table public.entitlements enable row level security;

-- ── BACKFILL 1: quem comprou o add-on off-grid ──
-- Só roda se a coluna já existir (ver nota de ORDEM no topo).
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'offgrid_desde'
  ) then
    insert into public.entitlements (user_id, produto, origem, desde, obs)
    select id, 'offgrid', 'compra', offgrid_desde, 'migrado de users.offgrid_desde'
      from public.users
     where offgrid_desde is not null
    on conflict (user_id, produto) do nothing;
  end if;
end $$;

-- ── BACKFILL 2: GRANDFATHERING de Precificação e Inventário ──
-- Estas duas nasceram grátis, de propósito (isca de retenção). Passar a cobrar
-- SEM olhar pra trás tiraria a ferramenta da mão de quem usa ela HOJE — 65
-- pessoas na conferência de 12/08/2026, das quais 21 estão no plano grátis.
-- Quem já usou, continua usando de graça pra sempre. Cobrar é pra quem chega
-- agora; quebrar o trabalho de quem já está dentro não é monetização, é churn.
insert into public.entitlements (user_id, produto, origem, desde, obs)
select distinct fe.user_id,
       case fe.feature when 'precificacao' then 'precificacao' else 'inventario' end,
       'cortesia',
       now(),
       'grandfathering: já usava antes da ferramenta virar paga'
  from public.feature_events fe
 where fe.feature in ('precificacao', 'inventario')
   and fe.user_id is not null
on conflict (user_id, produto) do nothing;

-- ── Conferência ──
-- select produto, origem, count(*) from public.entitlements group by 1,2 order by 1,2;
--
-- Quem ganhou cortesia e está no plano grátis (os que teriam perdido a ferramenta):
-- select count(*) from public.entitlements e join public.users u on u.id = e.user_id
--  where e.origem = 'cortesia' and u.plano = 'free';
