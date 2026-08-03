-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPECÇÃO — a ficha do Google para de ser jogada fora
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof).
-- Complemento de MIGRATION_prospeccao.sql e MIGRATION_prospeccao_apify.sql.
-- Aplicada em: 2026-08-02 (via Supabase MCP, migration "prospeccao_dados_google")
--
-- Até aqui o import guardava 7 campos e descartava o resto do que a Apify devolve —
-- inclusive endereço e coordenada, que vêm de graça no mesmo preço por lugar.
-- Agora:
--   · as colunas abaixo guardam o que dá pra FILTRAR e MOSTRAR na tela;
--   · `dados` guarda o item cru inteiro, pra nada mais se perder — se amanhã
--     alguém quiser horário de pico ou as tags das avaliações, o dado já está aqui,
--     sem precisar rodar (e pagar) a busca de novo.
--
-- `dados` é jsonb e não tem esquema fixo de propósito: cada actor da Apify devolve
-- um formato, e o dia que a lista vier do Instagram em vez do Maps, cabe do mesmo jeito.
-- ─────────────────────────────────────────────────────────────────────────────

alter table prospeccao_contatos add column if not exists endereco  text;
alter table prospeccao_contatos add column if not exists bairro    text;
alter table prospeccao_contatos add column if not exists cep       text;
alter table prospeccao_contatos add column if not exists categoria text;   -- "Fornecedor de energia solar"
alter table prospeccao_contatos add column if not exists email     text;   -- só com o add-on de contatos
alter table prospeccao_contatos add column if not exists lat       numeric(10,7);
alter table prospeccao_contatos add column if not exists lng       numeric(10,7);
alter table prospeccao_contatos add column if not exists maps_url  text;   -- link do perfil no Google Maps
alter table prospeccao_contatos add column if not exists place_id  text;   -- id do lugar no Google
alter table prospeccao_contatos add column if not exists dados     jsonb;  -- item cru do actor

create index if not exists prospeccao_contatos_categoria_idx on prospeccao_contatos (categoria);
create index if not exists prospeccao_contatos_place_idx     on prospeccao_contatos (place_id);

comment on column prospeccao_contatos.dados is
  'Item cru devolvido pelo actor da Apify. Fonte de verdade pra qualquer campo que ainda não virou coluna.';
