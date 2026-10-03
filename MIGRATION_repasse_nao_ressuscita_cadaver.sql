-- ============================================================================
-- O repasse de 12h para de ressuscitar reunião de meses atrás
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador de Propostas / Irmãos na Obra)
--
-- ⚠️ ANTES DE RODAR, CONFIRA O QUE ESTÁ VALENDO. Esta função NÃO mora no repo,
--    ela se edita no SQL Editor. O corpo abaixo é o de 11/09/2026
--    (MIGRATION_carteira_giovanna_nao_circula.sql) mais o corte novo. Se alguém
--    mexeu nela entre 11/09 e hoje, este `create or replace` apaga a mudança
--    dessa pessoa sem avisar. Rode primeiro:
--
--      select prosrc from pg_proc where proname = 'processar_repasses';
--
--    e compare com o corpo deste arquivo. Só siga se a única diferença for o
--    bloco marcado "CORTE DE IDADE".
--
-- CONTEXTO
-- Em 03/10/2026 o Thiago abriu a agenda de 05 a 09/10 e achou 143 de 263 cards
-- com a reunião de origem a mais de 3 semanas: 29 deles a mais de dois meses, o
-- pior de 22/05. Ordem dele: "esses ficam onde estavam".
--
-- A causa principal era a janela dos dois reciclos, que eu tinha aberto de 7 pra
-- 365 dias em 29/09. Isso foi consertado no código (janela de 21 dias, commit
-- a813522d) e 51 cards foram devolvidos pra data onde pararam.
--
-- QUATRO DELES VOLTARAM EM DEZ MINUTOS, com esta linha no histórico:
--
--   [03/10 16h00 · Sistema] 🔁 Repasse automático: Thiago → Diego (sem ação em 12h).
--
-- É esta função. Ela não conhece a janela dos reciclos, e pra um card cuja
-- reunião foi em maio a condição dela — "12h sem ação" — é verdade PRA SEMPRE.
-- O card fica em pingue-pongue entre o Thiago e o Diego, e cada volta o
-- re-encaixa na grade. A cada 12 horas comerciais, indefinidamente.
--
-- POR QUE NÃO DEU PRA CONSERTAR DE FORA
-- O laço só pega `repassar_em is not null and repassar_em <= now()`, então zerar
-- essa coluna tiraria o card do laço. Medido em 03/10: NÃO FUNCIONA. Há trigger
-- recalculando `repassar_em` a partir do `quando` no mesmo UPDATE — eu gravei
-- null e a resposta do PostgREST já voltou com `2026-05-11T11:00`, ou seja a
-- origem mais 12h comerciais, que nasce vencida. Dois outros cards nem gravaram:
-- `agendamentos_vq_solar_uniq`, porque o repasse já tinha trocado o dono e o
-- horário de origem com o dono novo está ocupado.
--
-- (O ramo `dono_fixo` desta própria função zera `repassar_em` e FUNCIONA, porque
-- ele não toca no `quando`. É esse o padrão que o corte novo usa.)
--
-- A MUDANÇA
-- Um CORTE DE IDADE, depois do `dono_fixo` e antes da fila: reunião que passou
-- há mais de 21 dias não é repassada, só tem o relógio desligado. O card fica
-- exatamente onde está, com o dono que tem.
--
-- OS 21 DIAS SÃO O MESMO NÚMERO DE `janelaDias()` nos dois reciclos
-- (api/src/services/io/eletropostoReagendaAuto.ts e
--  api/src/services/agenda/reagendaSolarNaoAtendido.ts). Eles têm que andar
-- juntos: o Thiago vê UMA agenda, não três. Lá o número sai de env
-- (`EP_REAGENDA_JANELA_DIAS`, `SOLAR_REAGENDA_JANELA_DIAS`); aqui ele é literal,
-- porque função do Postgres não lê env. Quem mudar um tem que mudar o outro, e é
-- por isso que isto está escrito aqui e não só no commit.
--
-- O QUE ISTO NÃO FAZ, DE PROPÓSITO
-- Não mexe em card de negociação (`fez_orcamento`, `proposta_apresentada`,
-- `em_atendimento`, `arrendamento`, `carregador`, `meio_a_meio`, `chave_na_mao`,
-- `cotista`, `integrador`). O laço já só olha `status='agendado'`, e a regra do
-- Thiago pra negociação é o contrário: "os demais sempre avança na agenda até SEM
-- INTERESSE/APALAVRADO OU VENDIDO".
--
-- COMO APLICAR: rodar no SQL Editor do Supabase (projeto acima).
-- CONFERIR DEPOIS (arquivo commitado não é regra no ar):
--   select prosrc from pg_proc where proname = 'processar_repasses';
--   -- tem que conter a linha: r.quando < now() - (dias_janela || ' days')::interval
--
-- STATUS: NÃO APLICADO. Depende do Thiago rodar no SQL Editor.
-- ============================================================================

