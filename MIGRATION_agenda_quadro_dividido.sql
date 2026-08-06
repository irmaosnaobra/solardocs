-- ============================================================================
-- Agenda: solar e eletroposto podem DIVIDIR o mesmo quadro
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador de Propostas / Irmãos na Obra)
--
-- Ordem do Thiago (06/08/2026): "quando solar cair no mesmo horário não tem
-- problema dividir quadro". Reunião de solar é ligação curta; a de eletroposto é
-- vídeo com estudo. O consultor dá conta das duas no mesmo horário — e a agenda
-- dele não podia mais recusar a segunda.
--
-- O que existia:
--   CREATE UNIQUE INDEX agendamentos_vendedor_quando_uniq
--     ON agendamentos (vendedor_nome, quando) WHERE status <> 'cancelado';
--   → UM compromisso por consultor por horário, ponto. Era ele que estourava
--     ("Este slot já está ocupado") quando a prospecção tentava marcar por cima
--     de uma reunião de solar.
--
-- O que passa a valer: DOIS índices únicos PARCIAIS sobre predicados
-- complementares. O resultado é capacidade 2 por (consultor, horário) — no
-- máximo UMA de solar e UMA de qualquer outra coisa. Nunca três; nunca duas do
-- mesmo tipo. É exatamente "dividir o quadro em dois".
--
-- POR QUE a lista de origens é fixa aqui (e não derivada): índice parcial exige
-- predicado IMMUTABLE. A consequência está escolhida de propósito e é o lado
-- SEGURO: uma origem de solar nova, que ninguém acrescentar nesta lista, cai no
-- índice de "não-solar" e volta a se comportar como antes (não divide o quadro,
-- recusa a segunda reunião). Perde-se a divisão, nunca a proteção.
-- Mexeu na lista de solar do backend (SOLAR_ORIGENS em
-- api/src/services/io/solarBoasVindas.ts)? Reavaliar esta aqui.
--
-- `status <> 'cancelado'` continua nos dois: horário cancelado libera o quadro,
-- igual a antes. `quando` nulo (contato sem data) segue fora — NULL é distinto
-- de NULL em índice único, então contato solto nunca disputou horário nenhum.
--
-- Tudo numa transação só: em nenhum instante a tabela fica sem trava.
--
-- Pra voltar atrás:
--   begin;
--   create unique index agendamentos_vendedor_quando_uniq
--     on public.agendamentos (vendedor_nome, quando) where status <> 'cancelado';
--   drop index agendamentos_vq_solar_uniq;
--   drop index agendamentos_vq_naosolar_uniq;
--   commit;
--   -- (só volta se nenhum quadro estiver dividido; senão desfaça os pares antes)
-- ============================================================================

begin;

-- Uma reunião de SOLAR por consultor por horário.
create unique index if not exists agendamentos_vq_solar_uniq
  on public.agendamentos (vendedor_nome, quando)
  where status <> 'cancelado'
    and created_by in ('lead-meta', 'leads-meta', 'lp_solar', 'manychat', 'prosp_solar');

-- Uma reunião de QUALQUER OUTRA COISA (eletroposto, import, manual, indicação,
-- origem nova) por consultor por horário.
create unique index if not exists agendamentos_vq_naosolar_uniq
  on public.agendamentos (vendedor_nome, quando)
  where status <> 'cancelado'
    and (created_by is null
         or created_by not in ('lead-meta', 'leads-meta', 'lp_solar', 'manychat', 'prosp_solar'));

-- Só agora cai a trava antiga: os dois índices acima já estão de pé.
drop index if exists public.agendamentos_vendedor_quando_uniq;

commit;
