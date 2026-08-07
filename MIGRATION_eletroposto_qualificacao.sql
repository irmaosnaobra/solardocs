-- ─────────────────────────────────────────────────────────────────────────────
-- QUALIFICAÇÃO DO ELETROPOSTO EM COLUNA  (Supabase: gerador-propostas)
--
-- Hoje a nota do lead existe só como TEXTO dentro de `agendamentos.observacao`
-- ("NOTA 3 · 10/11 pts"), e o alerta da equipe a lê de volta com regex
-- (api/src/routes/ioEletroposto.ts). Isso funciona pra mandar um WhatsApp, mas
-- não dá pra:
--   · contar quantos nota 1/2/3 cada criativo trouxe (painel de métricas);
--   · dizer ao PlugCash QUAL foi a falta que desqualificou o cara — que é
--     justamente o que escolhe o "seu próximo passo" e a oferta da esteira.
--
-- Esta migration transforma o texto em coluna, de três jeitos que se cobrem:
--   1. FUNÇÕES de mapeamento (rótulo da LP → slug), fonte única da verdade;
--   2. TRIGGER que preenche as colunas vazias a partir da observação — assim
--      lead novo entra estruturado mesmo se a LP (HTML estático, cacheado)
--      ainda estiver na versão velha;
--   3. BACKFILL do histórico que já está gravado.
--
-- A régua espelhada aqui é a de dashboard/public/io/eletroposto/index.html
-- (função `pontuar`): perfil 3 + ponto 3 + investimento 3 + decisor 2 = 11.
-- Mudou lá? Muda aqui. As duas pontas leem os MESMOS rótulos de <option>.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · Mapeadores rótulo → slug ────────────────────────────────────────────
-- A LP grava o texto que o lead viu na tela ("Já tenho o ponto definido"), não o
-- value do <option>. Estes LIKEs casam com o texto e usam % no lugar do acento
-- pra não quebrar se alguém corrigir uma cedilha na LP.

create or replace function public.ep_slug_perfil(t text) returns text
language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then null
    when t like 'Dono de posto%'  then 'posto'
    when t like 'Mercado%'        then 'mercado'
    when t like 'Restaurante%'    then 'restaurante'
    when t like 'Academia%'       then 'academia'
    when t like 'Farm%'           then 'farmacia'
    when t like 'Hotel%'          then 'hotel'
    when t like 'Estacionamento%' then 'estacionamento'
    when t like 'Condom%'         then 'condominio'
    when t like 'Investidor%'     then 'investidor'
    -- "Outro: Fotógrafo" — o que o lead digitou vira o rótulo, mas pontua 0 igual
    else 'outro'
  end
$$;

create or replace function public.ep_slug_ponto(t text) returns text
language sql immutable as $$
  select case
    when t is null or btrim(t) = ''            then null
    when t like 'J% tenho o ponto definido%'   then 'definido'
    when t like 'Tenho um local em negocia%'   then 'negociando'
    when t like 'Tenho um local em vista%'     then 'em_vista'
    when t like 'N%o tenho ideia%'             then 'sem_ideia'
    else null
  end
$$;

create or replace function public.ep_slug_invest(t text) returns text
language sql immutable as $$
  select case
    when t is null or btrim(t) = ''              then null
    -- próprio + crédito ANTES de próprio: o segundo é prefixo do primeiro
    when t like 'Recurso pr%prio + cart%'        then 'proprio_credito'
    when t like 'Recurso pr%prio%'               then 'proprio'
    when t like 'Financiamento%aprovado%'        then 'fin_aprovado'
    when t like 'Financiamento%CNPJ%'            then 'fin_cnpj'
    when t like 'Financiamento%banco%'           then 'fin_banco'
    when t like 'Ainda n%o sei%'                 then 'naosei'
    else null
  end
$$;

create or replace function public.ep_slug_decisor(t text) returns text
language sql immutable as $$
  select case
    when t is null or btrim(t) = ''   then null
    when t like 'Eu decido%'          then 'eu'
    when t like 'Eu e meu%'           then 'socio'
    when t like 'Preciso aprovar%'    then 'terceiros'
    else null
  end
$$;

create or replace function public.ep_slug_rota(t text) returns text
language sql immutable as $$
  select case
    when t is null or btrim(t) = ''        then null
    when t like 'Sim, fica em rodovia%'    then 'rodovia'
    when t like 'Fica em %rea comercial%'  then 'comercial'
    when t like 'N%o sei estimar%'         then 'naosei'
    else null
  end
$$;

