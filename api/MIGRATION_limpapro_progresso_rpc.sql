-- LimpaPro: gravar o progresso do aluno com UM UPDATE atomico, sem ler e regravar o objeto inteiro.
--
-- Antes: a api lia limpapro_membros.progresso, trocava uma chave e regravava tudo; duas gravacoes quase juntas (o app e a
-- area de membros antiga) podiam apagar a chave uma da outra. Agora:
--   marcar:    progresso = progresso || jsonb_build_object(chave, true)
--   desmarcar: progresso = progresso - chave
-- O teto de 200 chaves vale so ao MARCAR uma chave nova (desmarcar nunca falha por isso).
--
-- Aplicar DEPOIS de MIGRATION_limpapro_aulas.sql ou antes: e independente. Enquanto nao existir, a api usa o caminho antigo.
-- Idempotente (create or replace). Chamada so pela service key da api.

create or replace function public.limpapro_progresso_set(p_email text, p_chave text, p_valor boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  atual jsonb;
  novo  jsonb;
begin
  if p_email is null or p_chave is null or p_chave !~ '^(chk:)?[a-z0-9-]{1,40}(#|:)[0-9]{1,3}$' then
    raise exception 'chave_invalida';
  end if;

  select coalesce(progresso, '{}'::jsonb) into atual from public.limpapro_membros where email = p_email for update;
  if not found then
    return null;
  end if;

  if p_valor then
    if not (atual ? p_chave) and (select count(*) from jsonb_object_keys(atual)) >= 200 then
      raise exception 'progresso_cheio';
    end if;
    novo := atual || jsonb_build_object(p_chave, true);
  else
    novo := atual - p_chave;
  end if;

  update public.limpapro_membros set progresso = novo, atualizado_em = now() where email = p_email;
  return novo;
end;
$$;

revoke all on function public.limpapro_progresso_set(text, text, boolean) from public, anon, authenticated;
grant execute on function public.limpapro_progresso_set(text, text, boolean) to service_role;
