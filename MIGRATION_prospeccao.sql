-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPECÇÃO ATIVA do GERADOR — lista fria trabalhada 1 a 1, multiproduto
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof), NÃO no MAIN.
-- É o mesmo projeto onde vivem agendamentos, leads_meta e consultores.
--
-- Tela:    /gerador/prospeccao/index.html  (estática, chave publishable = anon)
-- Backend: nenhum — a tela fala direto com o PostgREST, igual à Agenda.
-- Aplicada em: 2026-08-01 (via Supabase MCP, migration "prospeccao")
--
-- Modelo de dados (o ponto todo está aqui):
--   · a VERDADE é o TOQUE, não o contato. Cada linha de prospeccao_toques é uma
--     interação com um produto e um resultado. "Já é cliente do SolarDoc" não é
--     uma coluna — é DERIVADO de existir um toque 'vendeu' daquele produto.
--     Assim carteira, LTV, funil e "toques até a venda" saem do mesmo log e
--     nunca divergem de um campo de status esquecido.
--   · telefone é ÚNICO na tabela inteira (não por lista): ninguém aborda o mesmo
--     integrador duas vezes, nem hoje, nem daqui a seis listas. O import faz
--     upsert ignorando duplicata contra este índice.
--
-- Segurança: mesmo modelo do resto do Gerador — policies liberam anon, porque a
-- tela é estática e usa a chave publishable. Nada aqui dispara mensagem sozinho:
-- o WhatsApp abre no aparelho do consultor, um a um.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Catálogo de produtos oferecidos na prospecção ────────────────────────────
-- Editável pela tela (aba Listas → Produtos). Preço aqui é SUGESTÃO: o valor
-- que entra no faturamento é o digitado na hora de registrar a venda.
create table if not exists prospeccao_produtos (
  id          text primary key,                    -- slug: limpapro, solardoc, kit…
  nome        text not null,
  sigla       text not null,                       -- 2 letras pro quadradinho da carteira
  cor         text not null default '#1E3A8A',
  preco       numeric(10,2) not null default 0,
  sub         text,                                -- "curso · venda única"
  ordem       int  not null default 0,             -- ordem da escada de oferta
  ativo       boolean not null default true
);

-- ── Scripts de abordagem (3 variações por produto, pra não repetir texto) ────
-- Placeholders trocados na tela: {empresa} {cidade} {consultor} {preco}
create table if not exists prospeccao_scripts (
  id          uuid primary key default gen_random_uuid(),
  produto_id  text not null references prospeccao_produtos(id) on delete cascade,
  ordem       int  not null default 0,
  texto       text not null
);
create index if not exists prospeccao_scripts_produto_idx on prospeccao_scripts (produto_id, ordem);

-- ── Listas (a origem fria: CSV do Maps, base própria, importação) ────────────
create table if not exists prospeccao_listas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  origem      text,                                -- "Apify · Maps", "CSV importado"…
  status      text not null default 'ativa'
              check (status in ('ativa','pausada','encerrada')),
  custo       numeric(10,2) not null default 0,    -- o que a lista custou (pro ROI)
  criada_em   timestamptz not null default now()
);

-- ── Contatos ────────────────────────────────────────────────────────────────
create table if not exists prospeccao_contatos (
  id          uuid primary key default gen_random_uuid(),
  lista_id    uuid references prospeccao_listas(id) on delete cascade,
  empresa     text not null,
  cidade      text,
  uf          text,
  telefone    text not null,                       -- só dígitos, com DDI (5577…)
  nota        numeric(2,1),                        -- avaliação Google
  avaliacoes  int,
  site        text,
  consultor   text,                                -- dono na distribuição da lista
  bloqueado   boolean not null default false,      -- pediu "não perturbar"
  criado_em   timestamptz not null default now()
);
-- dedup GLOBAL por telefone (ver cabeçalho)
create unique index if not exists prospeccao_contatos_tel_uidx on prospeccao_contatos (telefone);
create index if not exists prospeccao_contatos_lista_idx      on prospeccao_contatos (lista_id);
create index if not exists prospeccao_contatos_consultor_idx  on prospeccao_contatos (consultor);

-- ── Toques (o log que sustenta a tela inteira) ──────────────────────────────
create table if not exists prospeccao_toques (
  id          uuid primary key default gen_random_uuid(),
  contato_id  uuid not null references prospeccao_contatos(id) on delete cascade,
  lista_id    uuid references prospeccao_listas(id) on delete set null,
  produto_id  text references prospeccao_produtos(id) on delete set null,
  consultor   text,
  resultado   text not null
              check (resultado in ('enviei','respondeu','interessado','vendeu',
                                   'sem_interesse','nao_perturbar')),
  valor       numeric(10,2) not null default 0,    -- só em 'vendeu'; digitado na hora
  obs         text,
  criado_em   timestamptz not null default now()
);
create index if not exists prospeccao_toques_contato_idx  on prospeccao_toques (contato_id, criado_em desc);
create index if not exists prospeccao_toques_data_idx     on prospeccao_toques (criado_em desc);
create index if not exists prospeccao_toques_produto_idx  on prospeccao_toques (produto_id);

-- ── RLS: anon libera, igual ao resto do Gerador ─────────────────────────────
alter table prospeccao_produtos enable row level security;
alter table prospeccao_scripts  enable row level security;
alter table prospeccao_listas   enable row level security;
alter table prospeccao_contatos enable row level security;
alter table prospeccao_toques   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['prospeccao_produtos','prospeccao_scripts','prospeccao_listas',
                           'prospeccao_contatos','prospeccao_toques']
  loop
    if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename=t and policyname = t || '_anon_all') then
      execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
                     t || '_anon_all', t);
    end if;
  end loop;
