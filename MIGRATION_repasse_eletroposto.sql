-- ⚠️ SUPERADO EM PARTE por MIGRATION_repasse_solar_700kwh.sql (12/08/2026): a
-- fila do SOLAR deixou de ser Diego → Nilce → Thiago. A versão vigente da função
-- processar_repasses() está lá; este arquivo continua valendo pelo resto
-- (colunas proposta_por/proposta_em e o one-shot dos cards de eletroposto).
-- ============================================================================
-- Eletroposto: repasse só entre Thiago e Diego + "Proposta apresentada"
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador de Propostas / Irmãos na Obra)
--
-- Contexto: o repasse automático de 12h sem ação NÃO mora no repo — é a função
-- public.processar_repasses(), chamada pelo pg_cron a cada 15 min (jobid 3).
-- Este arquivo passa a ser a fonte da verdade dela.
--
-- O que muda:
--   1. Lead de eletroposto circula só Thiago ↔ Diego. A Nilce não atende essa
--      linha, então some da fila desses cards (a fila do solar fica intacta:
--      Diego → Nilce → Thiago).
--   2. Card de eletroposto que ficou preso com quem não é do time (Nilce, de um
--      repasse antigo) volta pra fila em vez de parar o relógio pra sempre.
--   3. Colunas proposta_por / proposta_em: quem REALMENTE apresentou a proposta.
--      Depois de 1-2 repasses o vendedor_nome do card não conta essa história.
--
-- Versão anterior da fila (pra referência histórica):
--   fila text[] := array['Diego','Nilce','Thiago'];   -- fixa, valia pra todos
--   if idx is null then update ... set repassar_em = null; continue; end if;
-- ============================================================================

-- ── 1. Quem apresentou a proposta ───────────────────────────────────────────
alter table public.agendamentos
  add column if not exists proposta_por text,
  add column if not exists proposta_em  timestamptz;

comment on column public.agendamentos.proposta_por is
  'Consultor que de fato apresentou a proposta (pode não ser o vendedor_nome atual, que muda no repasse).';

-- Coluna nova não herda grant column-level; explicita (redundante se o grant
-- original foi table-level, e inofensivo nesse caso).
grant select (proposta_por, proposta_em),
      insert (proposta_por, proposta_em),
      update (proposta_por, proposta_em)
  on public.agendamentos to anon, authenticated;

-- ── 2. Repasse com fila por produto ─────────────────────────────────────────
create or replace function public.processar_repasses()
returns integer
language plpgsql
as $function$
declare
  fila        text[];
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
    -- Fila por produto. Eletroposto = Thiago/Diego (a Nilce não atende essa
    -- linha). Casa por LIKE '%eletroposto%' e não por lista de created_by: já
    -- são duas origens (lp_eletroposto, manychat_eletroposto) e uma terceira
    -- nova cairia calada na fila do solar.
    eh_ep := coalesce(r.created_by,'') like '%eletroposto%';
    fila  := case when eh_ep then array['Thiago','Diego']
                  else array['Diego','Nilce','Thiago'] end;

    idx := array_position(fila, r.vendedor_nome);
    if idx is null then
      if eh_ep then
        -- Card de eletroposto parado com quem está fora do time (ex.: Nilce,
        -- de um repasse antigo): devolve pro 1º da fila. Parar o relógio aqui
        -- deixaria o lead preso justamente com quem não deve atendê-lo.
        proximo := fila[1];
      else
        -- Fora da fila (ex.: Giovanna): não circula, só para o relógio.
        update public.agendamentos set repassar_em = null where id = r.id;
        continue;
      end if;
    else
      -- rodízio circular: próximo índice, voltando ao 1 depois do último
      proximo := fila[ (idx % array_length(fila,1)) + 1 ];
    end if;

    hora_orig := (r.quando at time zone 'America/Sao_Paulo')::time;
    -- próximo dia útil a partir de HOJE (não da data antiga do lead) → não some pro futuro
    dia_alvo := public.proximo_dia_util(hoje_sp);
    novo_quando := public.slot_dia_util(proximo, dia_alvo, hora_orig);

    if novo_quando is null then
      -- sem slot em 10 dias úteis (muito improvável): adia o relógio, tenta depois
      update public.agendamentos set repassar_em = now() + interval '1 hour' where id = r.id;
      continue;
    end if;

    carimbo := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24"h"MI');

    begin
      update public.agendamentos
      set vendedor_nome    = proximo,
          quando           = novo_quando,
          status           = 'agendado',
          -- Relógio novo explícito (mesma regra do trigger set_repassar_em).
          -- O trigger só recalcula quando quando/status MUDAM — e o slot pode
          -- sair igual ao anterior (o horário do lead estava livre pro próximo).
          -- Sem esta linha, o repassar_em vencido continuava lá e o card
          -- pulava de novo no ciclo seguinte, sem dar as 12h a quem recebeu.
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

-- ── 3. One-shot: cards de eletroposto ABERTOS que estão com a Nilce ─────────
-- Só adianta o relógio; o próprio cron move (reusa a alocação de slot já
-- testada, sem risco de bater no índice único vendedor+quando).
-- Fechados (sem_interesse/cancelado) ficam como estão: são registro histórico.
update public.agendamentos
set repassar_em = now()
where created_by like '%eletroposto%'
  and status = 'agendado'
  and vendedor_nome not in ('Thiago','Diego');
