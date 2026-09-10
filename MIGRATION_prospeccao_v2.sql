-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPECÇÃO v2 — as 5 disciplinas do repo soumatheusgomes/buscandomilhao
-- aplicadas na máquina que já existe (MIGRATION_prospeccao.sql).
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof).
-- Aplicada em: 2026-09-10.
--
-- Nada aqui apaga, renomeia ou altera coluna existente. É tudo aditivo:
-- duas tabelas novas e três views. O log de toques continua sendo a verdade —
-- as views DERIVAM estado dele, nunca gravam um campo que possa ficar velho.
--
-- O que resolve, em ordem:
--   1. prospeccao_contato_estado  — separa ETAPA (funil) de CANAL (comunicação).
--      Era tudo o mesmo enum `resultado`, e por isso 246 toques ficaram parados
--      em 'enviei' sem ninguém enxergar que 153 deles eram silêncio, não fila.
--   2. prospeccao_alegacoes       — o que o script PODE afirmar. O que não está
--      provado fica bloqueado até alguém assinar embaixo com a fonte.
--   3. prospeccao_saude           — taxa de opt-out rolante + disjuntor. Em
--      10/09 a taxa histórica era 19 "não perturbar" em 192 contatos tocados
--      (9,9%) — o dobro do que derruba linha.
--   4. prospeccao_teto_hoje       — rampa de aquecimento por consultor no lugar
--      do teto fixo de 200/dia, que não era teto nenhum.
--   5. (custo por lead / por cliente sai em centralAgentes.ts, lendo daqui.)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. ETAPA × CANAL — dois eixos independentes
-- ═════════════════════════════════════════════════════════════════════════════
-- ETAPA responde "onde esse contato está no funil" (o melhor ponto que ele já
-- alcançou). CANAL responde "qual é o estado da conversa agora". São perguntas
-- diferentes e um enum só nunca conseguiu responder as duas: 'enviei' é etapa
-- 'abordado' com canal 'aguardando' no dia 1 e canal 'sem_retorno' no dia 15 —
-- mesma linha no banco, significados opostos pra quem vai trabalhar a fila.
--
-- SEM_RETORNO_DIAS: depois disso, "mandei e estou esperando" vira "ele não vai
-- responder". 7 dias é o mesmo corte que a régua de follow-up já usa.
create or replace view prospeccao_contato_estado
with (security_invoker = true) as
with t as (
  select
    contato_id,
    count(*)                                                        as toques_total,
    max(criado_em)                                                  as ultimo_toque_em,
    min(criado_em)                                                  as primeiro_toque_em,
    bool_or(resultado = 'vendeu')                                   as vendeu,
    bool_or(resultado = 'interessado')                              as interessou,
    bool_or(resultado = 'respondeu')                                as respondeu,
    bool_or(resultado = 'nao_perturbar')                            as pediu_parar,
    sum(case when resultado = 'vendeu' then valor else 0 end)       as ltv,
    (array_agg(resultado order by criado_em desc))[1]               as ultimo_resultado
  from prospeccao_toques
  group by contato_id
)
select
  c.id                                as contato_id,
  c.lista_id,
  c.consultor,
  c.empresa,
  c.telefone,
  c.bloqueado,
  coalesce(t.toques_total, 0)         as toques_total,
  t.primeiro_toque_em,
  t.ultimo_toque_em,
  t.ultimo_resultado,
  coalesce(t.ltv, 0)::numeric(10,2)   as ltv,
  case when t.ultimo_toque_em is null then null
       else (extract(epoch from (now() - t.ultimo_toque_em)) / 86400)::int
  end                                 as dias_desde_ultimo_toque,

  -- ── EIXO 1: ETAPA (funil) — o melhor ponto já alcançado ──────────────────
  case
    when t.vendeu           then 'cliente'
    when c.bloqueado
      or t.pediu_parar      then 'encerrado'
    when t.interessou       then 'interessado'
    when t.respondeu        then 'respondeu'
    when t.toques_total > 0 then 'abordado'
    else                         'novo'
  end                                 as etapa,

  -- ── EIXO 2: CANAL (estado da conversa agora) ─────────────────────────────
  case
    when c.bloqueado or t.ultimo_resultado = 'nao_perturbar' then 'nao_perturbar'
    when t.ultimo_resultado = 'sem_interesse'                then 'encerrado'
    when t.ultimo_resultado is null                          then 'nunca_tocado'
    when t.ultimo_resultado in ('respondeu','interessado','vendeu') then 'conversa_viva'
    when t.ultimo_toque_em > now() - interval '7 days'       then 'aguardando'
    else                                                          'sem_retorno'
  end                                 as canal
