-- ─────────────────────────────────────────────────────────────────────────────
-- FERIADO NACIONAL PASSA A EXISTIR PARA O BANCO (03/09/2026).
--
-- APLICADA em ancecdfqfwlaujknizof (gerador-propostas) na mesma data. Conferido
-- pelo prosrc, não pela existência deste arquivo: processar_repasses() chama as
-- duas funções abaixo e é o cron do repasse de 12h que marca a reunião do lead.
--
-- O buraco: proximo_dia_util e slot_dia_util só pulavam sábado e domingo. A LP,
-- a API e o robô já barravam feriado — o banco não, e era ele quem escolhia o
-- dia no repasse automático. Um lead repassado numa sexta caía na segunda,
-- mesmo sendo 07/09.
--
-- Os feriados são CALCULADOS, não listados: os móveis penduram na Páscoa e a
-- Páscoa tem fórmula fechada (algoritmo gregoriano anônimo). Vale para qualquer
-- ano, sem manutenção anual. Mesma regra de api/src/utils/feriadosBR.ts e das
-- duas LPs — quatro implementações da MESMA conta, porque são quatro runtimes
-- (Postgres, Node e o JavaScript solto de cada LP).
--
-- Conferência depois de aplicar:
--   select public.proximo_dia_util('2026-09-04');  -- 2026-09-08, não 09-07
--   select public.eh_feriado_br('2028-12-25');     -- true (a lista antiga ia até 2027)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.pascoa_br(ano int)
returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int;
        i int; k int; l int; m int; mes int; dia int;
begin
  a := ano % 19;  b := ano / 100;  c := ano % 100;
  d := b / 4;     e := b % 4;      f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19*a + b - d - g + 15) % 30;
  i := c / 4;     k := c % 4;
  l := (32 + 2*e + 2*i - h - k) % 7;
  m := (a + 11*h + 22*l) / 451;
  mes := (h + l - 7*m + 114) / 31;
  dia := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(ano, mes, dia);
end;
$$;

create or replace function public.eh_feriado_br(d date)
returns boolean language plpgsql immutable as $$
declare ano int := extract(year from d)::int;
        p date := public.pascoa_br(ano);
begin
  -- Fixos. 20/11 (Consciência Negra) é nacional desde a Lei 14.759/2023.
  if to_char(d, 'MM-DD') in
     ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')
  then return true; end if;
  -- Móveis, todos ancorados na Páscoa.
  return d in (p - 48, p - 47, p - 2, p + 60);
end;
$$;

-- Um dia só é útil se não for fim de semana E não for feriado nacional.
create or replace function public.dia_util_br(d date)
returns boolean language sql immutable as $$
  select extract(dow from d) not in (0,6) and not public.eh_feriado_br(d);
$$;

create or replace function public.proximo_dia_util(base date)
returns date language plpgsql immutable as $$
declare d date := base + 1; voltas int := 0;
begin
  -- Teto: emenda maior que 10 dias não existe no calendário nacional, e sem ele
  -- um erro em dia_util_br viraria laço infinito dentro do cron do repasse.
  while not public.dia_util_br(d) and voltas < 10 loop
    d := d + 1; voltas := voltas + 1;
  end loop;
  return d;
end;
$$;

create or replace function public.slot_dia_util(consultor text, dia_ini date, hora_desejada time without time zone)
returns timestamp with time zone language plpgsql stable as $$
declare
  dia  date := dia_ini;
  h    time;
  cand timestamptz;
  voltas int := 0;
  pulos  int := 0;
begin
  -- garante dia útil (agora inclui feriado)
  while not public.dia_util_br(dia) and pulos < 10 loop
    dia := dia + 1; pulos := pulos + 1;
  end loop;
  loop
    exit when voltas > 10;  -- trava de segurança: até 10 dias úteis
    h := greatest(hora_desejada, time '08:00');
    if h > time '19:45' then h := time '19:45'; end if;
    loop
      exit when h > time '19:45';
      cand := (dia::timestamp + h) at time zone 'America/Sao_Paulo';
      if not exists (select 1 from public.agendamentos
                     where vendedor_nome=consultor and quando=cand and status<>'cancelado') then
        return cand;
      end if;
      h := h + interval '15 minute';
    end loop;
    -- dia cheio: próximo dia útil, começando na hora original de novo
    dia := dia + 1;
    pulos := 0;
    while not public.dia_util_br(dia) and pulos < 10 loop
      dia := dia + 1; pulos := pulos + 1;
    end loop;
    voltas := voltas + 1;
  end loop;
  return null;
end;
$$;
