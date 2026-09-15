-- ============================================================================
-- A carteira da Nilce também não circula: a mesma regra da Giovanna
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador de Propostas / Irmãos na Obra)
--
-- CONTEXTO
-- Em 15/09/2026 o Thiago dividiu a agenda da ação de 11/09. A semana de 14 a
-- 18/09 ficou inteira com a Giovanna; das 105 fichas marcadas de 21 a 29/09, 52
-- passaram pra Nilce, no mesmo dia e horário, alternando dentro do dia. A ordem
-- veio junto: a Nilce, "a partir de hoje 15/09 pra frente, nas mesmas regras da
-- Giovanna".
--
-- A regra da Giovanna é: cliente que está com ela sai por VENDA ou por PERDIDO,
-- nunca por robô (MIGRATION_carteira_giovanna_nao_circula.sql).
--
-- A MUDANÇA
-- 'Nilce' entra no `dono_fixo`. Pra card solar dela isso não muda nada hoje: ela
-- já caía no ramo "não está na fila, só para o relógio". Mas a regra deixa de
-- depender da tabela, pelo mesmo motivo que a da Giovanna deixou: alguém pôr
-- 'Nilce' em `fila` pelo SQL Editor passaria a carteira dela pros sócios em
-- silêncio.
--
-- CONSEQUÊNCIA QUE É DE PROPÓSITO: card de eletroposto parado com a Nilce fica
-- parado, em vez de voltar pro Thiago. Quem devolve é gente, não o cron.
--
-- ANDA JUNTO, NO MESMO DIA
--   • A passagem das 19h Nilce → Giovanna perdeu o agendamento
--     (.github/workflows/nilce-para-giovanna.yml). Com ela ligada, cada ficha
--     dividida voltava pra Giovanna na noite do próprio horário.
--   • O bom dia das 7h e o "oi" de 5 min (solarAgendaGiovanna.ts) valem pras duas.
--   • A Nilce voltou a receber a lista das 17h (reagendarDigest.ts).
--
-- DESFAZER A DIVISÃO: a tabela backup_divisao_nilce_20260915 guarda id, dono,
-- quando, status, temperatura, repassar_em e histórico de antes.
--
-- O resto da função é byte a byte o que estava no banco em 15/09/2026, menos o
-- comentário do ramo `else`, que citava uma varredura das 18h que não existe mais.
--
-- COMO APLICAR: rodar no SQL Editor do Supabase (projeto acima).
-- CONFERIR o que está VALENDO (arquivo commitado não é regra no ar):
--   select prosrc from pg_proc where proname = 'processar_repasses';
--
-- STATUS: APLICADO em 15/09/2026.
-- ============================================================================

create or replace function public.processar_repasses()
returns integer
language plpgsql
as $function$
declare
  fila        text[];
  dono_fixo   text[] := array['Giovanna','Nilce'];
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
    -- CARTEIRA QUE NAO CIRCULA (ordem do Thiago: Giovanna em 11/09/2026, Nilce em
    -- 15/09/2026). Vem ANTES da fila de proposito: quem esta com elas sai por
    -- VENDA ou por PERDIDO, nunca por robo. Vale inclusive pro card de
    -- eletroposto, que sem esta trava voltaria pro 1o da fila no ramo `eh_ep`.
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
      -- Quem nao faz solar: nao circula, so para o relogio.
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