from prospeccao_contatos c
left join t on t.contato_id = c.id;

grant select on prospeccao_contato_estado to anon, authenticated;

comment on view prospeccao_contato_estado is
  'Etapa (funil) e canal (conversa) como eixos SEPARADOS, derivados do log de toques. '
  'Nunca gravar esses valores em coluna: eles mudam sozinhos com o tempo (aguardando → sem_retorno).';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. ALEGAÇÕES — o script só afirma o que está provado
-- ═════════════════════════════════════════════════════════════════════════════
-- `gatilho` é o que faz disso uma trava e não um checklist: é a regex (case
-- insensitive) que denuncia a alegação DENTRO do texto do script. A tela roda as
-- regexes das alegações NÃO verificadas contra a mensagem antes de deixar copiar.
-- Alegação sem gatilho serve só de lembrete e não bloqueia nada.
create table if not exists prospeccao_alegacoes (
  id          uuid primary key default gen_random_uuid(),
  produto_id  text references prospeccao_produtos(id) on delete cascade,
  texto       text not null,                       -- a afirmação, em português
  gatilho     text,                                -- regex que a detecta no script
  verificada  boolean not null default false,
  fonte       text,                                -- ONDE está a prova (obrigatória p/ verificar)
  criada_em   timestamptz not null default now(),
  verificada_em timestamptz,
  verificada_por text
);
create index if not exists prospeccao_alegacoes_produto_idx
  on prospeccao_alegacoes (produto_id, verificada);
-- Unicidade por (produto, texto) com coalesce porque produto_id nulo = alegação
-- global, e NULL não colide em índice único. É isso que torna o seed idempotente:
-- rodar a migration de novo não duplica nem desfaz o que alguém já verificou.
create unique index if not exists prospeccao_alegacoes_uidx
  on prospeccao_alegacoes (coalesce(produto_id, ''), texto);

alter table prospeccao_alegacoes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='prospeccao_alegacoes' and policyname='prospeccao_alegacoes_anon_all') then
    execute 'create policy prospeccao_alegacoes_anon_all on public.prospeccao_alegacoes
             for all to anon, authenticated using (true) with check (true)';
  end if;
end $$;

-- Trava de integridade: verificada = true exige fonte escrita. Sem isso a coluna
-- vira caixinha que todo mundo marca, e a regra inteira não vale nada.
alter table prospeccao_alegacoes drop constraint if exists prospeccao_alegacoes_fonte_ck;
alter table prospeccao_alegacoes add constraint prospeccao_alegacoes_fonte_ck
  check (verificada = false or (fonte is not null and length(btrim(fonte)) >= 8));