create or replace function public.processar_repasses()
returns integer
language plpgsql
as $function$
declare
  fila        text[];
  dono_fixo   text[] := array['Giovanna'];
  -- A MESMA janela dos dois reciclos. Ver o cabeçalho: os três números andam
  -- juntos ou a agenda passa a mentir pela metade.
  dias_janela int := 21;
  eh_ep       boolean;
  r           record;
  idx         int;
  proximo     text;
  hora_orig   time;
  hoje_sp     date := (now() at time zone 'America/Sao_Paulo')::date;
  dia_alvo    date;
  novo_quando timestamptz;
  carimbo     text;
  n           int := 0;
begin
  for r in
    select * from public.agendamentos
    where status='agendado' and repassar_em is not null and repassar_em <= now()
    for update skip locked
  loop
    -- CARTEIRA QUE NAO CIRCULA (ordem do Thiago, 11/09/2026). Vem ANTES da fila
    -- de proposito: quem esta com a Giovanna sai por VENDA ou por PERDIDO, nunca
    -- por robo. Vale inclusive pro card de eletroposto, que sem esta trava
    -- voltaria pro 1o da fila no ramo `eh_ep` abaixo.
    if r.vendedor_nome = any(dono_fixo) then
      update public.agendamentos set repassar_em = null where id = r.id;
      continue;
    end if;

    -- ── CORTE DE IDADE (ordem do Thiago, 03/10/2026) ──────────────────────
    -- "Esses ficam onde estavam." Reuniao que passou ha mais de `dias_janela`
    -- nao e repassada: o repasse re-encaixa o card na grade, e re-encaixar e
    -- justamente o que enchia a semana dele de gente de julho e de maio.
    --
    -- So o relogio desliga. O `quando` NAO e tocado, por duas razoes:
    --   1. pra um card encerrado ou esquecido, a data dele E onde ele parou;
    --   2. mexer no `quando` acorda o trigger que recalcula `repassar_em`, e o
    --      card voltaria pro laco na hora. Foi o que eu medi tentando consertar
    --      isto de fora, por PostgREST.
    if r.quando < now() - (dias_janela || ' days')::interval then
      update public.agendamentos set repassar_em = null where id = r.id;
      continue;
    end if;

    eh_ep := coalesce(r.created_by,'') like '%eletroposto%';
    fila  := array['Thiago','Diego'];

    idx := array_position(fila, r.vendedor_nome);
    if idx is not null then
      -- Conta alta (e todo eletroposto): vai de um pro outro.
      proximo := fila[ (idx % array_length(fila,1)) + 1 ];
    elsif eh_ep then
      -- Card de eletroposto parado com quem esta fora do time: devolve pro 1o da fila.
      proximo := fila[1];
    else
      -- Nilce e quem nao faz solar: nao circula, so para o relogio.
      -- A Nilce e' tratada pela varredura das 18h, que empacota no proximo dia util.
      update public.agendamentos set repassar_em = null where id = r.id;
      continue;
    end if;

    hora_orig := (r.quando at time zone 'America/Sao_Paulo')::time;
    dia_alvo := public.proximo_dia_util(hoje_sp);
    novo_quando := public.slot_dia_util(proximo, dia_alvo, hora_orig);

    if novo_quando is null then
      update public.agendamentos set repassar_em = now() + interval '1 hour' where id = r.id;
      continue;
    end if;

    carimbo := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24"h"MI');

    begin
      update public.agendamentos
      set vendedor_nome    = proximo,
          quando           = novo_quando,
          status           = 'agendado',
          repassar_em      = public.proximo_horario_comercial(novo_quando + interval '12 hour'),
          lembrete_3h_at   = null, lembrete_1h_at = null,
          lembrete_5min_at = null, confirmacao_at = null,
          historico = ('[' || carimbo || ' · Sistema] 🔁 Repasse automático: '
                       || r.vendedor_nome || ' → ' || proximo
                       || ' (sem ação em 12h).')
                      || case when r.historico is not null and r.historico <> ''
                              then E'\n\n' || r.historico else '' end
      where id = r.id;
      n := n + 1;
    exception when unique_violation then
      update public.agendamentos set repassar_em = now() + interval '15 minute' where id = r.id;
    end;
  end loop;

  return n;
end;
$function$;

-- ============================================================================
-- DEPOIS da função: desarmar o relógio dos que já estão vencidos
--
-- A função nova só desarma o card quando ele chega na vez dela. Estes já estão
-- com `repassar_em` vencido e com a reunião velha; sem este UPDATE, cada um deles
-- ainda daria uma volta no pingue-pongue antes de parar.
--
-- SÓ `repassar_em`, nada mais. Não toca no `quando` (acordaria o trigger) nem no
-- status nem no dono.
--
-- CONFERIR ANTES, pra saber quantos são:
--   select count(*) from public.agendamentos
--    where status = 'agendado' and repassar_em is not null
--      and quando < now() - interval '21 days';
-- ============================================================================

update public.agendamentos
   set repassar_em = null
 where status = 'agendado'
   and repassar_em is not null
   and quando < now() - interval '21 days';
