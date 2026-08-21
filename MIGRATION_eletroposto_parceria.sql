-- ─────────────────────────────────────────────────────────────────────────────
-- CONEXÃO ELETROPOSTO — os dois lados que fecham um negócio sozinhos.
--
-- APLICADA EM 17/08/2026 no projeto gerador-propostas (ancecdfqfwlaujknizof).
-- Este arquivo é o registro do que foi rodado, não a fonte: arquivo no repo já
-- ficou 5 dias sem chegar ao banco uma vez. Confira com:
--   select column_name from information_schema.columns
--    where table_name = 'eletroposto_parceria';
--
-- POR QUE ELA EXISTE
-- O NOTA 1 é, por definição da régua, quem NÃO tem local (SEM_LOCAL). Em 55
-- fichas, 42 declararam capital e 1 tinha ponto definido: a base é um lado só.
-- O que falta é o outro — quem tem o imóvel, o estacionamento, o terreno na
-- rota — e esse nunca preencheu a LP, porque a LP pergunta por investidor.
--
-- Esta tabela guarda OS DOIS e é o lugar do casamento: `par_id` aponta um lado
-- para o outro quando a equipe conecta. Ela é separada de `eletroposto_nota1`
-- de propósito: aquela é o funil da LP (com trigger que deriva as colunas slug
-- da ficha e alimenta a métrica do /admin), esta é um cadastro de contraparte,
-- que entra por link direto e não tem ficha nenhuma.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists eletroposto_parceria (
  id             bigserial primary key,
  created_at     timestamptz not null default now(),

  -- 'capital' = tem com quê e não tem onde · 'ponto' = tem onde e não vai investir
  lado           text not null check (lado in ('capital','ponto')),
  nome           text not null,
  telefone       text not null,          -- só dígitos, com DDI 55 (normalizado na API)
  cidade         text,

  -- lado CAPITAL
  capital_faixa  text,                   -- quanto pretende colocar
  prazo          text,                   -- quando pretende começar

  -- lado PONTO (o ativo escasso: é isto que faz o casamento existir)
  ponto_relacao  text,                   -- dono / administro / represento
  ponto_tipo     text,                   -- estacionamento, posto, mercado, terreno…
  ponto_endereco text,
  ponto_vagas    text,
  ponto_fluxo    text,                   -- movimento declarado
  ponto_energia  text,                   -- entrada trifásica?

  obs            text,
  origem         text not null default 'link_direto',   -- 'lp_nota1' | 'link_direto'
  nota1_id       bigint references eletroposto_nota1(id) on delete set null,

  -- Clicou no botão do grupo. NÃO prova que entrou (o WhatsApp fica com essa
  -- verdade), mas separa quem se cadastrou e desistiu na porta.
  grupo_click_at timestamptz,

  -- O casamento. Aponta para a linha do OUTRO lado.
  par_id         bigint references eletroposto_parceria(id) on delete set null,
  par_em         timestamptz,

  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text
);

-- Mesma pessoa mandando o formulário duas vezes atualiza a linha dela, não cria
-- uma segunda. Um telefone pode aparecer nos dois lados (raro, mas legítimo:
-- tem o terreno E o dinheiro) — por isso a chave é (lado, telefone).
create unique index if not exists eletroposto_parceria_lado_tel
  on eletroposto_parceria (lado, telefone);
create index if not exists eletroposto_parceria_lado_criado
  on eletroposto_parceria (lado, created_at desc);

-- RLS fica DESLIGADA, igual a eletroposto_nota1: a API do /gerador fala com este
-- projeto pela chave publishable (não há service role no servidor), então RLS
-- ligada sem policy trancaria a própria gravação da LP.
alter table eletroposto_parceria disable row level security;

-- ── Do lado do funil: qual porta o NOTA 1 escolheu ──────────────────────────
-- Fica em eletroposto_nota1 (e não só na tabela nova) porque a pergunta "quantos
-- dos recusados escolheram alguma porta" é uma pergunta do FUNIL, e o painel do
-- /admin lê a ficha, não o cadastro.
alter table eletroposto_nota1 add column if not exists lado    text;
alter table eletroposto_nota1 add column if not exists lado_em timestamptz;

-- ────────────────────────────────────────────────────────────────────────────
-- A TERCEIRA PORTA — INTEGRADOR
-- APLICADA EM 21/08/2026 no mesmo projeto (ancecdfqfwlaujknizof), e conferida:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'eletroposto_parceria_lado_check';
--   -> CHECK (lado = ANY (ARRAY['capital','ponto','integrador']))
--
-- Quem é: instalador, integrador solar, eletricista, empresa de instalação —
-- gente que já atende cliente e quer somar recarga elétrica ao que vende.
--
-- POR QUE ELE NÃO ENTRA NO CASAMENTO
-- Capital e ponto são as duas metades de UM negócio (dinheiro × lugar) e por
-- isso se casam. O integrador não é metade de nada: ele executa. Por isso
--   · `pool()` e `/parceria/pares` continuam só com 'ponto' e 'capital'
--   · o aviso dele sai sem bloco de pares
--   · /admin/eletroposto-parceria passou a filtrar `lado in ('capital','ponto')`
--     — sem isso o integrador comeria o teto de 400 daquela tela em silêncio.
-- ────────────────────────────────────────────────────────────────────────────
alter table eletroposto_parceria drop constraint if exists eletroposto_parceria_lado_check;
alter table eletroposto_parceria add constraint eletroposto_parceria_lado_check
  check (lado in ('capital','ponto','integrador'));

alter table eletroposto_parceria add column if not exists integrador_atuacao     text;
alter table eletroposto_parceria add column if not exists integrador_interesse   text;
alter table eletroposto_parceria add column if not exists integrador_experiencia text;
alter table eletroposto_parceria add column if not exists integrador_equipe      text;