end $$;

-- ── Seed do catálogo — PREÇOS CONFERIDOS EM 01/08/2026 ───────────────────────
-- Limpa Solar Pro R$47: campanha campeã "Só Hoje por R$47" (CAMPANHA-LIMPAPRO-PRONTA.md).
-- SolarDoc VIP R$67/mês: dashboard/src/app/(dashboard)/conta/[slug]/page.tsx.
-- Kit de Fechamento R$27: isca da Kiwify (KIT-INTEGRADOR.md) — NÃO é R$297.
-- Não semeamos produto de site/white-label: não há preço confirmado no repo.
-- Pra vender um quarto produto, cadastre em Listas → Produtos com o preço real.
insert into prospeccao_produtos (id, nome, sigla, cor, preco, sub, ordem, ativo) values
  ('limpapro', 'Limpa Solar Pro',   'LP', '#16A34A',  47.00, 'curso · venda única',   1, true),
  ('solardoc', 'SolarDoc VIP',      'SD', '#3B82F6',  67.00, 'assinatura · mensal',   2, true),
  ('kit',      'Kit de Fechamento', 'KF', '#C026D3',  27.00, 'isca · venda única',    3, true)
on conflict (id) do nothing;

-- ── Seed dos scripts (3 variações por produto) ──────────────────────────────
insert into prospeccao_scripts (produto_id, ordem, texto)
select * from (values
 ('limpapro', 1, E'Oi! Aqui é a {consultor}, da Irmãos na Obra. Vi a {empresa} no Google — vocês têm avaliação boa aí na região.\n\nPergunta rápida: depois que instala, quem faz a limpeza dos painéis? A maioria dos integradores deixa isso pra lá e perde uma receita que volta todo semestre no mesmo cliente.\n\nMontamos o método completo: equipamento certo, como precificar e como vender pra base que você já instalou. {preco}, acesso vitalício.\n\nQuer o link?'),
 ('limpapro', 2, E'Bom dia! {consultor} aqui, da Irmãos na Obra.\n\nUma coisa que vejo muito em empresas do porte da {empresa}: a instalação sai, o cliente fica feliz, e seis meses depois a geração cai de sujeira — e quem ganha esse serviço é outro.\n\nTemos um treinamento de limpeza de painel que vira serviço recorrente na sua carteira. {preco}.\n\nTe mando o conteúdo?'),
 ('limpapro', 3, E'Oi! {consultor}, da Irmãos na Obra.\n\nVocês da {empresa} já cobram manutenção/limpeza dos sistemas que instalaram?\n\nSe não, tem dinheiro parado aí — cliente que você já tem, já confia, e paga de novo todo semestre. Montamos o passo a passo completo por {preco}.\n\nPosso te mandar?'),
 ('solardoc', 1, E'Oi! {consultor} aqui, da Irmãos na Obra. Uma dúvida sobre a operação da {empresa}:\n\nquantas propostas vocês montam por mês, e em quê? Word, Canva, planilha?\n\nPergunto porque o gargalo que mais escuto de integrador é gastar quase uma hora montando PDF pra cliente que às vezes nem responde.\n\nO SolarDoc faz proposta + memorial + homologação em ~4 minutos. {preco}, ilimitado.\n\nTe mando um exemplo pronto pra você ver?'),
 ('solardoc', 2, E'Oi! {consultor}, da Irmãos na Obra.\n\nSe a {empresa} fecha umas 10 propostas por mês, provavelmente monta umas 40. E cada uma leva quase uma hora.\n\nSão 40 horas/mês num trabalho que o sistema faz em 4 minutos — com dimensionamento, payback e homologação já preenchidos.\n\n{preco}, propostas ilimitadas. Quer ver uma proposta real gerada?'),
 ('solardoc', 3, E'Bom dia! {consultor} aqui.\n\nCuriosidade: quando o cliente pede orçamento pra {empresa}, em quanto tempo ele recebe?\n\nQuem responde em 10 minutos fecha muito mais que quem responde no dia seguinte. É pra isso que existe o SolarDoc — proposta completa em 4 minutos, direto do celular.\n\n{preco}. Te mostro?'),
 ('kit',      1, E'Oi! {consultor} aqui, da Irmãos na Obra.\n\nVocês da {empresa} chegam a mandar orçamento e o cliente sumir? É o padrão do setor — e quase nunca é preço. É que a proposta não responde as objeções sozinha.\n\nO Kit de Fechamento é o material que usamos: roteiro de visita, quebra das objeções mais comuns, comparativo de financiamento e follow-up pronto.\n\n{preco}. Te mando o índice?'),
 ('kit',      2, E'Oi! {consultor}, da Irmãos na Obra.\n\nPergunta direta: de cada 10 propostas que a {empresa} manda, quantas fecham?\n\nSe for menos de 3, o problema não é preço — é o que acontece entre o envio e o silêncio. O Kit de Fechamento tem o roteiro completo pra essa fase. {preco}.\n\nQuer ver o que vem dentro?'),
 ('kit',      3, E'Bom dia! {consultor} aqui.\n\n"Vou pensar e te retorno" é a frase que mais custa dinheiro pra integrador solar.\n\nMontamos um kit com os argumentos que derrubam as objeções mais comuns, mais o roteiro de follow-up que recupera quem sumiu. {preco}.\n\nPosso mandar o índice?')
) as s(produto_id, ordem, texto)
where not exists (select 1 from prospeccao_scripts);
