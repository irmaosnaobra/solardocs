-- ════════════════════════════════════════════════════════════
-- Índice de webhook_debug por created_at (projeto solardoc-pro, 14/09/2026)
--
-- Por quê: webhook_debug só tinha a PK. Cinco robôs do /cron/process-messages
-- leem "created_at >= agora - 6 min ORDER BY created_at LIMIT 200/300" a cada
-- rodada, e sem índice cada leitura varria a tabela inteira (173 mil linhas,
-- 90 MB) para devolver umas 15 linhas: 4,6 s em média, 79,7% de todo o tempo de
-- execução do banco. Cada leitura segurava uma conexão do PostgREST, a fila
-- estourava os 5 s do gateway e qualquer rota tomava 504, inclusive o login e o
-- /auth/me.
--
-- COMO RODAR:
-- - Sozinho, via execute_sql do MCP ou SQL Editor. NUNCA em apply_migration
--   (embrulha em transação e o CONCURRENTLY falha com 25001).
-- - Nada de "SET ...;" na mesma chamada: vira transação implícita.
-- - NUNCA trocar por CREATE INDEX comum: ele bloqueia INSERT durante a
--   construção, e o Worker do webhook não olha o status da resposta. Webhook
--   perdido não gera alerta nenhum.
--
-- Este arquivo não prova que rodou. A prova é a sonda do fim.
-- ════════════════════════════════════════════════════════════

CREATE INDEX CONCURRENTLY IF NOT EXISTS webhook_debug_created_at_idx
  ON public.webhook_debug USING btree (created_at);

-- Sonda: tem que aparecer com indisvalid = true. Se aparecer false, o índice
-- ficou inválido (construção cancelada) e o IF NOT EXISTS vai pular calado.
-- select indexrelid::regclass, indisvalid, indisready
--   from pg_index where indrelid = 'public.webhook_debug'::regclass;
