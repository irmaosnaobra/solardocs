-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPECÇÃO — varredura de país inteiro sem entupir a fila
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof).
-- Complemento de MIGRATION_prospeccao_apify.sql.
-- Aplicada em: 2026-08-03 (via Supabase MCP, migration "prospeccao_busca_lista_status")
--
-- Pedido que motivou: "todos os postos do Brasil". São ~42 mil CNPJs no CNAE
-- 4731-8/00. Dois problemas, um de máquina e um de gente:
--
--   MÁQUINA: uma run só de 42 mil registros não cabe no tick (Vercel corta em
--   300s) nem no teto por busca. Solução: a tela enfileira UMA BUSCA POR ESTADO
--   (27), o motor roda uma de cada vez e cada uma vira sua própria lista.
--
--   GENTE: 42 mil contatos divididos por 4 consultores é mais de 10 mil cada —
--   quase um ano de trabalho a 40 toques/dia. Despejar tudo na fila de uma vez
--   não acelera nada, só esconde o que importa. Por isso a busca passa a dizer
--   em que status a lista NASCE: 'pausada' guarda o dado sem alimentar a fila, e
--   o consultor ativa estado por estado, na ordem em que vai trabalhar.
--
-- O teto por busca também virou por FONTE (no código, não aqui): Maps 300
-- (US$1,20) e Receita 5.000 (US$4,50) — mesmo tamanho em dinheiro, porque o
-- registro da Receita custa 4,4× menos que o lugar do Maps. O teto é de GASTO.
-- ─────────────────────────────────────────────────────────────────────────────

alter table prospeccao_buscas add column if not exists lista_status text not null default 'ativa'
  check (lista_status in ('ativa','pausada'));

comment on column prospeccao_buscas.lista_status is
  'Status com que a lista nasce. Varredura grande usa "pausada" pra não despejar tudo na fila.';
