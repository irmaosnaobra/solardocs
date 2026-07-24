-- ─────────────────────────────────────────────────────────────────────────────
-- Instagram nativo (comentário→DM, story→DM) — substituto do ManyChat, integrado
-- ao nosso stack (Express + Supabase + CRM/rodízio + aba Automação).
--
-- SÃO DOIS PROJETOS SUPABASE — rode cada bloco no lugar certo:
--   • BLOCO A → projeto MAIN (o do SUPABASE_URL/SERVICE_KEY). Guarda o TOKEN do
--     Instagram (secreto) + fila/contatos/eventos. Acesso só no servidor (service key).
--   • BLOCO B → projeto GERADOR (ancecdfqfwlaujknizof). Guarda as automações
--     (config do "fluxo"), lidas/escritas pela aba Automação (chave publishable).
--
-- Por que separado: a chave do Gerador é pública (está no JS do site). O token do
-- Instagram JAMAIS pode ficar num projeto de chave pública — por isso ig_config
-- fica no MAIN (service key). As automações não têm segredo, então ficam no Gerador.
-- ═════════════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCO A — rodar no projeto MAIN (SUPABASE_URL / SUPABASE_SERVICE_KEY)      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Conta do Instagram conectada (1 linha). Guarda o token — SECRETO.
create table if not exists ig_config (
  id             int primary key default 1,
  ig_user_id     text,
  username       text,
  name           text,
  profile_picture_url text,
  access_token   text,
  token_expires_at timestamptz,
  updated_at     timestamptz not null default now(),
  constraint ig_config_singleton check (id = 1)
);

-- Pessoas que interagiram. last_reply_at abre a janela de 24h da Meta.
create table if not exists ig_contacts (
  ig_user_id        text primary key,
  username          text,
  first_seen        timestamptz not null default now(),
  last_reply_at     timestamptz,
  last_automation_id text,
  updated_at        timestamptz not null default now()
);

-- Fila de envio com trava atômica. needs_window=true → só sai se a janela de 24h
-- estiver aberta (resposta do usuário). private_reply NÃO precisa de janela.
create table if not exists ig_queue (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null,          -- private_reply | dm | public_reply | followup
  automation_id text,
  recipient     text not null,          -- comment_id (private/public reply) ou ig_user_id (dm/followup)
  payload       jsonb not null,         -- {text} | {text,button:{url,title}} | {public}
  status        text not null default 'pending',  -- pending|sending|sent|failed|skipped
  needs_window  boolean not null default false,
  enviar_apos   timestamptz not null default now(),
  claimed_at    timestamptz,
  tentativas    int not null default 0,
  erro          text,
  criado_em     timestamptz not null default now()
);
create index if not exists idx_ig_queue_fila on ig_queue (status, enviar_apos);

-- Log de tudo que chega/sai (auditoria + dedup de comentário).
create table if not exists ig_events (
  id         uuid primary key default gen_random_uuid(),
  tipo       text,                       -- comment | message | sent | error
  ref        text,                       -- comment_id / message_id (dedup)
  raw        jsonb,
  criado_em  timestamptz not null default now()
);
create index if not exists idx_ig_events_ref on ig_events (ref);

alter table ig_config   enable row level security;
alter table ig_contacts enable row level security;
alter table ig_queue    enable row level security;
alter table ig_events   enable row level security;
-- SEM políticas: só a service key (servidor) acessa. A chave publishable não vê nada.

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCO B — rodar no projeto GERADOR (ancecdfqfwlaujknizof)                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Automações (o "fluxo" tipo ManyChat). Sem segredo → chave publishable + RLS.
create table if not exists ig_automations (
  id                uuid primary key default gen_random_uuid(),
  criado_em         timestamptz not null default now(),
  criado_por        text,
  nome              text not null,
  ativo             boolean not null default true,
  gatilhos          jsonb not null default '{"comment":true,"story":false,"dm":false}',
  palavras_chave    text[] not null default '{}',
  match_tipo        text not null default 'contem',   -- contem | exato | qualquer
  post_id           text,                             -- opcional: só nesse post/reels
  respostas_publicas text[] not null default '{}',    -- variações da resposta pública ao comentário
  dm_boas_vindas    text,                             -- a DM que a pessoa recebe
  botao_rotulo      text,                             -- rótulo do botão da DM
  link_url          text,                             -- link do botão
  lembrete_texto    text,                             -- nudge por tempo
  lembrete_horas    int not null default 24
);
alter table ig_automations enable row level security;
do $$
begin
  execute 'drop policy if exists anon_all on ig_automations';
  execute 'create policy anon_all on ig_automations for all to anon using (true) with check (true)';
end $$;
