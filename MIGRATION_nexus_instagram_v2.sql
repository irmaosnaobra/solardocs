-- Banco: PRINCIPAL do SolarDoc (projeto solardoc-pro). Rodou em 19/11/2026.
-- Lista de interesse NEXUS, versao 2: o eletroposto ganha perguntas proprias por
-- caminho (cotista, investidor, arrendamento, chave_na_mao, parceiro, so_carregador),
-- guardadas em eletroposto_respostas = { "<caminho>": { "<campo>": "<valor>" } },
-- e o cadastro guarda se o WhatsApp existe (whatsapp_ok: true, false ou null = nao verificado).
-- A funcao v1 (nexus_instagram_gravar) fica sem uso.

alter table public.nexus_instagram_interesse
  add column if not exists eletroposto_respostas jsonb not null default '{}'::jsonb,
  add column if not exists whatsapp_ok boolean;

create or replace function public.nexus_instagram_gravar_v2(
  p_nome text, p_telefone text, p_email text, p_cep text, p_endereco text,
  p_bairro text, p_cidade text, p_uf text, p_eletroposto text[], p_eletroposto_respostas jsonb,
  p_mobilidade text[], p_outro text, p_objetivo text, p_investimento text, p_recurso text,
  p_origem text, p_utm jsonb, p_teste boolean, p_whatsapp_ok boolean
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare v_id bigint; v_novo boolean; v_pos bigint;
begin
  insert into nexus_instagram_interesse as t
    (nome, telefone, email, cep, endereco, bairro, cidade, uf, eletroposto, eletroposto_respostas,
     mobilidade, outro, objetivo, investimento, recurso, origem, utm, teste, whatsapp_ok)
  values
    (p_nome, p_telefone, nullif(p_email,''), nullif(p_cep,''), nullif(p_endereco,''),
     nullif(p_bairro,''), nullif(p_cidade,''), nullif(p_uf,''),
     coalesce(p_eletroposto,'{}'), coalesce(p_eletroposto_respostas,'{}'::jsonb),
     coalesce(p_mobilidade,'{}'), nullif(p_outro,''),
     p_objetivo, p_investimento, p_recurso, nullif(p_origem,''), p_utm, coalesce(p_teste,false), p_whatsapp_ok)
  on conflict (telefone) do update set
    eletroposto  = array(select distinct x from unnest(t.eletroposto || excluded.eletroposto) as x),
    -- Respostas por caminho: o que ja existe vale (lado direito do || ganha).
    eletroposto_respostas = coalesce(excluded.eletroposto_respostas,'{}'::jsonb) || coalesce(t.eletroposto_respostas,'{}'::jsonb),
    mobilidade   = array(select distinct x from unnest(t.mobilidade || excluded.mobilidade) as x),
    outro        = case
                     when coalesce(t.outro,'') = '' then excluded.outro
                     when coalesce(excluded.outro,'') = '' or position(excluded.outro in t.outro) > 0 then t.outro
                     else left(t.outro || ' | ' || excluded.outro, 600)
                   end,
    nome         = coalesce(nullif(t.nome,''), excluded.nome),
    email        = coalesce(nullif(t.email,''), excluded.email),
    cep          = coalesce(nullif(t.cep,''), excluded.cep),
    endereco     = coalesce(nullif(t.endereco,''), excluded.endereco),
    bairro       = coalesce(nullif(t.bairro,''), excluded.bairro),
    cidade       = coalesce(nullif(t.cidade,''), excluded.cidade),
    uf           = coalesce(nullif(t.uf,''), excluded.uf),
    objetivo     = coalesce(t.objetivo, excluded.objetivo),
    investimento = coalesce(t.investimento, excluded.investimento),
    recurso      = coalesce(t.recurso, excluded.recurso),
    origem       = coalesce(nullif(t.origem,''), excluded.origem),
    utm          = coalesce(t.utm, excluded.utm),
    teste        = t.teste and excluded.teste,
    whatsapp_ok  = case when excluded.whatsapp_ok is true then true else coalesce(t.whatsapp_ok, excluded.whatsapp_ok) end,
    atualizado_em = now()
  returning t.id, (t.xmax = 0) into v_id, v_novo;

  select count(*) into v_pos from nexus_instagram_interesse where teste = false and id <= v_id;
  return jsonb_build_object('posicao', greatest(v_pos, 1), 'novo', v_novo);
end $$;

revoke all on function public.nexus_instagram_gravar_v2(text,text,text,text,text,text,text,text,text[],jsonb,text[],text,text,text,text,text,jsonb,boolean,boolean) from public, anon, authenticated;
grant execute on function public.nexus_instagram_gravar_v2(text,text,text,text,text,text,text,text,text[],jsonb,text[],text,text,text,text,text,jsonb,boolean,boolean) to service_role;
