-- Endereço do cliente em partes (rua, número, complemento e bairro).
-- Serve para o cadastro e a leitura da conta de luz guardarem cada parte separada.
-- A coluna `endereco` continua existindo e guarda a linha completa que o PDF e os
-- contratos usam. Clientes antigos ficam com as partes vazias. Só adiciona colunas.
alter table public.clients
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text;
