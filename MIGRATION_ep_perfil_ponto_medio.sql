-- ─────────────────────────────────────────────────────────────────────────────
-- O perfil do lead de eletroposto parou de ser gravado em 10/09/2026
--
-- A LP escreve a 1ª linha da observação como `LP ELETROPOSTO · <perfil>`. Até
-- 10/09 o separador era o travessão (`—`), e o trigger `eletroposto_estruturar`
-- casa por essa linha para preencher `perfil_slug`. Quando a LP trocou para o
-- ponto médio, o regex do trigger ficou para trás e passou a não casar nada.
--
-- Medido em 28/09/2026, reuniões com `created_by like '%eletroposto%'`:
--   semana de 17/08 → 28 de 28 com perfil_slug
--   semana de 14/09 →  0 de 99
--   semana de 21/09 →  0 de 83
-- `motivo_descarte` cai junto, porque `ep_motivos()` recebe o perfil.
--
-- APLICADO EM PRODUÇÃO em 28/09/2026 (migration `ep_estruturar_aceita_ponto_medio`
-- + o backfill abaixo, 191 linhas recuperadas). Este arquivo é o registro: conferir
-- sempre com sonda, arquivo no repo não prova que a migration rodou.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) O slug do perfil passa a ignorar a porta do carregador ------------------
--    Aquela porta (24/09/2026) não pergunta o perfil: a 1ª linha dela é o nome da
--    PORTA. Sem este caso ela cairia no `else 'outro'` e inflaria o segmento
--    "outro" com metade da agenda (31 das 64 reuniões de 24 a 28/09).
create or replace function public.ep_slug_perfil(t text)
 returns text
 language sql
 immutable
as $function$
  select case
    when t is null or btrim(t) = '' then null
    when t like 'COMPRA DE CARREGADOR%' then null
    when t like 'Dono de posto%'  then 'posto'
    when t like 'Mercado%'        then 'mercado'
    when t like 'Restaurante%'    then 'restaurante'
    when t like 'Academia%'       then 'academia'
    when t like 'Farm%'           then 'farmacia'
    when t like 'Hotel%'          then 'hotel'
    when t like 'Estacionamento%' then 'estacionamento'
    when t like 'Condom%'         then 'condominio'
    when t like 'Investidor%'     then 'investidor'
    else 'outro'
  end
$function$;

-- 2) O trigger aceita os DOIS separadores -------------------------------------
--    `[—·]` em vez de `—`. Aceitar os dois (e não trocar por um) é o que mantém a
--    ficha antiga legível: quem reprocessar uma reunião de agosto continua achando
--    o perfil dela.
create or replace function public.eletroposto_estruturar()
 returns trigger
 language plpgsql
as $function$
declare
  obs      text := coalesce(new.observacao, '');
  v_perfil text; v_ponto text; v_invest text; v_decisor text; v_rota text; v_trif text;
begin
  if new.created_by is null or new.created_by not like '%eletroposto%' then
    return new;
  end if;

  v_perfil  := public.ep_slug_perfil ((regexp_match(obs, '^LP ELETROPOSTO [—·] (.+)$',   'n'))[1]);
  v_ponto   := public.ep_slug_ponto  ((regexp_match(obs, '^Ponto:\s*(.+)$',                 'n'))[1]);
  v_invest  := public.ep_slug_invest ((regexp_match(obs, '^Como pretende investir:\s*(.+)$','n'))[1]);
  v_decisor := public.ep_slug_decisor((regexp_match(obs, '^Decisor:\s*(.+)$',               'n'))[1]);
  v_rota    := public.ep_slug_rota   ((regexp_match(obs, '^Rota de passagem:\s*(.+)$',      'n'))[1]);
  v_trif    :=                        (regexp_match(obs, '^Entrada trif.sica:\s*(.+)$',     'n'))[1];

  new.perfil_slug     := coalesce(new.perfil_slug,   v_perfil);
  new.tem_ponto       := coalesce(new.tem_ponto,     v_ponto);
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

  -- 3) A PORTA DO CARREGADOR FICA FORA DA RÉGUA DE DESCARTE (28/09/2026) -------
  --    Desde 28/09 essa porta grava a linha `Ponto:` (é o que põe a reunião no
  --    estudo do local e no Top 20). Com `tem_ponto` preenchido e perfil, capital
  --    e decisor nulos, `ep_motivos()` devolveria ['sem_ponto'] para quem responde
  --    "em vista" ou "não tenho ideia" — carimbando como descartado o comprador de
  --    frota ou de revenda, que nunca precisou de ponto. Medido antes de mexer:
  --      ep_motivos(null,'em_vista', null,null) = {sem_ponto}
  --      ep_motivos(null,'sem_ideia',null,null) = {sem_ponto}
  --      ep_motivos(null, null,      null,null) = null  ← o que valia até 28/09
  --    A régua de descarte é a da trilha do PONTO e pressupõe quem veio montar no
  --    próprio local; esta porta não responde nenhuma pergunta dela.
  if new.motivo_descarte is null and obs not like '%COMPRA DE CARREGADOR%' then
    new.motivo_descarte := public.ep_motivos(new.perfil_slug, new.tem_ponto,
                                             new.capital_faixa, new.decisor_tipo);
  end if;

  return new;
end $function$;

-- 4) Backfill das fichas que nasceram no período do bug -----------------------
--    Só onde o perfil está nulo E o texto tem perfil: não reescreve nada que já
--    tenha valor, e não inventa perfil para a porta do carregador.
update agendamentos a
set perfil_slug = public.ep_slug_perfil((regexp_match(a.observacao, '^LP ELETROPOSTO [—·] (.+)$', 'n'))[1])
where a.created_by ilike '%eletroposto%'
  and a.perfil_slug is null
  and public.ep_slug_perfil((regexp_match(a.observacao, '^LP ELETROPOSTO [—·] (.+)$', 'n'))[1]) is not null;

-- Sonda: as três semanas voltam a 100% de perfil preenchido, menos as fichas da
-- porta do carregador, que são nulas de propósito.
--   select date_trunc('week', created_at)::date, count(*),
--          count(*) filter (where perfil_slug is not null)
--   from agendamentos where created_by ilike '%eletroposto%'
--     and created_at >= '2026-09-07' group by 1 order by 1;
