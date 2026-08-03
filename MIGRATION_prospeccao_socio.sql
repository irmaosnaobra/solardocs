-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPECÇÃO — o nome do dono entra na ficha
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof).
-- Complemento de MIGRATION_prospeccao_dados.sql.
-- Aplicada em: 2026-08-03 (via Supabase MCP, migration "prospeccao_socio_cnpj")
--
-- A busca por CNAE na Receita Federal devolve o QSA (quadro de sócios) — é o que
-- transforma "posso falar com o responsável?" em "o Sr. Jorge está?". Vira coluna
-- porque é usado no script ({socio}) e precisa ser filtrável; o QSA inteiro
-- continua em `dados`.
--
-- cnpj vira coluna pelo mesmo motivo do place_id: é identidade forte pra cruzar a
-- mesma empresa entre fontes (Receita ↔ Maps) sem depender do telefone.
-- ─────────────────────────────────────────────────────────────────────────────

alter table prospeccao_contatos add column if not exists socio text;   -- sócio-administrador (QSA)
alter table prospeccao_contatos add column if not exists cnpj  text;   -- só dígitos

create index if not exists prospeccao_contatos_cnpj_idx on prospeccao_contatos (cnpj);

comment on column prospeccao_contatos.socio is
  'Nome do sócio-administrador vindo do QSA da Receita. Usado no script como {socio}.';
