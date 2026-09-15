-- ─────────────────────────────────────────────────────────────────────────────
-- ESTUDO DO LOCAL (15/09/2026): tabela eletroposto_estudos e as funções de acesso.
--
-- Aplicada pelo MCP apply_migration no projeto do Gerador. Este arquivo é REGISTRO:
-- ele não prova que rodou. As sondas no fim é que provam.
--
-- ── Por que tudo passa por função com segredo ──
-- A API fala com este banco pela chave publishable, que está no código deste repo
-- público (api/src/utils/supabaseGerador.ts), porque a SUPABASE_GERADOR_SERVICE_KEY
-- não está na Vercel. A tabela guarda rua, número e primeiro nome do lead, então ela
-- não pode ter policy para o anon.
--
-- Solução: RLS ligada e SEM policy (ninguém de fora lê nem escreve a tabela) e o
-- acesso só por funções SECURITY DEFINER que conferem um segredo. O segredo mora
-- só na Vercel (EP_ESTUDO_DB_SEGREDO, projeto solardocs-api). O banco guarda apenas
-- o sha256 dele em ep_estudo_chave, também sem policy. Quem tem a chave publishable
-- e não tem o segredo recebe "nao autorizado" em toda função.
--
-- Quando a service key entrar na Vercel, nada muda: a service_role também executa
-- as funções com o segredo.
--
-- O VALOR do hash não está neste arquivo. Ele foi gravado direto no banco.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.eletroposto_estudos (
  id bigint generated always as identity primary key,
  agendamento_id bigint not null unique
    references public.agendamentos(id) on delete cascade,
  token text not null unique check (token ~ '^[a-f0-9]{64}$'),
  origem text not null default 'alerta'
    check (origem in ('alerta','rede','backfill','manual')),
  status text not null default 'pendente'
    check (status in ('pendente','processando','pronto','parcial','sem_endereco','descartado','erro')),
  tentativas smallint not null default 0,
  locked_until timestamptz,
  municipio_ibge integer,
  confianca text check (confianca in ('alta','media','baixa','nao_encontrado')),
  pre_nota smallint check (pre_nota between 0 and 100),
  indice numeric(3,1) check (indice between 0 and 10),
  situacao text check (situacao in ('pronto','confirmar')),
  dados jsonb not null default '{}'::jsonb,
  fontes jsonb not null default '{}'::jsonb,
  custo_usd numeric(8,4) not null default 0,
  erro text,
  aviso_enviado_em timestamptz,
  historico_em timestamptz,
  coords_apagadas_em timestamptz,
  created_at timestamptz not null default now(),
  pronto_em timestamptz
);
create index if not exists eletroposto_estudos_fila
  on public.eletroposto_estudos (created_at)
  where status in ('pendente','processando');
create index if not exists eletroposto_estudos_ibge
  on public.eletroposto_estudos (municipio_ibge, pronto_em desc);
create index if not exists eletroposto_estudos_limpeza
  on public.eletroposto_estudos (pronto_em)
  where coords_apagadas_em is null;
create index if not exists eletroposto_estudos_aviso
  on public.eletroposto_estudos (pronto_em)
  where aviso_enviado_em is null or historico_em is null;
alter table public.eletroposto_estudos enable row level security;
revoke all on table public.eletroposto_estudos from anon, authenticated;

create table if not exists public.ep_estudo_chave (
  id smallint primary key default 1 check (id = 1),
  hash text not null check (hash ~ '^[a-f0-9]{64}$'),
  criado_em timestamptz not null default now()
);
alter table public.ep_estudo_chave enable row level security;
revoke all on table public.ep_estudo_chave from anon, authenticated;

-- ── o porteiro ─────────────────────────────────────────────────────────────
create or replace function public.ep_estudo_autorizado(p_segredo text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.ep_estudo_chave
     where length(coalesce(p_segredo, '')) >= 32
       and hash = encode(extensions.digest(p_segredo, 'sha256'), 'hex')
  );
