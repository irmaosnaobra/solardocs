-- Banco: PRINCIPAL do SolarDoc (projeto solardoc-pro). Rodou em 19/11/2026.
-- Lista de interesse da NEXUS (link da bio do Instagram): frentes do eletroposto,
-- itens de mobilidade eletrica, objetivo, faixa de investimento, recurso e contato.
-- Le-se no /admin, hub "NEXUS Instagram". A api grava com a service role.
-- Substitui a nexus_interesse do banco do Gerador (que ficou sem uso).

create table if not exists public.nexus_instagram_interesse (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  nome          text not null,
  telefone      text not null unique,   -- so digitos, com DDI 55
  email         text,
  cep           text,
  endereco      text,                   -- rua, numero e complemento
  bairro        text,
  cidade        text,
  uf            text,
  eletroposto   text[] not null default '{}',  -- frentes: cotista, investidor, arrendamento, chave_na_mao, parceiro, so_carregador
  mobilidade    text[] not null default '{}',  -- itens de mobilidade e energia
  outro         text,                   -- o que procura e nao estava na lista
  objetivo      text check (objetivo in ('proprio','frota','revenda','investir')),
  investimento  text check (investimento in ('ate_10','10_50','50_100','100_250','250_500','500_mais','naosei')),
  recurso       text check (recurso in ('proprio','financiamento','os_dois','naosei')),
  origem        text,
  utm           jsonb,
  teste         boolean not null default false
);

create index if not exists nexus_instagram_interesse_criado_idx
  on public.nexus_instagram_interesse (criado_em desc);

-- Sem policy de proposito: a chave publica nao le nem escreve.
alter table public.nexus_instagram_interesse enable row level security;

-- Gravacao atomica: une as listas, preenche so campo vazio (ninguem troca o
-- cadastro de outra pessoa pelo telefone dela), acrescenta o "outro" novo e
-- devolve so a posicao. So a service role executa.
create or replace function public.nexus_instagram_gravar(
  p_nome text, p_telefone text, p_email text, p_cep text, p_endereco text,
  p_bairro text, p_cidade text, p_uf text, p_eletroposto text[], p_mobilidade text[],
  p_outro text, p_objetivo text, p_investimento text, p_recurso text,
  p_origem text, p_utm jsonb, p_teste boolean
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare v_id bigint; v_novo boolean; v_pos bigint;
begin
  insert into nexus_instagram_interesse as t
    (nome, telefone, email, cep, endereco, bairro, cidade, uf, eletroposto, mobilidade,
     outro, objetivo, investimento, recurso, origem, utm, teste)
  values
    (p_nome, p_telefone, nullif(p_email,''), nullif(p_cep,''), nullif(p_endereco,''),
     nullif(p_bairro,''), nullif(p_cidade,''), nullif(p_uf,''),
     coalesce(p_eletroposto,'{}'), coalesce(p_mobilidade,'{}'), nullif(p_outro,''),
     p_objetivo, p_investimento, p_recurso, nullif(p_origem,''), p_utm, coalesce(p_teste,false))
  on conflict (telefone) do update set
    eletroposto  = array(select distinct x from unnest(t.eletroposto || excluded.eletroposto) as x),
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
    atualizado_em = now()
  returning t.id, (t.xmax = 0) into v_id, v_novo;

  select count(*) into v_pos from nexus_instagram_interesse where teste = false and id <= v_id;
  return jsonb_build_object('posicao', greatest(v_pos, 1), 'novo', v_novo);
end $$;

revoke all on function public.nexus_instagram_gravar(text,text,text,text,text,text,text,text,text[],text[],text,text,text,text,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.nexus_instagram_gravar(text,text,text,text,text,text,text,text,text[],text[],text,text,text,text,text,jsonb,boolean) to service_role;
