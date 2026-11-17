-- Trilha do Parceiro NEXUS, Onda 1 (17/11/2026). Banco PRINCIPAL do SolarDoc (o mesmo de users e nexus_parceiros).
--
-- Quem roda: o dono, no SQL Editor do Supabase. Ninguem consegue rodar isto de fora.
-- Enquanto nao rodar, a API fica DORMENTE: a sonda de `nexus_trilha` diz "desligada", as rotas /nexus/trilha respondem
-- `{ligada:false}` e o portal funciona exatamente como antes (niveis antigos). NEXUS_TRILHA_OFF=1 na Vercel tambem desliga.
--
-- Seguro de rodar duas vezes (if not exists). Nao apaga nada.
--
-- RLS: ligada e SEM policy, de proposito, igual ao MIGRATION_nexus_portal.sql. O login do SolarDoc e um JWT proprio, nao o
-- Supabase Auth, entao policy com auth.uid() nao protegeria nada. O acesso e so pela API com a service role, e a API filtra
-- por usuario (rotas do parceiro, sempre req.userId) e por equipe (rotas /nexus/equipe/trilha*).
--
-- users.id e UUID (api/database/schema.sql), entao todo user_id tambem e UUID.

-- 1. Uma linha por parceiro: o estado da trilha (patamares 1 a 6; o 5 vem de nexus_parceiros.carregadores_comprados)
create table if not exists nexus_trilha (
  user_id               uuid primary key references users(id) on delete cascade,

  -- Patamar 1: Raio-X (chaves fixas validadas pela API) e a nota de 0 a 100
  raio_x                jsonb not null default '{}'::jsonb,
  raio_x_nota           int,
  raio_x_enviado_em     timestamptz,
  p1_em                 timestamptz,

  -- Patamar 2: diagnostico (a equipe agenda, faz e marca o resultado)
  diag_pedido_em        timestamptz,
  diag_preferencia      jsonb,
  diag_agendado_para    timestamptz,
  diag_link             text,
  diag_feito_em         timestamptz,
  diag_resultado        text check (diag_resultado in ('aprovado','ainda_nao')),
  diag_plano            text,
  p2_em                 timestamptz,

  -- Patamar 3: preparo (mentoria com 4 encontros OU academia com 12 aulas)
  preparo_formato       text check (preparo_formato in ('mentoria','academia')),
  mentoria_paga_em      timestamptz,
  mentoria_encontros    int not null default 0,
  academia              jsonb not null default '{}'::jsonb,   -- { "<aula>": { "em": "...", "certa": true } }
  p3_em                 timestamptz,

  -- Patamar 4: reuniao com o primeiro cliente (termo aceito + equipe marca a reuniao como feita)
  reuniao_pedida_em     timestamptz,
  reuniao_dados         jsonb,
  reuniao_agendada_para timestamptz,
  reuniao_feita_em      timestamptz,
  p4_em                 timestamptz,

  -- Patamar 6: a equipe promove
  regional_em           timestamptz,

  -- Equipe
  responsavel_email     text,
  obs_equipe            text,
  ultimo_movimento_em   timestamptz not null default now(),  -- o "Parado ha" da equipe
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists nexus_trilha_movimento_idx on nexus_trilha (ultimo_movimento_em);

-- 2. Historico: todo evento relevante (do parceiro, do sistema ou da equipe). `autor` da equipe e o e-mail dela,
--    que NUNCA sai nas respostas do parceiro (a API troca por 'NEXUS').
create table if not exists nexus_trilha_eventos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  tipo        text not null,
  dados       jsonb not null default '{}'::jsonb,
  autor       text not null,                                  -- 'parceiro' | 'sistema' | e-mail da equipe
  created_at  timestamptz not null default now()
);

create index if not exists nexus_trilha_eventos_user_idx on nexus_trilha_eventos (user_id, created_at);

alter table nexus_trilha         enable row level security;
alter table nexus_trilha_eventos enable row level security;

-- Faz o PostgREST enxergar as tabelas novas sem esperar.
notify pgrst, 'reload schema';

-- Conferencia (deve devolver 2 linhas, rls = true):
--   select relname, relrowsecurity as rls from pg_class where relname in ('nexus_trilha','nexus_trilha_eventos');
