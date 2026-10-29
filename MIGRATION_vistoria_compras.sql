-- Vistoria solar: status dos itens, assinaturas e lista de compras. ARQUIVO UNICO e idempotente.
-- Rode no Supabase (SQL Editor) uma vez. Pode rodar de novo sem efeito, antes ou depois de MIGRATION_vistoria_avaliacao.sql.
-- So acrescenta colunas com padrao vazio. Vistoria antiga continua igual (sem selo, sem lista).
-- status_itens: { "<chave do item tecnico>": "conforme" | "atencao" | "nao_conforme" | "na" }
-- assinaturas:  { "tecnico": {path, nome, registro, ts}, "cliente": {path, nome, ts} }
-- compras:      { "v": 1, "publica": true, "linhas": [ {id, tipo, nome, esp, qtd, un, quem, item, cid, obs, ts} ] }
-- localizacao:  ja existe em producao (aplicada a mao). O IF NOT EXISTS fecha a deriva do schema.sql e nao muda nada la.
ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS localizacao JSONB;
ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS status_itens JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS assinaturas JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS compras JSONB NOT NULL DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
