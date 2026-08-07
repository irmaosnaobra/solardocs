-- ─────────────────────────────────────────────────────────────────────────────
-- PLUGCASH — SCHEMA `pc_*`  (Supabase: solardoc-pro)
--
-- Mesmo banco e mesma conta do solardoc.app: quem já é usuário do SolarDoc entra
-- no PlugCash sem cadastro novo. O acesso NÃO é uma conta separada, é linha em
-- `pc_acessos`. Prefixo pc_ pra não colidir com nada que já existe aqui.
--
-- Correção de premissa: os documentos do projeto dizem "Supabase Auth". O
-- solardoc.app NÃO usa Supabase Auth — usa JWT próprio (api/src/routes/auth.ts,
-- bcrypt, cookie `solardoc_token`, tabela `users` deste projeto). É esse auth que
-- o PlugCash reaproveita. Supabase aqui é só banco.
--
-- ── A regra que o schema precisa sustentar ──────────────────────────────────
-- Lead nota 1 (0–4 pts) não vê agenda: vai pra página de venda de R$ 197, compra,
-- e cai dentro do app. Lá dentro os outros cursos aparecem TRAVADOS; clicar no
-- cadeado abre a página de venda daquele curso, que ele pode comprar a qualquer
-- momento. O que decide qual curso aparece primeiro é `motivo_descarte` — o
-- critério que zerou na régua do eletroposto. Daí `pc_cursos.resolve_motivo`.
--
-- ── Guardrails que viraram coluna ───────────────────────────────────────────
-- · `status = 'rascunho'` por padrão: curso sem aula gravada NÃO aparece pra
--   ninguém. Nada vai ao ar com placeholder.
-- · `preco_de_centavos` só pode existir se o preço cheio existiu de verdade —
--   tem CHECK garantindo que é maior que o preço atual.
-- · `checkout_url` e preço moram aqui, nunca no código.
-- · `indexavel`: a oferta de entrada (R$ 197) não pode ser achável no Google, ou
--   o lead nota 3 encontra a oferta de R$ 197 antes da reunião de R$ 160 mil.
-- · `pc_servicos.capacidade_mensal`: teto real de entrega. Estourou, vira lista
--   de espera. Não é escassez de marketing.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Cursos ──────────────────────────────────────────────────────────────────
create table if not exists public.pc_cursos (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  titulo             text not null,
  subtitulo          text,
  descricao          text,
  thumb_url          text,
  preco_centavos     integer not null default 0,
  preco_de_centavos  integer,
  parcelas           integer not null default 12,
  checkout_url       text,
  -- Quando preenchido, o curso NÃO é comprável avulso: vem junto com o nível.
  nivel_exigido      text check (nivel_exigido in ('base','integrador','investidor','projeto')),
  -- Qual falta esse curso resolve. É o que ordena o catálogo e escolhe o
  -- "seu próximo passo" no dashboard do aluno.
  resolve_motivo     text[] not null default '{}',
  ordem              integer not null default 0,
  status             text not null default 'rascunho' check (status in ('rascunho','publicado')),
  indexavel          boolean not null default false,
  -- copy da página de venda: {dor:[], entregas:[], para_quem:[], nao_e_para:[],
  -- faq:[{p,r}], garantia:text, video_url:text}
  copy               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint pc_cursos_preco_de_maior check (
    preco_de_centavos is null or preco_de_centavos > preco_centavos
  )
);

create index if not exists idx_pc_cursos_publicados
  on public.pc_cursos (status, ordem) where status = 'publicado';

