-- ═══════════════════════════════════════════════════════════════════════════
-- O ÚLTIMO PASSO: TIRAR A LEITURA DO PAPEL ANÔNIMO
--
-- NÃO RODE ISTO ANTES DE FAZER O PASSO 1 ABAIXO. Sem ele, a API perde acesso ao
-- banco no mesmo segundo e as duas landing pages param de agendar.
--
-- ── CONTEXTO ──
-- Em 18/08/2026 duas coisas já foram feitas:
--   · as LPs públicas não carregam mais chave de banco (agendam pela API)
--   · o /gerador tem login de verdade — cada consultor manda o token DELE
-- Sobrou um consumidor do papel `anon` neste projeto: a própria API, que fala
-- com o Supabase do gerador pela chave publishable (api/src/utils/supabaseGerador.ts).
--
-- Enquanto a API for `anon`, tirar a leitura do anon derruba a API junto. Por
-- isso a ordem é esta:
--
-- ── PASSO 1 (fora do SQL, e é o único que falta) ──
-- 1a. Supabase → projeto "gerador-propostas" → Settings → API → copiar a
--     service_role key.
-- 1b. Vercel → projeto solardocs-api → Settings → Environment Variables →
--     criar SUPABASE_GERADOR_SERVICE_KEY com esse valor (Production).
-- 1c. Trocar api/src/utils/supabaseGerador.ts pra ler essa env, com a chave
--     publishable como fallback (assim um deploy sem a var não derruba nada).
-- 1d. Deploy e conferir: a LP do eletroposto ainda agenda, a aba Cadastros ainda
--     lista. A service_role IGNORA RLS, então a partir daqui a API é imune ao
--     que este arquivo faz.
--
-- ── PASSO 2 (este arquivo) ──
-- Aí sim, rodar o que está abaixo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── As três tabelas do eletroposto nasceram sem RLS ──
-- eletroposto_nota1 é de 01/08 e as outras duas de 17-18/08; as três copiaram a
-- postura da primeira. É onde mora o dado mais sensível que temos: nome,
-- telefone e o ENDEREÇO do imóvel de quem oferece o ponto.
alter table public.eletroposto_nota1    enable row level security;
alter table public.eletroposto_parceria enable row level security;
alter table public.eletroposto_match    enable row level security;

-- Só quem entrou com senha lê. O anônimo não lê nada aqui — quem grava cadastro
-- é a API (POST /io/eletroposto/parceria), com a service key.
create policy consultor_le on public.eletroposto_nota1    for select to authenticated using (true);
create policy consultor_le on public.eletroposto_parceria for select to authenticated using (true);
create policy consultor_le on public.eletroposto_match    for all    to authenticated using (true) with check (true);
-- A aba Cadastros marca status e nota — precisa escrever nas duas primeiras.
create policy consultor_marca on public.eletroposto_nota1    for update to authenticated using (true) with check (true);
create policy consultor_marca on public.eletroposto_parceria for update to authenticated using (true) with check (true);

-- ── E o resto: o anônimo sai das policies que já existiam ──
-- Elas foram escritas quando `anon` era a única identidade. Hoje o consultor tem
-- a dele e a API tem a service key: ninguém mais precisa do anon.
do $$
declare p record;
begin
  for p in
    select pol.polname, cls.relname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace n on n.oid = cls.relnamespace and n.nspname = 'public'
    where 'anon' = any (select r.rolname from pg_roles r where r.oid = any(pol.polroles))
      and 'authenticated' = any (select r.rolname from pg_roles r where r.oid = any(pol.polroles))
  loop
    execute format('alter policy %I on public.%I to authenticated', p.polname, p.relname);
  end loop;
end $$;

-- E o grant, que é a camada de baixo. RLS filtra LINHA; o grant decide se o
-- papel chega na tabela. Os dois precisam fechar.
revoke select, insert, update, delete on all tables in schema public from anon;
alter default privileges in schema public revoke select, insert, update, delete on tables from anon;

-- ── Conferência (rode e leia antes de considerar pronto) ──
select c.relname as tabela, c.relrowsecurity as rls,
       coalesce(string_agg(distinct (select string_agg(r.rolname, ',') from pg_roles r
                                     where r.oid = any(pol.polroles)), ' | '), '—') as papeis
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policy pol on pol.polrelid = c.oid
where c.relkind = 'r'
group by 1, 2 order by 1;
