-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPECÇÃO + APIFY — a lista fria passa a nascer dentro da tela
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof), NÃO no MAIN.
-- Complemento de MIGRATION_prospeccao.sql.
--
-- Tela:    /gerador/prospeccao (aba Listas → "Buscar leads")
-- Motor:   api/src/services/io/prospeccaoApifyService.ts
-- Gatilho: GET /cron/prospeccao-tick (CRON_SECRET) a cada 5 min + kick da tela
-- Aplicada em: 2026-08-02 (via Supabase MCP, migration "prospeccao_apify")
--
-- Modelo de segurança — mesmo do gerador_broadcasts (a UI é estática e usa chave
-- publishable, que é pública): a tela só ESCREVE UM PEDIDO aqui. Quem gasta
-- dinheiro na Apify é o motor no servidor, que é onde vivem, sem negociação:
--   1. Kill-switch PROSPECCAO_APIFY_OFF='true' → não roda nada.
--   2. Sem APIFY_TOKEN no ambiente → fail-closed, a busca morre com erro claro.
--   3. Cap de leads por busca (PROSPECCAO_MAX_LEADS, padrão 300).
--   4. Cap de buscas por dia (PROSPECCAO_MAX_BUSCAS_DIA, padrão 5) — o teto de
--      gasto: 5 × 300 × US$0,004 ≈ US$ 6/dia no pior caso.
-- Cap NÃO é autenticação: é teto de gasto. Como a chave anon é pública, qualquer
-- um que ache a tabela pode enfileirar — o que ele NÃO consegue é passar do teto.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists prospeccao_buscas (
  id            uuid primary key default gen_random_uuid(),
  criada_em     timestamptz not null default now(),
  criada_por    text,                                  -- consultor que pediu
  fonte         text not null default 'google_maps',   -- 'google_maps' | 'actor'
  actor_id      text not null,                         -- ex: compass/crawler-google-places
  input         jsonb not null,                        -- input do actor, já montado
  limite        int  not null default 100,             -- leads pedidos (o motor ainda corta pelo cap)
  so_celular    boolean not null default true,         -- fixo não recebe WhatsApp
  lista_nome    text not null,                         -- lista criada quando terminar
  lista_origem  text,
  lista_id      uuid references prospeccao_listas(id) on delete set null,

  status        text not null default 'pedida'
                check (status in ('pedida','rodando','importando','concluida','erro','cancelada')),
  run_id        text,                                  -- id da run na Apify
  dataset_id    text,
  encontrados   int not null default 0,                -- itens no dataset
  importados    int not null default 0,                -- viraram contato novo
  dup           int not null default 0,                -- telefone já existia em outra lista
  sem_telefone  int not null default 0,                -- sem telefone utilizável (ou fixo, se só_celular)
  custo_usd     numeric(10,4) not null default 0,      -- gasto REAL lido da run, não estimativa
  erro          text,
  cursor_offset int not null default 0,                -- onde o import parou (dataset grande não cabe num tick)
  locked_until  timestamptz,                           -- lease: impede 2 ticks na mesma busca
  atualizada_em timestamptz not null default now()
);

create index if not exists prospeccao_buscas_status_idx on prospeccao_buscas (status, criada_em);
create index if not exists prospeccao_buscas_data_idx   on prospeccao_buscas (criada_em desc);

alter table prospeccao_buscas enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='prospeccao_buscas' and policyname='prospeccao_buscas_anon_all') then
    create policy prospeccao_buscas_anon_all on public.prospeccao_buscas
      for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

-- A lista importada guarda de onde veio: 'Apify · Google Maps'. O custo da busca
-- é copiado pro custo da lista (em USD→ não: gravamos o custo em custo_usd aqui e
-- deixamos prospeccao_listas.custo pro que o Thiago pagar em real, se quiser).
comment on table prospeccao_buscas is
  'Pedidos de busca de lead na Apify. A tela enfileira, o motor server-side executa.';
