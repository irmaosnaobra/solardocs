-- ============================================================================
-- Solar: lead da Nilce REMARCA com ela; conta alta circula Thiago ↔ Diego
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador de Propostas / Irmãos na Obra)
--
-- CONTEXTO
-- Desde 12/08/2026 o lead SOLAR é roteado por tamanho de conta: acima de 700
-- kWh/mês vai pro Thiago ou pro Diego, abaixo disso é da Nilce (código em
-- api/src/services/agenda/leadSolarFicha.ts → KWH_CORTE_TIME, e na LP /io/solar).
--
-- Só que o repasse automático de 12h sem ação NÃO mora no repo: é a função
-- public.processar_repasses(), chamada pelo pg_cron a cada 15 min (jobid 3). A
-- fila do solar lá dentro era Diego → Nilce → Thiago — ou seja, 12h depois ela
-- DESFAZIA a regra nova nos dois sentidos: mandava o lead grande do Thiago pra
-- Nilce e o lead pequeno da Nilce pro Diego.
--
-- A REGRA (decisão do Thiago, 12/08/2026)
--   • lead da Nilce (abaixo de 700 kWh): NÃO troca de dono — REMARCA com ela
--     mesma, próximo dia útil no mesmo horário, e o relógio de 12h reinicia. O
--     lead pequeno não vira problema do sócio, mas também não morre parado.
--   • lead do Thiago ou do Diego (acima de 700 kWh): vai de um pro outro.
--   • eletroposto: idêntico ao que já era (Thiago ↔ Diego, e card preso com quem
--     está fora do time volta pro 1º da fila).
--   • quem não faz solar (ex.: Giovanna): não circula, só para o relógio.
--
-- CONSEQUÊNCIA: card pequeno abandonado anda pra frente no calendário a cada
-- 12h, sempre com a Nilce, até alguém mexer nele. Ele nunca some da agenda dela
-- nem cai pra trás — é exatamente o "remarca pra ela" pedido.
--
-- Fila anterior (referência histórica — ver MIGRATION_repasse_eletroposto.sql):
--   fila := case when eh_ep then array['Thiago','Diego']
--                else array['Diego','Nilce','Thiago'] end;
--
-- COMO APLICAR: rodar este arquivo no SQL Editor do Supabase (projeto acima).
--
-- STATUS: APLICADO em 17/08/2026.
-- Ficou 5 dias só no disco (escrito em 12/08). Nesse intervalo o banco seguiu com
-- a fila velha e 50 fichas da Nilce foram parar no Thiago (e 59 do Diego caíram
-- na Nilce) — 85% dos 128 repasses na direção que esta regra proíbe. Arquivo
-- commitado não é regra no ar: pra conferir o que está VALENDO, leia a função no
-- banco, não este arquivo →
--   select prosrc from pg_proc where proname = 'processar_repasses';
-- ============================================================================

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
    -- A fila que CIRCULA é uma só, Thiago ↔ Diego, por motivos diferentes:
    --   • eletroposto: a Nilce não atende essa linha;
    --   • solar: quem circula é lead de conta alta, e conta alta é dos dois.
    -- A Nilce não está na fila porque o card dela não troca de dono — remarca
    -- com ela (ramo mais abaixo). O produto ainda importa pro card preso com
    -- quem está fora do time: casa por LIKE '%eletroposto%' e não por lista de
    -- created_by, já são duas origens (lp_eletroposto, manychat_eletroposto) e
    -- uma terceira nova cairia calada na regra do solar.
    eh_ep := coalesce(r.created_by,'') like '%eletroposto%';
    fila  := array['Thiago','Diego'];

    idx := array_position(fila, r.vendedor_nome);
    if idx is not null then
      -- Conta alta (e todo eletroposto): vai de um pro outro.
      proximo := fila[ (idx % array_length(fila,1)) + 1 ];
    elsif eh_ep then
      -- Card de eletroposto parado com quem está fora do time (ex.: Nilce, de um
      -- repasse antigo): devolve pro 1º da fila. Parar o relógio aqui deixaria o
      -- lead preso justamente com quem não deve atendê-lo.
      proximo := fila[1];
    elsif r.vendedor_nome = 'Nilce' then
      -- Solar da Nilce = lead abaixo de 700 kWh, que é DELA por regra. Não troca
      -- de dono: remarca com ela mesma no próximo dia útil (o resto do corpo já
      -- faz isso — acha slot livre, reinicia o relógio de 12h e carimba o
      -- histórico). Mandar pro Thiago/Diego é o que a regra de 12/08 proíbe;
      -- parar o relógio deixaria o lead apodrecendo numa data velha.
      proximo := 'Nilce';
    else
      -- Quem não faz solar (ex.: Giovanna): não circula, só para o relógio.
      update public.agendamentos set repassar_em = null where id = r.id;
      continue;
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
          -- Remarcação e repasse contam histórias diferentes: "Nilce → Nilce"
          -- no histórico faria o consultor procurar uma troca que não houve.
          historico = ('[' || carimbo || ' · Sistema] '
                       || case when proximo = r.vendedor_nome
                               then '🔁 Sem ação em 12h: remarcado com ' || proximo
                                    || ' para ' || to_char(novo_quando at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24"h"MI') || '.'
                               else '🔁 Repasse automático: ' || r.vendedor_nome || ' → ' || proximo
                                    || ' (sem ação em 12h).' end)
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
