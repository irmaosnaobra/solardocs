-- ============================================================================
-- A carteira da Giovanna não circula: sai por VENDA ou por PERDIDO, nunca por robô
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador de Propostas / Irmãos na Obra)
--
-- CONTEXTO
-- Em 11/09/2026 todo o funil solar ativo do Thiago, do Diego e da Nilce virou
-- agenda da Giovanna: 180 fichas, 15 ligações por dia útil, de 14/09 a 29/09.
-- Ordem do Thiago no mesmo dia: "esses clientes dela agora não voltam para mais
-- nenhuma pessoa, ou perdido ou venda".
--
-- O QUE ESTAVA VALENDO, E POR QUE NÃO BASTAVA
-- O repasse automático de 12h é a public.processar_repasses(), chamada pelo
-- pg_cron a cada 15 min (jobid 3). Ela já deixava o card solar da Giovanna
-- parado — mas por TABELA, não por regra: o nome dela não está em `fila`, então
-- o card caía no ramo "não está na fila, só para o relógio". Duas coisas
-- quebravam isso em silêncio:
--   1. alguém pôr 'Giovanna' em `fila` (a função não mora no repo, se edita no
--      SQL Editor) — as 180 fichas viravam do Thiago e do Diego sem aviso;
--   2. card com created_by de eletroposto parado com ela cai no ramo `eh_ep` e
--      volta pro 1º da fila.
-- As 180 fichas estão com status='agendado', então TODAS passam por esta função
-- 12 horas comerciais depois do horário marcado. É uma porta que abre 180 vezes.
--
-- A MUDANÇA
-- Um corte por NOME (`dono_fixo`), ANTES da fila. Mesmo padrão do `ehSocio` do
-- api/src/services/agenda/agendaFechada.ts: quando a regra é sobre uma pessoa, o
-- corte é o nome dela, nunca o complemento de outra lista.
--
-- CONSEQUÊNCIA QUE É DE PROPÓSITO: card de eletroposto que caia com ela também
-- fica parado, em vez de voltar pro Thiago. Ela não atende eletroposto e hoje
-- tem zero card assim; se um aparecer, quem devolve é gente, não o cron.
--
-- O resto da função é byte a byte o que estava no banco em 11/09/2026.
-- Referência da regra anterior: MIGRATION_repasse_solar_700kwh.sql.
--
-- COMO APLICAR: rodar no SQL Editor do Supabase (projeto acima).
-- CONFERIR o que está VALENDO (arquivo commitado não é regra no ar):
--   select prosrc from pg_proc where proname = 'processar_repasses';
--
-- STATUS: APLICADO em 11/09/2026.
-- ============================================================================

create or replace function public.processar_repasses()
returns integer
language plpgsql
as $function$
declare
  fila        text[];
  dono_fixo   text[] := array['Giovanna'];
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
