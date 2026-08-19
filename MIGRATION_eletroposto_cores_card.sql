-- ============================================================================
-- Régua de cores do card do eletroposto — AMARELO e VERMELHO
-- Projeto Supabase: ancecdfqfwlaujknizof (Gerador de Propostas / Irmãos na Obra)
-- APLICADA EM 19/08/2026 (migration `eletroposto_amarelo_vermelho_libera_horario`).
--
-- ⚠️ Este arquivo é ESPELHO. Arquivo commitado aqui NÃO prova que a regra está no
-- ar — já custou 50 fichas uma vez. Conferir com:
--     select column_name from information_schema.columns
--      where table_name='agendamentos' and column_name='lead_resposta_at';
--     select indexdef from pg_indexes where indexname='agendamentos_vq_naosolar_uniq';
--
-- Ordem do Thiago (19/08/2026):
--   AMARELO  = a automação falou e o lead não respondeu NADA.
--   VERMELHO = nem depois do 2º contato (bom dia das 8h) ele apareceu até as 13h
--              → status `nao_atendeu` e o HORÁRIO DELE VOLTA PRA AGENDA.
--
-- Duas coisas mudam no banco:
--
-- 1. `lead_resposta_at` — quando esta pessoa escreveu pela última vez. O sinal já
--    existia, mas só no system_state do OUTRO projeto (`ep_resposta:<id>`,
--    solardoc-pro), e a agenda do /gerador lê ESTE banco: sem a coluna, o card não
--    tem como saber se o silêncio continua. Ela é o que separa o amarelo do azul,
--    e é o que impede o vermelho de cair em cima de quem conversou.
--
-- 2. A trava de "um compromisso por consultor por horário" passa a ignorar o
--    `nao_atendeu`. Sem isto, liberar o horário na vitrine da LP seria mentira: a
--    página mostraria o slot livre e o INSERT bateria no índice único ("Este slot
--    já está ocupado") quando os dois consultores estivessem tomados e um deles
--    fosse um vermelho. É o "dividindo o espaço com o próximo se vier" — o
--    vermelho continua desenhado na agenda interna, mas deixa de reservar o
--    quadro.
--
-- O índice do SOLAR fica como está: quem não atende ligação de vistoria é outro
-- assunto e não passou por régua nenhuma de cor.
--
-- Efeito colateral MAPEADO (tratado no código): a ficha vermelha que volta pra
-- `agendado` (a pessoa apareceu falando) pode encontrar o horário já revendido —
-- o UPDATE devolve 23505 e o `eletropostoRespostas` responde oferecendo horários
-- novos em vez de brigar pelo slot.
-- ============================================================================

alter table public.agendamentos
  add column if not exists lead_resposta_at timestamptz;

comment on column public.agendamentos.lead_resposta_at is
  'Última vez que o LEAD escreveu na linha (gravado pelo eletropostoRespostas). Nulo = silêncio desde o primeiro toque — é o que pinta o card de amarelo na agenda.';

grant select (lead_resposta_at), insert (lead_resposta_at), update (lead_resposta_at)
  on public.agendamentos to anon, authenticated;

create index if not exists idx_agendamentos_sem_resposta
  on public.agendamentos (quando)
  where lead_resposta_at is null and status = 'agendado';

-- ── A trava do quadro passa a ignorar o vermelho ────────────────────────────
-- O índice novo é MAIS PERMISSIVO que o antigo, então criar não pode falhar por
-- duplicata: tudo que passava continua passando.
--
-- Pra voltar atrás:
--   drop index public.agendamentos_vq_naosolar_uniq;
--   create unique index agendamentos_vq_naosolar_uniq
--     on public.agendamentos (vendedor_nome, quando)
--     where status <> 'cancelado'
--       and (created_by is null or created_by not in
--            ('lead-meta','leads-meta','lp_solar','manychat','prosp_solar'));
drop index if exists public.agendamentos_vq_naosolar_uniq;

create unique index agendamentos_vq_naosolar_uniq
  on public.agendamentos (vendedor_nome, quando)
  where status not in ('cancelado', 'nao_atendeu')
    and (created_by is null
         or created_by not in ('lead-meta', 'leads-meta', 'lp_solar', 'manychat', 'prosp_solar'));