-- ── Seed: as alegações que JÁ ESTÃO nos scripts em produção ─────────────────
-- Auditei os 9 scripts semeados em 01/08. As verificadas têm fonte conferida em
-- 10/09/2026 (banco solardoc-pro / catálogo do gerador). As não verificadas são
-- afirmações reais que estão no ar hoje e ninguém provou — por isso vão como
-- bloqueadas, e é isso que a tela vai barrar até alguém assinar embaixo.
insert into prospeccao_alegacoes (produto_id, texto, gatilho, verificada, fonte) values
  -- SolarDoc — verificadas
  ('solardoc', 'R$67/mês com propostas ilimitadas',
   null, true,
   'Catálogo prospeccao_produtos + plano "ilimitado" ativo em sales (45 contas a R$67 em 10/09/2026).'),
  ('solardoc', 'Gera proposta, contrato, procuração, recibo, proposta pro banco e memorial',
   null, true,
   'documents.tipo no solardoc-pro: propostaSolar, contratoSolar, procuracao, recibo, propostaBanco, prestacaoServico, contratoPJ, propostaOffGrid.'),
  ('solardoc', 'Integradores geraram 1.211 documentos nos últimos 30 dias',
   null, true,
   'select count(*) from documents where created_at > now()-30d — solardoc-pro, medido em 10/09/2026.'),
  -- SolarDoc — BLOQUEADAS (estão no script e não têm prova)
  -- O gatilho exige o SUJEITO perto do prazo: "em N minutos" sozinho tambem
  -- casa com "te respondo em 5 minutos", que e promessa de atendimento e nao
  -- precisa de prova. Testado contra as duas ordens e contra 3 contraprovas.
  ('solardoc', 'Proposta pronta em ~4 minutos',
   '(proposta|documento|memorial|homologa|sistema|pdf)[^.!?
]{0,60}em\s*~?\s*\d+\s*minutos?|em\s*~?\s*\d+\s*minutos?[^.!?
]{0,60}(proposta|documento|memorial|pdf)', false, null),
  ('solardoc', 'Quem responde em 10 minutos fecha muito mais',
   'fecha\s+muito\s+mais', false, null),
  ('solardoc', 'Economiza 40 horas por mês',
   '\b\d+\s*horas?\s*(por\s+m[êe]s|/\s*m[êe]s)', false, null),
  ('solardoc', 'Cada proposta manual leva quase uma hora',
   'quase\s+uma\s+hora', false, null),

  -- LimpaPro — verificada
  ('limpapro', 'R$47, acesso vitalício ao curso',
   null, true,
   'Catálogo prospeccao_produtos (R$47) + limpapro_entitlements sem expiração. Confirmado 10/09/2026.'),
  -- LimpaPro — BLOQUEADAS
  ('limpapro', 'Vira receita recorrente que volta todo semestre',
   'todo\s+semestre', false, null),
  ('limpapro', 'A maioria dos integradores não faz limpeza',
   'a\s+maioria\s+dos\s+integradores', false, null),
  ('limpapro', 'A geração cai de sujeira em seis meses',
   'seis\s+meses', false, null),

  -- Kit — verificada
  ('kit', 'R$27, venda única',
   null, true,
   'Catálogo prospeccao_produtos + checkout da isca (KIT-INTEGRADOR.md). Confirmado 10/09/2026.'),
  -- Kit — BLOQUEADAS
  ('kit', 'De cada 10 propostas, menos de 3 fecham',
   'menos\s+de\s+\d', false, null),
  ('kit', '"Vou pensar" é a frase que mais custa dinheiro pro integrador',
   'que\s+mais\s+custa\s+dinheiro', false, null),

  -- Global (sem produto): nunca, em nenhum script
  (null, 'Garantia de devolução (não existe pro SolarDoc nem pro Kit)',
   '\bgarantia\b', false, null),
  (null, 'Promessa de resultado financeiro ao cliente',
   '(garanto|garantido|com\s+certeza\s+voc[êe]\s+vai)', false, null)
-- Idempotente pelo índice único acima: rodar de novo não duplica e não desfaz
-- alegação que alguém já verificou.
on conflict (coalesce(produto_id, ''), texto) do nothing;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. DISJUNTOR — taxa de opt-out rolante
-- ═════════════════════════════════════════════════════════════════════════════
-- O número que derruba linha não é "quantos toques dei", é "quantos pediram pra
-- parar". A view calcula em cima de CONTATOS DISTINTOS tocados na janela, não de
-- toques: três follow-ups no mesmo contato não diluem uma reclamação.
--
-- Faixas (uma definição só, aqui — a tela lê `estado`, não recalcula):
--   < 4%   ok        — segue
--   4–8%   atencao   — a tela avisa, a fila continua
--   ≥ 8%   travado   — a fila para. 8% é abaixo dos 9,9% históricos de propósito:
--                      o disjuntor precisa desarmar ANTES do ponto que já doeu.
create or replace view prospeccao_saude
with (security_invoker = true) as
with j as (
  select
    t.consultor,
    count(distinct t.contato_id)                                              as contatos_14d,
    count(distinct t.contato_id) filter (where t.resultado = 'nao_perturbar') as optout_14d,
    count(*)                                                                  as toques_14d,
    count(distinct t.contato_id) filter
      (where t.resultado in ('respondeu','interessado','vendeu'))             as positivos_14d
  from prospeccao_toques t
  where t.criado_em > now() - interval '14 days'
  group by t.consultor
)
select
  consultor,
  contatos_14d,
  toques_14d,
  optout_14d,
  positivos_14d,
  case when contatos_14d = 0 then 0
       else round(100.0 * optout_14d / contatos_14d, 1) end as taxa_optout,
  case
    -- Amostra pequena não trava ninguém: 1 opt-out em 5 contatos é 20% e não
    -- quer dizer nada. Abaixo de 20 contatos na janela o disjuntor fica armado
    -- mas não dispara — só avisa.
    when contatos_14d < 20                                    then 'ok'
    when 100.0 * optout_14d / contatos_14d >= 8               then 'travado'
    when 100.0 * optout_14d / contatos_14d >= 4               then 'atencao'
    else                                                           'ok'
  end                                                       as estado
from j;

grant select on prospeccao_saude to anon, authenticated;