-- ── Aulas ───────────────────────────────────────────────────────────────────
-- A grade aparece INTEIRA no card travado, com cadeado em cada aula. Saber o que
-- está perdendo converte melhor que borrão — por isso título e duração são
-- públicos e só a URL do vídeo é protegida.
create table if not exists public.pc_aulas (
  id            uuid primary key default gen_random_uuid(),
  curso_id      uuid not null references public.pc_cursos(id) on delete cascade,
  ordem         integer not null default 0,
  titulo        text not null,
  descricao     text,
  duracao_seg   integer,
  video_url     text,
  material_url  text,
  gratuita      boolean not null default false,   -- amostra na página de venda
  status        text not null default 'rascunho' check (status in ('rascunho','publicado')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_pc_aulas_curso on public.pc_aulas (curso_id, ordem);

-- ── Membro ──────────────────────────────────────────────────────────────────
-- O perfil PlugCash do usuário. Carrega o SNAPSHOT da qualificação do
-- eletroposto — copiado no momento da compra, não consultado em tempo real:
-- `agendamentos` e `eletroposto_nota1` vivem em OUTRO projeto Supabase
-- (gerador-propostas), sem FK possível. A ponte é o telefone, atravessada uma
-- única vez. Se o lead nunca passou pela LP, os campos ficam nulos e o app cai
-- na recomendação padrão.
create table if not exists public.pc_membros (
  user_id           uuid primary key references public.users(id) on delete cascade,
  telefone          text,
  nivel             text not null default 'base'
                    check (nivel in ('base','integrador','investidor','projeto')),
  -- onboarding: o que ele quer fazer com eletroposto
  objetivo          text check (objetivo in ('entender','executar','investir','monetizar')),
  -- snapshot da régua (gerador-propostas)
  nota              smallint,
  pontuacao_total   integer,
  motivo_descarte   text[],
  tem_ponto         text,
  capital_faixa     text,
  e_decisor         boolean,
  perfil_slug       text,
  cidade            text,
  origem_tabela     text,      -- 'agendamentos' | 'eletroposto_nota1' | null
  origem_id         bigint,    -- id no banco do gerador. Referência solta, sem FK.
  -- marcado quando ele declara que resolveu a falta → volta pra agenda como nota 3
  resolveu_em       timestamptz,
  resolveu_o_que    text[],
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_pc_membros_telefone on public.pc_membros (telefone);
create index if not exists idx_pc_membros_elegivel
  on public.pc_membros (resolveu_em desc) where resolveu_em is not null;

-- ── Compras ─────────────────────────────────────────────────────────────────
-- Fonte da verdade do que foi pago. `gateway_ref` é único: webhook repetido não
-- concede acesso duas vezes nem dispara dois eventos de conversão.
create table if not exists public.pc_compras (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,
  email           text not null,
  telefone        text,
  item_tipo       text not null check (item_tipo in ('curso','servico','nivel','bump')),
  item_slug       text not null,
  valor_centavos  integer not null,
  gateway         text,
  gateway_ref     text unique,
  status          text not null default 'pendente'
                  check (status in ('pendente','aprovada','reembolsada','estornada','cancelada')),
  -- dedup de pixel + CAPI, mesmo padrão dos outros projetos
  event_id        text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_pc_compras_user on public.pc_compras (user_id, created_at desc);
create index if not exists idx_pc_compras_email on public.pc_compras (lower(email));

-- ── Acessos ─────────────────────────────────────────────────────────────────
-- O que o usuário pode abrir. Uma linha por curso liberado. Acesso por NÍVEL não
-- vira linha aqui — é resolvido por `pc_membros.nivel` × `pc_cursos.nivel_exigido`,
-- senão subir alguém de nível exigiria varrer o catálogo inteiro gravando linhas.
create table if not exists public.pc_acessos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  curso_id    uuid not null references public.pc_cursos(id) on delete cascade,
  origem      text not null default 'compra' check (origem in ('compra','nivel','cortesia','admin')),
  compra_id   uuid references public.pc_compras(id) on delete set null,
  expira_em   timestamptz,     -- null = vitalício
  created_at  timestamptz not null default now(),
  unique (user_id, curso_id)
);

create index if not exists idx_pc_acessos_user on public.pc_acessos (user_id);

-- ── Progresso ───────────────────────────────────────────────────────────────
create table if not exists public.pc_progresso (
  user_id     uuid not null references public.users(id) on delete cascade,
  aula_id     uuid not null references public.pc_aulas(id) on delete cascade,
  pct         integer not null default 0 check (pct between 0 and 100),
  concluida   boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, aula_id)
);

-- ── Créditos de abatimento ──────────────────────────────────────────────────
-- O que ele pagou em curso abate no upgrade pra Integrador ou Mentoria.
create table if not exists public.pc_creditos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  valor_centavos  integer not null,
  origem_compra   uuid references public.pc_compras(id) on delete set null,
  validade        timestamptz,
  usado_em        timestamptz,
  usado_em_compra uuid references public.pc_compras(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_pc_creditos_user
  on public.pc_creditos (user_id) where usado_em is null;

-- ── Esteira de serviços ─────────────────────────────────────────────────────
create table if not exists public.pc_servicos (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  titulo             text not null,
  descricao          text,
  preco_centavos     integer not null default 0,
  checkout_url       text,
  -- Teto de entrega do mês. Estourou → lista de espera. Protege a garantia.
  capacidade_mensal  integer,
  resolve_motivo     text[] not null default '{}',
  nivel_exigido      text check (nivel_exigido in ('base','integrador','investidor','projeto')),
  ordem              integer not null default 0,
  status             text not null default 'rascunho' check (status in ('rascunho','publicado')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.pc_servico_pedidos (
  id           uuid primary key default gen_random_uuid(),
  servico_id   uuid not null references public.pc_servicos(id) on delete cascade,
  user_id      uuid references public.users(id) on delete set null,
  compra_id    uuid references public.pc_compras(id) on delete set null,
  competencia  date not null,     -- 1º dia do mês: é por aqui que a capacidade é contada
  status       text not null default 'fila' check (status in ('fila','em_execucao','entregue','cancelado')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_pc_servico_pedidos_cap
  on public.pc_servico_pedidos (servico_id, competencia) where status <> 'cancelado';

-- ── Eventos ─────────────────────────────────────────────────────────────────
-- Funil do nota 1: desqualificacao_view → material_view → checkout_start →
-- purchase_197 → app_first_open. Sem isso não dá pra saber se a página de venda
-- funciona ou se o lead some entre a tela e o checkout.
create table if not exists public.pc_eventos (
  id          bigserial primary key,
  user_id     uuid references public.users(id) on delete set null,
  session_id  text,
  tipo        text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_pc_eventos_tipo on public.pc_eventos (tipo, created_at desc);

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function public.pc_touch_updated_at() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists trg_pc_cursos_touch   on public.pc_cursos;
drop trigger if exists trg_pc_membros_touch  on public.pc_membros;
drop trigger if exists trg_pc_compras_touch  on public.pc_compras;
drop trigger if exists trg_pc_servicos_touch on public.pc_servicos;
create trigger trg_pc_cursos_touch   before update on public.pc_cursos   for each row execute function public.pc_touch_updated_at();
create trigger trg_pc_membros_touch  before update on public.pc_membros  for each row execute function public.pc_touch_updated_at();
create trigger trg_pc_compras_touch  before update on public.pc_compras  for each row execute function public.pc_touch_updated_at();
create trigger trg_pc_servicos_touch before update on public.pc_servicos for each row execute function public.pc_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Tudo fechado. Quem lê e escreve é a API (service key), que já valida o JWT
-- próprio do solardoc.app. Não existe cliente falando direto com estas tabelas —
-- ao contrário da LP do eletroposto, que usa a chave publicável.
alter table public.pc_cursos          enable row level security;
alter table public.pc_aulas           enable row level security;
alter table public.pc_membros         enable row level security;
alter table public.pc_compras         enable row level security;
alter table public.pc_acessos         enable row level security;
alter table public.pc_progresso       enable row level security;
alter table public.pc_creditos        enable row level security;
alter table public.pc_servicos        enable row level security;
alter table public.pc_servico_pedidos enable row level security;
alter table public.pc_eventos         enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — GATEWAY E ESTEIRA (aplicada em 07/08/2026)
--
-- De qual produto do gateway veio a venda. Sem esta tabela, o webhook teria que
-- casar o nome do produto por string no código — foi assim que o LimpaPro ficou
-- dependendo de ninguém renomear o produto na Kiwify. Aqui o /admin cadastra o
-- mapeamento, e renomear o produto vira um UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_gateway_produtos (
  id             uuid primary key default gen_random_uuid(),
  gateway        text not null default 'kiwify' check (gateway in ('kiwify','stripe')),
  produto_id     text,
  produto_nome   text,
  item_tipo      text not null check (item_tipo in ('curso','servico','nivel','bump')),
  item_slug      text not null,
  concede_nivel  text check (concede_nivel in ('base','integrador','investidor','projeto')),
  gera_credito   boolean not null default true,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now()
);

create unique index if not exists idx_pc_gw_produto_id
  on public.pc_gateway_produtos (gateway, produto_id) where produto_id is not null;
create index if not exists idx_pc_gw_produto_nome
  on public.pc_gateway_produtos (gateway, lower(produto_nome));

alter table public.pc_gateway_produtos enable row level security;

-- `acesso_email_em` é o gate do e-mail de acesso. Sem ele, a reentrega do
-- webhook (o Pix manda dois eventos) mandaria o e-mail duas vezes.
alter table public.pc_compras
  add column if not exists acesso_email_em timestamptz,
  add column if not exists nome            text,
  add column if not exists payload         jsonb,
  add column if not exists checkout_link   text;

alter table public.pc_servicos
  add column if not exists copy       jsonb not null default '{}'::jsonb,
  add column if not exists entrega    text,
  add column if not exists prazo_dias integer;

-- A esteira aparece no fim da AULA que cria a dor que o serviço resolve.
-- Menu de "serviços" não basta: ninguém abre menu.
alter table public.pc_aulas
  add column if not exists oferta_servico_slug text,
  add column if not exists oferta_curso_slug   text;

-- Quanto da capacidade do mês já foi usada — uma consulta só, em vez de o app
-- contar pedido a pedido a cada abertura da esteira.
create or replace view public.pc_servicos_capacidade as
select s.id                                as servico_id,
       s.slug,
       s.capacidade_mensal,
       count(p.id) filter (
         where p.status <> 'cancelado'
           and p.competencia = date_trunc('month', now())::date
       )                                   as usados_no_mes
from public.pc_servicos s
left join public.pc_servico_pedidos p on p.servico_id = s.id
group by s.id, s.slug, s.capacidade_mensal;
