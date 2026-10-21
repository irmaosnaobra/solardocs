-- Portal do Parceiro NEXUS (v2 + v3, 21/10/2026). Banco PRINCIPAL do SolarDoc (o mesmo de users e company).
--
-- Quem roda: o dono, no SQL Editor do Supabase. Ninguem consegue rodar isto de fora.
-- Enquanto nao rodar, a API responde 503 `portal_desligado` nas rotas do parceiro e da equipe,
-- `/gerador/nexus/status` responde `{ligado:false}` e o portal mostra "Em breve". A sonda exige as 6 tabelas.
--
-- Seguro de rodar duas vezes (if not exists). Nao apaga nada. Substitui a versao v1 deste arquivo (2 tabelas e colunas
-- credenciado_*), que nunca foi rodada: se alguem tiver rodado a v1, as tabelas ja existem e este arquivo NAO as altera;
-- nesse caso apague as 2 tabelas vazias do portal antes (ou peca o ALTER a quem mantem a API).
--
-- RLS: ligada nas 6 tabelas e SEM policy, de proposito. O login do SolarDoc e um JWT proprio, nao o Supabase Auth,
-- entao uma policy com auth.uid() nao protegeria nada. O acesso e so pela API com a service role, e a API filtra
-- por usuario (rotas do parceiro) e por equipe (rotas /equipe, que exigem consultor). A chave publishable, que
-- qualquer um tem, fica sem acesso nenhum a estas tabelas.
--
-- v3 (rodada 3): a secao "v3" no fim deste arquivo ACRESCENTA colunas e amplia dois CHECKs. Tudo idempotente
-- (add column if not exists, drop constraint if exists + add constraint): rodar o arquivo inteiro de novo nao da erro.
-- A sonda de "portal ligado" confere tambem nexus_propostas.link_token, entao o portal so liga com o arquivo inteiro.
--
-- users.id e UUID (api/database/schema.sql), entao todo user_id tambem e UUID.

-- 1. Parceiros (uma linha por conta)
create table if not exists nexus_parceiros (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references users(id) on delete cascade,
  empresa                  text,
  cnpj                     text,                                   -- so digitos
  cnpj_situacao            text check (cnpj_situacao in ('ativa','nao_verificado')),
  cidade                   text,
  uf                       char(2),
  raio_km                  int,
  papel_revenda            boolean not null default false,
  papel_montagem           boolean not null default false,
  cap_eletrica_bt          boolean not null default false,
  cap_eletrica_mt          boolean not null default false,
  cap_engenharia_art       boolean not null default false,
  cap_obra_civil           boolean not null default false,
  cap_homologacao          boolean not null default false,
  cap_ja_instala           boolean not null default false,
  equipe_tamanho           int,
  origem                   text,
  utm                      jsonb,
  lead_gerador_id          text,                                   -- id da linha de eletroposto_parceria (banco do Gerador)
  perfil_completo_em       timestamptz,
  primeira_proposta_em     timestamptz,
  conversa_pedida_em       timestamptz,
  conversa_feita_em        timestamptz,
  partner_em               timestamptz,                            -- a equipe marca depois da conversa: nivel Partner
  montagem_aprovada_em     timestamptz,                            -- a equipe aprova a montagem: com 1 compra, nivel Pro
  carregadores_comprados   int not null default 0,                 -- a API recalcula a partir de nexus_pedidos confirmados
  status                   text not null default 'novo'
                             check (status in ('novo','em_contato','parceiro_ativo','descartado')),
  notas_equipe             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists nexus_parceiros_uf_idx      on nexus_parceiros (uf);
create index if not exists nexus_parceiros_status_idx  on nexus_parceiros (status);
create index if not exists nexus_parceiros_created_idx on nexus_parceiros (created_at desc);

-- 2. Propostas
create table if not exists nexus_propostas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  numero           text not null,                                  -- AAAA + sequencia de 4 digitos por parceiro e por ano
  saida_ultima     text check (saida_ultima in ('simulador','basico','completo')),
  cliente_nome     text,
  cliente_doc      text,
  cliente_cidade   text,
  cliente_uf       text,
  cliente_telefone text,
  cliente_email    text,
  tipo_local       text,
  modelo           text,
  quantidade       int,
  preco_unitario   numeric(12,2),
  valor_total      numeric(12,2),                                  -- em REAIS
  dados            jsonb not null,                                 -- formulario inteiro + resumo calculado
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, numero)
);

create index if not exists nexus_propostas_user_idx    on nexus_propostas (user_id, created_at desc);
create index if not exists nexus_propostas_created_idx on nexus_propostas (created_at desc);

-- 3. Pedidos de equipamento (Partner em diante). Confirmado soma em carregadores_comprados.
create table if not exists nexus_pedidos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  proposta_id     uuid references nexus_propostas(id) on delete set null,
  modelo          text,
  quantidade      int,
  status          text not null default 'solicitado'
                    check (status in ('solicitado','negociando','confirmado','cancelado')),
  valor_negociado numeric(12,2),
  obs             text,
  obs_equipe      text,
  confirmado_em   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists nexus_pedidos_user_idx    on nexus_pedidos (user_id, created_at desc);
