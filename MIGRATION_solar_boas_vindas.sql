-- ─────────────────────────────────────────────────────────────────────────────
-- BOAS-VINDAS DO SOLAR — coluna própria do primeiro toque.
--
-- Banco: GERADOR (o mesmo de `agendamentos`).
--
-- Por que uma coluna nova em vez de reaproveitar `confirmacao_at`:
--   1. Semântica. Este toque NÃO confirma nada — ele não fala de horário, de
--      reunião nem de vistoria. Gravar "confirmação" pra uma mensagem que nunca
--      confirmou horário nenhum faz a ficha mentir pro consultor que a lê.
--   2. Atribuição. `confirmacao_at` já é lida pelo agente de agendamento do
--      eletroposto e pela Central das Agentes. As três colunas de flag já foram
--      compartilhadas entre produtos uma vez, e o resultado foi toque creditado
--      ao agente errado (ver eletropostoAgenda.ts, EP_AGENDA_INICIO). Coluna
--      separada elimina a necessidade de raciocinar sobre isso de novo.
--   3. O lembretesAgenda.ts (solar, desligado desde 28/07) decide em cima de
--      `!confirmacao_at`. Enquanto ele está off é inofensivo — mas "inofensivo
--      porque um kill-switch está false" é exatamente o formato do incidente de
--      28/07. A coluna nova torna os dois módulos independentes de verdade.
--
-- Aditivo e reversível: coluna nula, nenhuma linha existente muda.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS boas_vindas_at timestamptz;

COMMENT ON COLUMN agendamentos.boas_vindas_at IS
  'Quando o agente de boas-vindas do solar (solarBoasVindas.ts) falou com o cliente. NULL = nunca falou. Não tem relação com horário de reunião.';

-- O tick lê "fichas de solar, recentes, ainda sem toque" a cada 5 min.
CREATE INDEX IF NOT EXISTS idx_agendamentos_solar_boas_vindas
  ON agendamentos (created_by, created_at)
  WHERE boas_vindas_at IS NULL;

-- Rollback:
--   DROP INDEX IF EXISTS idx_agendamentos_solar_boas_vindas;
--   ALTER TABLE agendamentos DROP COLUMN IF EXISTS boas_vindas_at;