-- ── 2 · Motivo do descarte ──────────────────────────────────────────────────
-- É a lista de critérios que ZERARAM na régua. Um lead pode aparecer em mais de
-- um, e é essa lista que o PlugCash usa pra escolher a oferta ("sem ponto" →
-- Ponto Zero; "sem capital" → trilha de financiamento; etc).
-- Devolve NULL — e não '{}' — quando não deu pra ler resposta nenhuma, senão
-- ficha ilegível se passaria por "não faltou nada".
create or replace function public.ep_motivos(perfil text, ponto text, invest text, decisor text)
returns text[] language sql immutable as $$
  select case
    when perfil is null and ponto is null and invest is null and decisor is null then null
    else array_remove(array[
      case when ponto   = 'sem_ideia'              then 'sem_ponto'   end,
      case when invest  = 'naosei'                 then 'sem_capital' end,
      case when decisor = 'terceiros'              then 'nao_decisor' end,
      case when perfil in ('investidor','outro')   then 'fluxo_baixo' end
    ], null)
  end
$$;

-- ── 3 · Colunas ─────────────────────────────────────────────────────────────

alter table public.agendamentos
  add column if not exists pontuacao_total int,
  add column if not exists nota            smallint,
  add column if not exists perfil_slug     text,
  add column if not exists tem_ponto       text,
  add column if not exists capital_faixa   text,
  add column if not exists decisor_tipo    text,
  add column if not exists e_decisor       boolean,
  add column if not exists rota_tipo       text,
  add column if not exists trifasica       boolean,
  add column if not exists simulou_kw      int,
  add column if not exists fluxo_estimado  int,      -- carros/dia que ele simulou
  add column if not exists motivo_descarte text[],
  add column if not exists vsl_watch_pct   int,      -- preenchido quando a VSL entrar
  add column if not exists utm_source      text,
  add column if not exists utm_medium      text,
  add column if not exists utm_campaign    text,
  add column if not exists utm_content     text,
  add column if not exists utm_term        text;

alter table public.eletroposto_nota1
  add column if not exists nota            smallint default 1,
  add column if not exists perfil_slug     text,
  add column if not exists tem_ponto       text,
  add column if not exists capital_faixa   text,
  add column if not exists decisor_tipo    text,
  add column if not exists e_decisor       boolean,
  add column if not exists rota_tipo       text,
  add column if not exists motivo_descarte text[],
  add column if not exists email           text,     -- provisionamento da conta PlugCash
  add column if not exists utm_source      text,
  add column if not exists utm_medium      text,
  add column if not exists utm_campaign    text,
  add column if not exists utm_content     text,
  add column if not exists utm_term        text;

-- O painel de métricas filtra por nota dentro de um período, sempre nesta ordem.
create index if not exists idx_agendamentos_ep_nota
  on public.agendamentos (created_by, nota, created_at desc);
create index if not exists idx_agendamentos_ep_utm
  on public.agendamentos (utm_content) where utm_content is not null;

-- ── 4 · Trigger: ficha nova entra estruturada mesmo com LP velha em cache ────

create or replace function public.eletroposto_estruturar() returns trigger
language plpgsql as $$
declare
  obs      text := coalesce(new.observacao, '');
  v_perfil text; v_ponto text; v_invest text; v_decisor text; v_rota text; v_trif text;
begin
  -- 'lp_eletroposto' e 'manychat_eletroposto'. Reunião de solar e ficha digitada
  -- à mão no CRM passam direto — não têm régua e não podem ganhar nota fantasma.
  if new.created_by is null or new.created_by not like '%eletroposto%' then
    return new;
  end if;

  v_perfil  := public.ep_slug_perfil ((regexp_match(obs, '^LP ELETROPOSTO — (.+)$',        'n'))[1]);
  v_ponto   := public.ep_slug_ponto  ((regexp_match(obs, '^Ponto:\s*(.+)$',                'n'))[1]);
  v_invest  := public.ep_slug_invest ((regexp_match(obs, '^Como pretende investir:\s*(.+)$','n'))[1]);
  v_decisor := public.ep_slug_decisor((regexp_match(obs, '^Decisor:\s*(.+)$',              'n'))[1]);
  v_rota    := public.ep_slug_rota   ((regexp_match(obs, '^Rota de passagem:\s*(.+)$',     'n'))[1]);
  -- trif.sica: o '.' cobre o acento sem depender de como o arquivo foi salvo
  v_trif    :=                        (regexp_match(obs, '^Entrada trif.sica:\s*(.+)$',    'n'))[1];

  -- coalesce em tudo: o que a LP já mandou explícito manda mais que o parse.
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

  if new.motivo_descarte is null then
    new.motivo_descarte := public.ep_motivos(new.perfil_slug, new.tem_ponto,
                                             new.capital_faixa, new.decisor_tipo);
  end if;

  return new;