$$;
revoke all on function public.ep_estudo_autorizado(text) from public, anon, authenticated;

-- ── cria a linha do estudo (idempotente por reunião) e devolve o token ──────
create or replace function public.ep_estudo_garantir(
  p_segredo text, p_agendamento_id bigint, p_token text, p_origem text,
  p_dados jsonb default '{}'::jsonb, p_aviso_enviado boolean default false
) returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  insert into public.eletroposto_estudos (agendamento_id, token, origem, dados, aviso_enviado_em)
  values (p_agendamento_id, p_token, p_origem, coalesce(p_dados, '{}'::jsonb),
          case when p_aviso_enviado then now() end)
  on conflict (agendamento_id) do nothing;
  return (select token from public.eletroposto_estudos where agendamento_id = p_agendamento_id);
end $$;

-- ── a página: estudo e o mínimo da reunião, sem telefone ───────────────────
create or replace function public.ep_estudo_ler(p_segredo text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'estudo', to_jsonb(e),
      'reuniao', jsonb_build_object(
        'quando', a.quando, 'status', a.status, 'vendedor_nome', a.vendedor_nome,
        'cliente_nome', a.cliente_nome, 'cidade', a.cidade, 'observacao', a.observacao))
      from public.eletroposto_estudos e
      join public.agendamentos a on a.id = e.agendamento_id
     where e.token = p_token
  );
end $$;