comment on view prospeccao_saude is
  'Disjuntor de opt-out por consultor, janela de 14 dias. Denominador é CONTATO distinto, '
  'não toque. estado=travado significa parar a fila, não diminuir o ritmo.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. RAMPA DE AQUECIMENTO — teto do dia por consultor
-- ═════════════════════════════════════════════════════════════════════════════
-- O teto anterior era 200/dia por consultor. Não era teto: era o dobro do que a
-- linha inteira aguenta num dia (a régua da IO pós-bloqueio é 20/dia).
-- Aqui: semana 1 = 5/dia, +5 por semana, teto duro em 20.
--
-- Quem já vem tocando NÃO recomeça do 5: sem linha na tabela, o início da rampa
-- é o primeiro toque que o consultor já deu — derivado do log, como todo o resto.
create table if not exists prospeccao_rampa (
  consultor   text primary key,
  iniciou_em  date not null default current_date,
  teto_manual int,                                 -- override consciente; null = rampa
  obs         text,
  atualizado_em timestamptz not null default now()
);
alter table prospeccao_rampa enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='prospeccao_rampa' and policyname='prospeccao_rampa_anon_all') then
    execute 'create policy prospeccao_rampa_anon_all on public.prospeccao_rampa
             for all to anon, authenticated using (true) with check (true)';
  end if;
end $$;

create or replace view prospeccao_teto_hoje
with (security_invoker = true) as
with consultores as (
  select distinct consultor from prospeccao_toques where consultor is not null
  union
  select consultor from prospeccao_rampa
),
base as (
  select
    c.consultor,
    coalesce(
      r.iniciou_em,
      (select min(t.criado_em)::date from prospeccao_toques t where t.consultor = c.consultor),
      current_date
    )                                                                as iniciou_em,
    r.teto_manual,
    (select count(*) from prospeccao_toques t
      where t.consultor = c.consultor
        and t.criado_em >= date_trunc('day', now()))                 as usados_hoje
  from consultores c
  left join prospeccao_rampa r on r.consultor = c.consultor
)
select
  consultor,
  iniciou_em,
  usados_hoje,
  (greatest(0, current_date - iniciou_em) / 7 + 1)                   as semana,
  coalesce(
    teto_manual,
    least(5 * (greatest(0, current_date - iniciou_em) / 7 + 1), 20)
  )::int                                                             as teto,
  greatest(
    0,
    coalesce(teto_manual,
             least(5 * (greatest(0, current_date - iniciou_em) / 7 + 1), 20))::int - usados_hoje
  )::int                                                             as restam
from base;

grant select on prospeccao_teto_hoje to anon, authenticated;

comment on view prospeccao_teto_hoje is
  'Rampa de aquecimento: 5/dia na semana 1, +5 por semana, teto duro 20 (mesma régua da linha IO). '
  'Consultor sem linha em prospeccao_rampa tem a rampa contada do primeiro toque que já deu.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. CUSTO POR LEAD E POR CLIENTE — a conta que diz se a lista deu lucro
-- ═════════════════════════════════════════════════════════════════════════════
-- prospeccao_listas.custo já existia e nunca foi lido por ninguém. Esta view
-- fecha a conta por lista e é o que a Central das Agentes vai mostrar.
-- Lista sem custo lançado aparece com custo 0 e cpl 0 — é honesto: não sabemos,
-- não inventamos.
create or replace view prospeccao_custo
with (security_invoker = true) as
select
  l.id                                                     as lista_id,
  l.nome,
  l.status,
  l.custo,
  count(distinct c.id)                                     as contatos,
  count(distinct ce.contato_id) filter (where ce.etapa <> 'novo')     as tocados,
  count(distinct ce.contato_id) filter (where ce.etapa = 'cliente')   as clientes,
  coalesce(sum(ce.ltv), 0)::numeric(10,2)                  as receita,
  case when count(distinct c.id) = 0 then 0
       else round(l.custo / count(distinct c.id), 2) end   as custo_por_lead,
  case when count(distinct ce.contato_id) filter (where ce.etapa = 'cliente') = 0 then null
       else round(l.custo / count(distinct ce.contato_id) filter (where ce.etapa = 'cliente'), 2)
  end                                                      as custo_por_cliente
from prospeccao_listas l
left join prospeccao_contatos c on c.lista_id = l.id
left join prospeccao_contato_estado ce on ce.contato_id = c.id
group by l.id, l.nome, l.status, l.custo;

grant select on prospeccao_custo to anon, authenticated;
