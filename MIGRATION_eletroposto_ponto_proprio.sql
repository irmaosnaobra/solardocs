-- ─────────────────────────────────────────────────────────────────────────────
-- PONTO PRÓPRIO — a régua de agendamento de 29/08/2026  (Supabase: gerador-propostas)
--
-- Ordem do Thiago: a agenda do especialista é pra quem TEM o ponto. Estava
-- chegando muita gente que diz ter o local e não tem — e a reunião de quem
-- realmente fecha ficava sem horário.
--
-- O que mudou na LP (dashboard/public/io/eletroposto/index.html):
--   1. 'negociando' entrou no corte. Só 'definido' continua marcando reunião.
--      SEM_LOCAL agora é {sem_ideia, em_vista, negociando}.
--   2. Quem responde 'definido' responde EM SEGUIDA de quem é o local
--      ("O local é seu?"), e só passa quem controla o imóvel hoje:
--      proprietário, administra, representa o dono, inquilino. "Ainda não é meu"
--      é NOTA 1 — os mesmos rótulos da porta do ponto em /io/eletroposto/parceria.
--
-- Esta migration é a ponta do BANCO da mesma régua. Ela NÃO decide quem agenda
-- (isso é o `pontuar()` da LP, e o trigger só lê o texto "NOTA x" da observação) —
-- mas ela NÃO é enfeite de relatório: `ponto_relacao` é o que deixa a régua nova
-- LEGÍVEL pra equipe. Sem a coluna, a ficha de quem disse ter o ponto e respondeu
-- que ele ainda não é dele entra na aba Arrendamento com tem_ponto = 'definido',
-- do lado de quem tem a chave do lugar — e é a lista mais escassa da operação
-- (1 ponto para 96 investidores no placar de hoje). Enquanto ela não roda, quem
-- separa os dois é o sufixo que a LP escreve no texto da resposta.
--
-- Ordem de leitura: MIGRATION_eletroposto_qualificacao.sql vem antes desta.
-- ─────────────────────────────────────────────────────────────────────────────

-- TUDO EM UMA TRANSAÇÃO. O passo 3 DERRUBA a ep_motivos de 4 argumentos que os
-- triggers em produção ainda chamam: entre esse drop e o create das funções novas
-- (passo 4) qualquer insert em agendamentos ou eletroposto_nota1 quebraria — e é
-- exatamente nesse intervalo que a LP grava reunião. Uma transação fecha a janela.
begin;

-- ── 1 · Rótulo → slug da relação com o imóvel ───────────────────────────────
-- A LP grava o texto que o lead viu ("Sou o proprietário"), como faz com todas
-- as outras respostas. O % no lugar do acento é o mesmo padrão das ep_slug_*:
-- não quebra se alguém corrigir uma cedilha na página.
create or replace function public.ep_slug_relacao(t text) returns text
language sql immutable as $$
  select case
    when t is null or btrim(t) = ''        then null
    when t like 'Sou o propriet%'          then 'proprietario'
    when t like 'Administro%'              then 'administro'
    when t like 'Represento%'              then 'represento'
    when t like 'Sou inquilino%'           then 'inquilino'
    when t like 'Ainda n%o %'              then 'nao_e_meu'
    else null
  end
$$;

-- ── 2 · Coluna nova nas duas tabelas ────────────────────────────────────────
alter table public.agendamentos
  add column if not exists ponto_relacao text;
alter table public.eletroposto_nota1
  add column if not exists ponto_relacao text;

comment on column public.agendamentos.ponto_relacao is
  'Relação do lead com o imóvel do ponto (proprietario/administro/represento/inquilino/nao_e_meu). LP eletroposto, 29/08/2026.';
comment on column public.eletroposto_nota1.ponto_relacao is
  'Relação do lead com o imóvel do ponto. "nao_e_meu" é o que o cortou da agenda.';

-- ── 3 · Motivo do descarte passa a enxergar as duas metades do corte ────────
-- 'sem_ponto' agora sai também pra quem NEGOCIA o local e pra quem escolheu um
-- local que ainda não é dele. É o mesmo bloqueio comercial: não há ponto pra
-- estudar, e a página de destino (parceria/material) fala exatamente disso.
--
-- A assinatura ganhou um 5º parâmetro. A versão de 4 args é DERRUBADA em vez de
-- coexistir: com DEFAULT null nas duas, toda chamada de 4 argumentos ficaria
-- ambígua e o trigger quebraria em runtime.
drop function if exists public.ep_motivos(text, text, text, text);

create or replace function public.ep_motivos(perfil text, ponto text, invest text,
                                             decisor text, relacao text default null)
returns text[] language sql immutable as $$
  select case
    when perfil is null and ponto is null and invest is null and decisor is null then null
    else array_remove(array[
      -- 'em_vista' entrou em 14/08 e 'negociando' em 29/08 (régua de ponto próprio);
      -- 'nao_e_meu' é a mesma falta declarada na pergunta seguinte da LP.
      case when ponto in ('sem_ideia','em_vista','negociando')
             or relacao = 'nao_e_meu'              then 'sem_ponto'   end,
      case when invest  = 'naosei'                 then 'sem_capital' end,
      case when decisor = 'terceiros'              then 'nao_decisor' end,
      case when perfil in ('investidor','outro')   then 'fluxo_baixo' end
    ], null)
  end
$$;

-- ── 4 · Triggers: lêem a linha "Local é seu:" e preenchem a coluna ──────────
-- Só as duas linhas novas mudaram em cada função; o resto é idêntico ao arquivo
-- anterior, e continua sendo a única cópia da lógica (nada duplicado no backfill).
create or replace function public.eletroposto_estruturar() returns trigger
language plpgsql as $$
declare
  obs      text := coalesce(new.observacao, '');
  v_perfil text; v_ponto text; v_invest text; v_decisor text; v_rota text; v_trif text;
  v_relacao text;
