-- ════════════════════════════════════════════════════════════
-- Numeração da proposta sem voltar atrás (projeto solardoc-pro, 14/09/2026)
-- Aplicada via apply_migration com o nome reservar_codigo_curto.
--
-- Por quê: o codigo_curto (YYYYNNNN, o número impresso e o do link
-- /p/<slug>.<numero>) era MAX+1 sobre as linhas de documents que ainda existem. A
-- limpeza diária dos docs PRO (cleanupProDocuments) apaga as mais velhas; quando
-- some a linha do maior número, a sequência recomeça num número já impresso e já
-- mandado a outro cliente, e o link antigo passa a abrir a proposta nova.
--
-- O contador fica em documentos_numeracao e nunca volta. No primeiro uso de cada
-- integrador ele parte do maior número que ainda existe. Limite conhecido: quem
-- teve TODAS as propostas do ano apagadas antes do contador existir recomeça do 1.
--
-- A api chama com a chave secreta (service_role). anon e authenticated não
-- executam a função nem leem a tabela.
--
-- Este arquivo não prova que rodou. Sonda:
--   select to_regprocedure('public.reservar_codigo_curto(uuid,integer)') is not null;
--   select has_function_privilege('anon', 'public.reservar_codigo_curto(uuid,integer)', 'execute');  -- false
-- ════════════════════════════════════════════════════════════

create table if not exists public.documentos_numeracao (
  user_id uuid not null,
  ano integer not null check (ano between 2000 and 2999),
  ultimo integer not null check (ultimo >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, ano)
);
alter table public.documentos_numeracao enable row level security;
revoke all on table public.documentos_numeracao from anon, authenticated;

create or replace function public.reservar_codigo_curto(p_user_id uuid, p_ano integer)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_max_doc integer;
  v_num integer;
begin
  if p_user_id is null or p_ano is null then
    raise exception 'reservar_codigo_curto: parametros nulos';
  end if;

  select coalesce(max(right(codigo_curto, 4)::integer), 0)
    into v_max_doc
    from public.documents
   where user_id = p_user_id
     and codigo_curto between p_ano::text || '0000' and p_ano::text || '9999';

  insert into public.documentos_numeracao as n (user_id, ano, ultimo)
  values (p_user_id, p_ano, v_max_doc + 1)
  on conflict (user_id, ano)
  do update set ultimo = greatest(n.ultimo, v_max_doc) + 1,
                atualizado_em = now()
  returning n.ultimo into v_num;

  if v_num > 9999 then
    raise exception 'reservar_codigo_curto: passou de 9999 no ano % para %', p_ano, p_user_id;
  end if;

  return p_ano::text || lpad(v_num::text, 4, '0');
end;
$$;

revoke execute on function public.reservar_codigo_curto(uuid, integer) from public, anon, authenticated;
grant execute on function public.reservar_codigo_curto(uuid, integer) to service_role;

notify pgrst, 'reload schema';