end $$;

drop trigger if exists trg_eletroposto_estruturar on public.agendamentos;
create trigger trg_eletroposto_estruturar
  before insert or update on public.agendamentos
  for each row execute function public.eletroposto_estruturar();

-- Nota 1 já chega com as respostas em coluna própria (a LP posta em /io/eletroposto/nota1),
-- só falta traduzir rótulo → slug. E nota é sempre 1: é o que a tabela é.
create or replace function public.eletroposto_nota1_estruturar() returns trigger
language plpgsql as $$
begin
  new.nota          := coalesce(new.nota, 1);
  new.perfil_slug   := coalesce(new.perfil_slug,   public.ep_slug_perfil(new.perfil));
  new.tem_ponto     := coalesce(new.tem_ponto,     public.ep_slug_ponto(new.ponto));
  new.capital_faixa := coalesce(new.capital_faixa, public.ep_slug_invest(new.invest));
  new.decisor_tipo  := coalesce(new.decisor_tipo,  public.ep_slug_decisor(new.decisor));
  new.rota_tipo     := coalesce(new.rota_tipo,     public.ep_slug_rota(new.rota));
  new.e_decisor     := coalesce(new.e_decisor,
                                case when new.decisor_tipo is null then null
                                     else new.decisor_tipo = 'eu' end);
  if new.motivo_descarte is null then
    new.motivo_descarte := public.ep_motivos(new.perfil_slug, new.tem_ponto,
                                             new.capital_faixa, new.decisor_tipo);
  end if;
  return new;
end $$;

drop trigger if exists trg_eletroposto_nota1_estruturar on public.eletroposto_nota1;
create trigger trg_eletroposto_nota1_estruturar
  before insert or update on public.eletroposto_nota1
  for each row execute function public.eletroposto_nota1_estruturar();

-- ── 5 · Backfill ────────────────────────────────────────────────────────────
-- `observacao = observacao` é de propósito: dispara o trigger e faz o histórico
-- passar pela MESMA lógica da ficha nova — nenhuma regra duplicada aqui embaixo.
-- Ficha anterior a 01/08 não tem a linha "NOTA x": nota e pontuação ficam NULL,
-- e isso é o certo. Inventar nota pra elas contaminaria a comparação de criativo.
-- O WHERE deixa de fora quem já está estruturado: o backfill pode rodar de novo
-- sem tocar em linha que não precisa (e sem passar de novo pelo trg_set_repassar_em).
update public.agendamentos
   set observacao = observacao
 where created_by like '%eletroposto%'
   and observacao is not null
   and motivo_descarte is null;

update public.eletroposto_nota1
   set telefone = telefone
 where motivo_descarte is null;

-- ── 6 · Ponte com o PlugCash: telefone em forma canônica ────────────────────
-- Aplicado logo depois do bloco acima. O PlugCash mora em OUTRO projeto Supabase
-- (solardoc-pro) e precisa achar a ficha do lead pelo telefone. Os formatos não
-- batem: `users.whatsapp` tem 10, 11 ou 13 dígitos, com ou sem o 55 e às vezes
-- mascarado; aqui é sempre 13. Igualdade crua daria zero para sempre, e casar
-- pelos últimos 10 dígitos comeria o primeiro dígito do DDD — 32999126804 e
-- 82999126804 virariam o mesmo número.
-- Forma canônica: DDD (2) + os 8 últimos dígitos. Estável entre o formato de 8 e
-- o de 9 dígitos, sem colisão entre DDDs.
create or replace function public.ep_tel_norm(t text) returns text
language sql immutable as $$
  select case
    when length(d) in (12, 13) and left(d, 2) = '55'
      then left(right(d, length(d) - 2), 2) || right(d, 8)
    when length(d) in (10, 11)
      then left(d, 2) || right(d, 8)
    else null
  end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) s
$$;

alter table public.eletroposto_nota1
  add column if not exists telefone_norm text
  generated always as (public.ep_tel_norm(telefone)) stored;

alter table public.agendamentos
  add column if not exists telefone_norm text
  generated always as (public.ep_tel_norm(cliente_telefone)) stored;

create index if not exists idx_eletroposto_nota1_tel_norm
  on public.eletroposto_nota1 (telefone_norm);
create index if not exists idx_agendamentos_tel_norm
  on public.agendamentos (telefone_norm);
