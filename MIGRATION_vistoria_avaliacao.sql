-- Se for rodar, rode MIGRATION_vistoria_compras.sql: ela inclui estas duas colunas e mais a lista de compras.
-- Vistoria solar: avaliação dos itens técnicos e assinaturas.
-- Aplicar no Supabase antes de usar os botões de status e a assinatura na tela /vistoria.
-- Só acrescenta duas colunas com padrão vazio. Vistoria antiga continua igual (sem selo).
-- status_itens: { "<chave do item técnico>": "conforme" | "atencao" | "nao_conforme" | "na" }
-- assinaturas:  { "tecnico": {path, nome, registro, ts}, "cliente": {path, nome, ts} }
ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS status_itens JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS assinaturas JSONB NOT NULL DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
