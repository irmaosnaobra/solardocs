-- SEM USO desde 19/11/2026: substituida por MIGRATION_nexus_instagram_interesse.sql (banco principal).
-- Banco: Gerador (projeto gerador-propostas). NAO rodar no banco do SolarDoc.
-- Cadastro de intencao da NEXUS (link da bio do Instagram): o que a pessoa quer
-- importar da China e o contato. Idempotente. A api grava com service role.
create table if not exists public.nexus_interesse (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  nome          text not null,
  telefone      text not null unique,   -- so digitos, com DDI 55 (normalizado na API)
  cidade        text,
  itens         text[] not null default '{}',
  outro         text,
  uso           text check (uso in ('proprio','empresa','revenda')),
  origem        text,
  utm           jsonb,
  teste         boolean not null default false
);

-- Sem policy de proposito: so a service role da api le e escreve.
alter table public.nexus_interesse enable row level security;
