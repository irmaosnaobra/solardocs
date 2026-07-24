-- ─────────────────────────────────────────────────────────────────────────────
-- Central de Automação do GERADOR (Fase 1: Disparos + Sequências)
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof), NÃO no MAIN.
-- É o mesmo projeto onde vivem leads_meta e agendamentos.
--
-- Modelo de segurança (ver geradorAutomacaoService.ts): estas tabelas são
-- escritas pela UI estática do Gerador com a chave publishable (papel `anon`),
-- exatamente como agendamentos já é. A proteção real do ENVIO não está na RLS —
-- está no motor server-side (kill-switch, allow-list de CRM, supressão, caps).
-- Por isso as policies abaixo liberam anon (consistente com o resto do Gerador).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Disparos (broadcast) ─────────────────────────────────────────────────────
create table if not exists gerador_broadcasts (
  id              uuid primary key default gen_random_uuid(),
  criado_em       timestamptz not null default now(),
  criado_por      text,
  mensagens       jsonb not null,            -- [{slot,base,media_url,media_type}]
  contatos        text[],                    -- E.164 sem +
  contexto_ai     text,
  usou_ia         boolean not null default true,
  cadencia_min    int not null default 4,
  cadencia_max    int not null default 8,
  total           int not null default 0,
  sucesso         int not null default 0,
  falha           int not null default 0,
  status          text not null default 'rodando',   -- rodando | concluido | parado | erro
  ultimo_envio_em timestamptz,
  tick_lock_until timestamptz,
  finalizado_em   timestamptz
);
create index if not exists idx_gerador_broadcasts_status on gerador_broadcasts (status, ultimo_envio_em);

create table if not exists gerador_broadcast_envios (
  id             uuid primary key default gen_random_uuid(),
  broadcast_id   uuid references gerador_broadcasts(id) on delete cascade,
  enviado_em     timestamptz not null default now(),
  phone          text,
  slot           int,
  mensagem_final text,
  status         text,                       -- ok | erro
  zaap_id        text,
  message_id     text,
  erro           text
);
create index if not exists idx_gerador_envios_broadcast on gerador_broadcast_envios (broadcast_id, enviado_em desc);

-- ── Sequências (drip) ────────────────────────────────────────────────────────
create table if not exists sequencias (
  id         uuid primary key default gen_random_uuid(),
  criado_em  timestamptz not null default now(),
  criado_por text,
  nome       text not null,
  passos     jsonb not null,                 -- [{ordem,intervalo_horas,texto,media_url,media_type}]
  linha      text not null default 'io',
  ativo      boolean not null default true
);

create table if not exists sequencia_inscricoes (
  id               uuid primary key default gen_random_uuid(),
  sequencia_id     uuid references sequencias(id) on delete cascade,
  criado_em        timestamptz not null default now(),
  phone            text not null,
  nome             text,
  passo_atual      int not null default 0,   -- 0 = nenhum passo enviado ainda
  proximo_envio_em timestamptz not null default now(),
  status           text not null default 'ativo',   -- ativo | concluido | parado
  ultimo_envio_em  timestamptz,
  unique (sequencia_id, phone)
);
create index if not exists idx_seq_inscricoes_fila on sequencia_inscricoes (status, proximo_envio_em);

-- ── RLS (libera anon/publishable — igual agendamentos) ───────────────────────
alter table gerador_broadcasts        enable row level security;
alter table gerador_broadcast_envios  enable row level security;
alter table sequencias                enable row level security;
alter table sequencia_inscricoes      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['gerador_broadcasts','gerador_broadcast_envios','sequencias','sequencia_inscricoes']
  loop
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all to anon using (true) with check (true);', t);
  end loop;
end $$;

-- ── Storage: bucket público pra mídia de disparo/sequência ───────────────────
-- Criar pelo painel (Storage → New bucket → "automacao-media", Public), OU:
insert into storage.buckets (id, name, public)
values ('automacao-media', 'automacao-media', true)
on conflict (id) do nothing;

-- IMPORTANTE: public=true só torna os arquivos LEGÍVEIS publicamente. O UPLOAD
-- pela chave publishable (papel anon) precisa de policy de INSERT em
-- storage.objects pra este bucket — senão o upload de mídia dá 403.
do $$
begin
  execute 'drop policy if exists automacao_media_insert on storage.objects';
  execute 'create policy automacao_media_insert on storage.objects for insert to anon with check (bucket_id = ''automacao-media'')';
  execute 'drop policy if exists automacao_media_select on storage.objects';
  execute 'create policy automacao_media_select on storage.objects for select to anon using (bucket_id = ''automacao-media'')';
  execute 'drop policy if exists automacao_media_update on storage.objects';
  execute 'create policy automacao_media_update on storage.objects for update to anon using (bucket_id = ''automacao-media'') with check (bucket_id = ''automacao-media'')';
end $$;