create index if not exists nexus_pedidos_status_idx  on nexus_pedidos (status);
create index if not exists nexus_pedidos_created_idx on nexus_pedidos (created_at desc);

-- 4. Oportunidades (obras e clientes que a equipe oferece a um parceiro Pro)
create table if not exists nexus_oportunidades (
  id               uuid primary key default gen_random_uuid(),
  tipo             text check (tipo in ('cliente','obra')),
  cidade           text,
  uf               char(2),
  descricao        text,
  valor_servico    text,                                           -- texto livre; vazio = "A combinar com o comercial"
  prazo_aceite     timestamptz,
  parceiro_user_id uuid references users(id) on delete set null,
  status           text not null default 'rascunho'
                     check (status in ('rascunho','oferecida','aceita','recusada','expirada','contato','visita','orcamento','fechou','perdeu')),
  etapas           jsonb not null default '[]'::jsonb,             -- historico [{status, em, obs}]
  contato          jsonb,                                          -- {nome, telefone} do cliente final: so vai ao parceiro DEPOIS de aceitar
  origem_ref       text,                                           -- id do card da agenda do Gerador (opcional)
  criado_por       text,                                           -- e-mail do consultor
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists nexus_oportunidades_parceiro_idx on nexus_oportunidades (parceiro_user_id, created_at desc);
create index if not exists nexus_oportunidades_status_idx   on nexus_oportunidades (status);
create index if not exists nexus_oportunidades_uf_idx       on nexus_oportunidades (uf);
create index if not exists nexus_oportunidades_created_idx  on nexus_oportunidades (created_at desc);

-- 5. Usinas indicadas pelos parceiros
create table if not exists nexus_usinas (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  dono_nome           text,
  whatsapp            text,
  cidade              text,
  uf                  char(2),
  distribuidora       text,
  potencia_kwp        numeric,
  geracao_kwh_mes     numeric,
  disponivel_kwh_mes  numeric,
  interesse           text check (interesse in ('vender_creditos','alugar','outro')),
  obs                 text,
  status              text not null default 'recebida'
                        check (status in ('recebida','em_analise','contrato','descartada')),
  obs_equipe          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists nexus_usinas_user_idx    on nexus_usinas (user_id, created_at desc);
create index if not exists nexus_usinas_status_idx  on nexus_usinas (status);
create index if not exists nexus_usinas_uf_idx      on nexus_usinas (uf);
create index if not exists nexus_usinas_created_idx on nexus_usinas (created_at desc);

-- 6. Solicitacoes ao comercial (conversa, engenharia, negociar preco)
create table if not exists nexus_solicitacoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  tipo        text check (tipo in ('conversa','engenharia','negociar_preco')),
  dados       jsonb,
  status      text not null default 'aberta'
                check (status in ('aberta','em_andamento','concluida')),
  obs_equipe  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists nexus_solicitacoes_user_idx    on nexus_solicitacoes (user_id, created_at desc);
create index if not exists nexus_solicitacoes_status_idx  on nexus_solicitacoes (status);
create index if not exists nexus_solicitacoes_created_idx on nexus_solicitacoes (created_at desc);

alter table nexus_parceiros    enable row level security;
alter table nexus_propostas    enable row level security;
alter table nexus_pedidos      enable row level security;
alter table nexus_oportunidades enable row level security;
alter table nexus_usinas       enable row level security;
alter table nexus_solicitacoes enable row level security;

-- ===========================================================================================================
-- v3 (21/10/2026): servicos NEXUS (pacotes de engenharia, consultoria, plataforma), link publico da proposta e Termo.
-- Idempotente: pode rodar de novo, com ou sem a v2 ja aplicada.
-- ===========================================================================================================

-- Pedidos por tipo: equipamento (modelo + quantidade), engenharia (pacote de 3, 5 ou 10 projetos) e consultoria.
alter table nexus_pedidos add column if not exists tipo text not null default 'equipamento'
  check (tipo in ('equipamento','engenharia','consultoria'));
alter table nexus_pedidos add column if not exists pacote int
  check (pacote is null or pacote in (3,5,10));
alter table nexus_pedidos alter column modelo drop not null;
alter table nexus_pedidos alter column quantidade drop not null;

-- Solicitacoes: tipo 'plataforma' e status 'cancelada' (cancelada devolve o projeto ao saldo de engenharia).
-- Os dois CHECKs nasceram inline e sem nome, entao o Postgres os chamou <tabela>_<coluna>_check.
alter table nexus_solicitacoes drop constraint if exists nexus_solicitacoes_tipo_check;
alter table nexus_solicitacoes add constraint nexus_solicitacoes_tipo_check
  check (tipo in ('conversa','engenharia','negociar_preco','plataforma'));
alter table nexus_solicitacoes drop constraint if exists nexus_solicitacoes_status_check;
alter table nexus_solicitacoes add constraint nexus_solicitacoes_status_check
  check (status in ('aberta','em_andamento','concluida','cancelada'));

-- Link publico da proposta (com contagem de aberturas).
alter table nexus_propostas add column if not exists link_token           text;
create unique index if not exists nexus_propostas_link_token_key on nexus_propostas (link_token);
alter table nexus_propostas add column if not exists link_criado_em       timestamptz;
alter table nexus_propostas add column if not exists aberturas            int not null default 0;
alter table nexus_propostas add column if not exists primeira_abertura_em timestamptz;
alter table nexus_propostas add column if not exists ultima_abertura_em   timestamptz;

-- Termo de Parceria (aceite).
alter table nexus_parceiros add column if not exists termo_versao      text;
alter table nexus_parceiros add column if not exists termo_aceito_em   timestamptz;

-- Saldo de engenharia (sem coluna, calculado pela API): comprados = soma de nexus_pedidos.pacote com tipo 'engenharia'
-- e status 'confirmado'; usados = nexus_solicitacoes tipo 'engenharia' com dados.usa_pacote = true e status <> 'cancelada'.

-- Uso do pacote de engenharia SEM corrida: trava por parceiro, confere o saldo e insere na mesma transacao.
-- A API chama por supabase.rpc('nexus_usar_pacote', {p_user, p_dados}) com a service role. user_id e uuid (users.id).
create or replace function nexus_usar_pacote(p_user uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comprados bigint;
  v_usados    bigint;
  v_id        uuid;
begin
  perform pg_advisory_xact_lock(hashtext('nexus_pacote:' || p_user::text));

  select coalesce(sum(pacote), 0) into v_comprados
    from nexus_pedidos
   where user_id = p_user and tipo = 'engenharia' and status = 'confirmado';

  select count(*) into v_usados
    from nexus_solicitacoes
   where user_id = p_user and tipo = 'engenharia' and status <> 'cancelada'
     and dados->>'usa_pacote' = 'true';

  if v_comprados - v_usados <= 0 then
    return jsonb_build_object('ok', false, 'erro', 'sem_saldo');
  end if;

  insert into nexus_solicitacoes (user_id, tipo, dados, status)
  values (p_user, 'engenharia', p_dados, 'aberta')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function nexus_usar_pacote(uuid, jsonb) from public, anon, authenticated;
grant execute on function nexus_usar_pacote(uuid, jsonb) to service_role;

-- Faz o PostgREST enxergar as colunas novas sem esperar.
notify pgrst, 'reload schema';

-- Conferencia da v3 (deve devolver as 8 colunas):
--   select table_name, column_name from information_schema.columns
--    where (table_name = 'nexus_pedidos'   and column_name in ('tipo','pacote'))
--       or (table_name = 'nexus_propostas' and column_name in ('link_token','link_criado_em','aberturas','primeira_abertura_em','ultima_abertura_em'))
--       or (table_name = 'nexus_parceiros' and column_name in ('termo_versao','termo_aceito_em'));

-- Conferencia depois de rodar (deve devolver 6 linhas, rls = true em todas):
--   select relname, relrowsecurity as rls from pg_class
--    where relname in ('nexus_parceiros','nexus_propostas','nexus_pedidos','nexus_oportunidades','nexus_usinas','nexus_solicitacoes');

-- ===========================================================================================================
-- v4 (22/10/2026): equipe do ADM NEXUS por e-mail (login do SolarDoc). Idempotente: pode rodar de novo.
-- Quem entra em /nexus/adm: users.is_admin = true, OU o e-mail ATIVO nesta tabela (papel 'admin' ou 'socio').
-- Papel 'socio' tambem gere a equipe e dispara o convite por e-mail; papel 'admin' so entra no ADM.
-- A tabela e OPCIONAL: a sonda de "portal ligado" nao a exige, e sem ela so users.is_admin entra no ADM.
-- Nenhum e-mail e inserido aqui (o repositorio e publico): quem tem is_admin adiciona a equipe pela aba Equipe do ADM.
-- RLS ligado e SEM policy, como as outras: o acesso e so pela API com a service role.
-- ===========================================================================================================
create table if not exists nexus_equipe (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  papel       text not null check (papel in ('admin','socio')),
  ativo       boolean not null default true,
  criado_por  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- user_id: a conta (users.id) a quem o acesso foi liberado. A API so aceita a linha quando o JWT e dessa conta; linha sem
-- user_id (null) nao da acesso. Sem foreign key de proposito: apagar a conta nao pode apagar o historico da equipe.
alter table nexus_equipe add column if not exists user_id uuid;

alter table nexus_equipe enable row level security;

-- Faz o PostgREST enxergar a tabela nova sem esperar.
notify pgrst, 'reload schema';

-- Conferencia da v4 (deve devolver 1 linha, rls = true):
--   select relname, relrowsecurity as rls from pg_class where relname = 'nexus_equipe';