-- ── listas do tick ─────────────────────────────────────────────────────────
create or replace function public.ep_estudo_listar(
  p_segredo text, p_modo text, p_ids bigint[] default null, p_limite integer default 20
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  lim integer := least(greatest(coalesce(p_limite, 20), 1), 200);
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select e.* from public.eletroposto_estudos e
       where case p_modo
         when 'fila' then e.status in ('pendente','processando')
                      and (e.locked_until is null or e.locked_until < now())
         when 'aviso' then e.status in ('pronto','parcial') and e.aviso_enviado_em is null
         when 'historico' then e.status in ('pronto','parcial') and e.historico_em is null
         when 'limpeza' then e.pronto_em < now() - interval '30 days' and e.coords_apagadas_em is null
         when 'por_agendamentos' then e.agendamento_id = any(coalesce(p_ids, '{}'))
         when 'ibge' then e.municipio_ibge = (coalesce(p_ids, '{}'))[1]
                      and e.pronto_em > now() - interval '30 days'
         else false
       end
       order by case when p_modo = 'ibge' then e.pronto_em end desc nulls last, e.created_at
       limit lim
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.ep_estudo_contar_prontos(p_segredo text, p_desde timestamptz)
returns integer language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  return (select count(*)::integer from public.eletroposto_estudos where pronto_em >= p_desde);
end $$;

-- ── claim com lease: dois ticks nunca processam a mesma linha ──────────────
create or replace function public.ep_estudo_pegar(
  p_segredo text, p_id bigint, p_tentativas smallint, p_lease_seg integer
) returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  update public.eletroposto_estudos
     set status = 'processando',
         locked_until = now() + make_interval(secs => p_lease_seg),
         tentativas = tentativas + 1
   where id = p_id
     and tentativas = p_tentativas
     and tentativas < 3
     and status in ('pendente','processando')
     and (locked_until is null or locked_until < now());
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ── grava o resultado: só as colunas desta lista ───────────────────────────
create or replace function public.ep_estudo_salvar(p_segredo text, p_id bigint, p_patch jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  update public.eletroposto_estudos set
    status = case when p_patch ? 'status' then p_patch->>'status' else status end,
    locked_until = case when p_patch ? 'locked_until' then (p_patch->>'locked_until')::timestamptz else locked_until end,
    municipio_ibge = case when p_patch ? 'municipio_ibge' then (p_patch->>'municipio_ibge')::integer else municipio_ibge end,
    confianca = case when p_patch ? 'confianca' then p_patch->>'confianca' else confianca end,
    pre_nota = case when p_patch ? 'pre_nota' then (p_patch->>'pre_nota')::smallint else pre_nota end,
    indice = case when p_patch ? 'indice' then (p_patch->>'indice')::numeric else indice end,
    situacao = case when p_patch ? 'situacao' then p_patch->>'situacao' else situacao end,
    dados = case when p_patch ? 'dados' then p_patch->'dados' else dados end,
    fontes = case when p_patch ? 'fontes' then p_patch->'fontes' else fontes end,
    custo_usd = case when p_patch ? 'custo_usd' then (p_patch->>'custo_usd')::numeric else custo_usd end,
    erro = case when p_patch ? 'erro' then p_patch->>'erro' else erro end,
    pronto_em = case when p_patch ? 'pronto_em' then (p_patch->>'pronto_em')::timestamptz else pronto_em end,
    coords_apagadas_em = case when p_patch ? 'coords_apagadas_em' then (p_patch->>'coords_apagadas_em')::timestamptz else coords_apagadas_em end
  where id = p_id;
end $$;

-- ── carimbo do aviso e da linha do CRM: marcar só se estiver vazio ──────────
create or replace function public.ep_estudo_marcar(p_segredo text, p_id bigint, p_campo text, p_ligar boolean)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  if p_campo = 'aviso' then
    if p_ligar then
      update public.eletroposto_estudos set aviso_enviado_em = now() where id = p_id and aviso_enviado_em is null;
    else
      update public.eletroposto_estudos set aviso_enviado_em = null where id = p_id;
    end if;
  elsif p_campo = 'historico' then
    if p_ligar then
      update public.eletroposto_estudos set historico_em = now() where id = p_id and historico_em is null;
    else
      update public.eletroposto_estudos set historico_em = null where id = p_id;
    end if;
  else
    raise exception 'campo invalido' using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ── linha no histórico da ficha do CRM ─────────────────────────────────────
create or replace function public.ep_estudo_historico(p_segredo text, p_id bigint, p_linha text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.ep_estudo_autorizado(p_segredo) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;
  -- Só reunião que tem estudo: o segredo não vira caneta para o CRM inteiro.
  update public.agendamentos
     set historico = case when coalesce(historico, '') = '' then p_linha
                          else p_linha || E'\n\n' || historico end
   where id = p_id
     and exists (select 1 from public.eletroposto_estudos e where e.agendamento_id = p_id);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.ep_estudo_garantir(text,bigint,text,text,jsonb,boolean)',
    'public.ep_estudo_ler(text,text)',
    'public.ep_estudo_listar(text,text,bigint[],integer)',
    'public.ep_estudo_contar_prontos(text,timestamptz)',
    'public.ep_estudo_pegar(text,bigint,smallint,integer)',
    'public.ep_estudo_salvar(text,bigint,jsonb)',
    'public.ep_estudo_marcar(text,bigint,text,boolean)',
    'public.ep_estudo_historico(text,bigint,text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;

-- ── o hash do segredo (valor fora deste arquivo) ───────────────────────────
-- insert into public.ep_estudo_chave (id, hash) values (1, '<sha256 do EP_ESTUDO_DB_SEGREDO>')
--   on conflict (id) do update set hash = excluded.hash, criado_em = now();

-- ── sondas de depois ───────────────────────────────────────────────────────
-- select relname, relrowsecurity from pg_class where relname in ('eletroposto_estudos','ep_estudo_chave');   -- true, true
-- select count(*) from pg_policies where tablename in ('eletroposto_estudos','ep_estudo_chave');              -- 0
-- select has_table_privilege('anon','public.eletroposto_estudos','select');                                   -- false
-- select has_function_privilege('anon','public.ep_estudo_autorizado(text)','execute');                         -- false
-- select public.ep_estudo_contar_prontos('segredo-errado-com-mais-de-trinta-e-dois-caracteres', now());       -- erro 42501
-- select count(*) from public.ep_estudo_chave;                                                                -- 1
