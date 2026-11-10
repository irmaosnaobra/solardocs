-- LimpaPro dentro do app: as aulas do curso moram no banco principal do SolarDoc.
--
-- SÓ A ESTRUTURA. O conteúdo das aulas é pago e este repositório é público: a carga (INSERT) fica fora do
-- repositório e é aplicada à parte, depois desta migration.
--
-- A tabela é lida SÓ pela api, com a service key, depois de conferir o acesso (rotas /limpapro/*). Por isso a RLS
-- fica ligada e não existe nenhuma política: anon e authenticated não leem nada.
--
-- Idempotente: pode rodar de novo sem efeito.

create table if not exists public.limpapro_aulas (
  slug              text primary key,
  -- modulo = os 5 módulos do curso principal; incluso = curso extra que todo comprador leva;
  -- bonus = bônus do plano Completo; extra = produto vendido à parte (só aparece para quem tem o item).
  grupo             text not null check (grupo in ('modulo', 'incluso', 'bonus', 'extra')),
  -- 1 a 5 só para grupo = 'modulo'; null nos demais.
  modulo            integer check (modulo is null or (modulo between 1 and 5)),
  -- Ordem global de leitura (a "Próxima aula" segue esta ordem).
  ordem             integer not null,
  titulo            text not null,
  resumo            text not null default '',
  minutos           integer not null default 0,
  html              text not null default '',
  -- Bônus do plano Completo. O plano de R$ 47 do app não tem bônus.
  bonus             boolean not null default false,
  -- Item de limpapro_entitlements que abre a aula. 'curso-principal' vale para quem tem acesso ao curso
  -- (mesma regra de services/produtos/limpapro.ts); 'premium' é o plano Completo; o resto é o item do extra.
  requer            text not null default 'curso-principal',
  -- Liberação atrasada (anti-reembolso), contada de limpapro_membros.criado_em. 0 = abre na hora.
  libera_apos_dias  integer not null default 0 check (libera_apos_dias >= 0),
  atualizado_em     timestamptz not null default now()
);

create index if not exists limpapro_aulas_ordem_idx on public.limpapro_aulas (ordem);

alter table public.limpapro_aulas enable row level security;
-- Sem política de propósito. A service key da api ignora a RLS; ninguém mais lê.
revoke all on public.limpapro_aulas from anon, authenticated;
