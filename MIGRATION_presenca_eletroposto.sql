-- ─────────────────────────────────────────────────────────────────────────────
-- PRESENÇA CONFIRMADA PELO LEAD — agenda do eletroposto
-- Aplicada em 04/08/2026 no Supabase `gerador-propostas` (ancecdfqfwlaujknizof).
--
-- Por que existe: a Central das Agentes mostrava "Responderam", que conta quem
-- escreveu QUALQUER coisa. "Quanto vou gastar?" é resposta e não é presença —
-- e número que promete uma coisa e mede outra vira decisão errada. O Thiago
-- pediu (04/08): "confirmaram quando confirmar mesmo".
--
-- Quem grava: api/src/services/io/eletropostoRespostas.ts, e só quando a
-- mensagem é confirmação de verdade (afirmativa curta e inteira, ou verbo
-- explícito de confirmar). Pedido de remarcar/cancelar LIMPA o campo — quem
-- confirmou e depois disse "não vou conseguir" não pode seguir contando como
-- presente.
-- ─────────────────────────────────────────────────────────────────────────────

alter table agendamentos add column if not exists presenca_confirmada_at timestamptz;

comment on column agendamentos.presenca_confirmada_at is
  'Quando o lead confirmou presenca por mensagem (agente de agendamento do eletroposto). Null = nao confirmou ou desmarcou.';

create index if not exists idx_agendamentos_presenca
  on agendamentos (presenca_confirmada_at) where presenca_confirmada_at is not null;