begin
  if new.created_by is null or new.created_by not like '%eletroposto%' then
    return new;
  end if;

  v_perfil  := public.ep_slug_perfil ((regexp_match(obs, '^LP ELETROPOSTO — (.+)$',        'n'))[1]);
  v_ponto   := public.ep_slug_ponto  ((regexp_match(obs, '^Ponto:\s*(.+)$',                'n'))[1]);
  v_invest  := public.ep_slug_invest ((regexp_match(obs, '^Como pretende investir:\s*(.+)$','n'))[1]);
  v_decisor := public.ep_slug_decisor((regexp_match(obs, '^Decisor:\s*(.+)$',              'n'))[1]);
  v_rota    := public.ep_slug_rota   ((regexp_match(obs, '^Rota de passagem:\s*(.+)$',     'n'))[1]);
  -- 'Local . seu:' — o ponto cobre o "é" sem depender de como o arquivo foi salvo
  v_relacao := public.ep_slug_relacao((regexp_match(obs, '^Local . seu:\s*(.+)$',          'n'))[1]);
  v_trif    :=                        (regexp_match(obs, '^Entrada trif.sica:\s*(.+)$',    'n'))[1];

  new.perfil_slug     := coalesce(new.perfil_slug,   v_perfil);
  new.tem_ponto       := coalesce(new.tem_ponto,     v_ponto);
  new.ponto_relacao   := coalesce(new.ponto_relacao, v_relacao);
  new.capital_faixa   := coalesce(new.capital_faixa, v_invest);
  new.decisor_tipo    := coalesce(new.decisor_tipo,  v_decisor);
  new.rota_tipo       := coalesce(new.rota_tipo,     v_rota);
  new.e_decisor       := coalesce(new.e_decisor,
                                  case when new.decisor_tipo is null then null
                                       else new.decisor_tipo = 'eu' end);
  new.trifasica       := coalesce(new.trifasica,
                                  case when v_trif is null then null
                                       when v_trif like 'Sim%' then true
                                       else false end);
  new.nota            := coalesce(new.nota,
                                  nullif((regexp_match(obs, 'NOTA ([123])\s*·'))[1], '')::int);
  new.pontuacao_total := coalesce(new.pontuacao_total,
                                  nullif((regexp_match(obs, 'NOTA [123]\s*·\s*(\d+)/11'))[1], '')::int);
  new.simulou_kw      := coalesce(new.simulou_kw,
                                  nullif((regexp_match(obs, '^Simulou (\d+) kW', 'n'))[1], '')::int);
  new.fluxo_estimado  := coalesce(new.fluxo_estimado,
                                  nullif((regexp_match(obs, 'com (\d+) carros/dia'))[1], '')::int);

  if new.motivo_descarte is null then
    new.motivo_descarte := public.ep_motivos(new.perfil_slug, new.tem_ponto,
                                             new.capital_faixa, new.decisor_tipo,
                                             new.ponto_relacao);
  end if;

  return new;
end $$;

-- Na ficha de NOTA 1 a linha vive no texto de `ficha` (a rota /nota1 grava as
-- respostas em coluna, mas a relação não tem coluna própria vindo da LP — ela
-- chega escrita na ficha, do mesmo jeito que o consultor lê).
create or replace function public.eletroposto_nota1_estruturar() returns trigger
language plpgsql as $$
begin
  new.nota          := coalesce(new.nota, 1);
  new.perfil_slug   := coalesce(new.perfil_slug,   public.ep_slug_perfil(new.perfil));
  new.tem_ponto     := coalesce(new.tem_ponto,     public.ep_slug_ponto(new.ponto));
  new.ponto_relacao := coalesce(new.ponto_relacao,
                                public.ep_slug_relacao(
                                  (regexp_match(coalesce(new.ficha, ''),
                                                '^Local . seu:\s*(.+)$', 'n'))[1]));
  new.capital_faixa := coalesce(new.capital_faixa, public.ep_slug_invest(new.invest));
  new.decisor_tipo  := coalesce(new.decisor_tipo,  public.ep_slug_decisor(new.decisor));
  new.rota_tipo     := coalesce(new.rota_tipo,     public.ep_slug_rota(new.rota));
  new.e_decisor     := coalesce(new.e_decisor,
                                case when new.decisor_tipo is null then null
                                     else new.decisor_tipo = 'eu' end);
  if new.motivo_descarte is null then
    new.motivo_descarte := public.ep_motivos(new.perfil_slug, new.tem_ponto,
                                             new.capital_faixa, new.decisor_tipo,
                                             new.ponto_relacao);
  end if;
  return new;
end $$;

commit;

-- ── 5 · Sem backfill, de propósito ──────────────────────────────────────────
-- Reprocessar o histórico com a régua nova marcaria 'sem_ponto' em reunião que
-- foi marcada dentro da régua ANTIGA, onde 'negociando' passava. O que aconteceu
-- aconteceu sob a régua daquele dia — reescrever isso apaga justamente a
-- comparação que vai dizer se o corte funcionou (quanta reunião de 'negociando'
-- existia por semana antes de 29/08, e quanta existe depois).
--
-- Para medir o corte depois de alguns dias:
--
--   select date_trunc('week', created_at) semana, tem_ponto, count(*)
--     from public.agendamentos
--    where created_by = 'lp_eletroposto'
--    group by 1, 2 order by 1 desc, 3 desc;
--
--   select ponto_relacao, count(*) from public.agendamentos
--    where created_by = 'lp_eletroposto' and created_at >= '2026-08-29'
--    group by 1 order by 2 desc;
