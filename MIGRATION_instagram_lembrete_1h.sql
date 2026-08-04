-- ─────────────────────────────────────────────────────────────────────────────
-- Instagram — LEMBRETE DE 1 HORA (04/08/2026). Complementa
-- MIGRATION_instagram_porteiro.sql.
--
-- POR QUE: pedido do dono — "depois de uma hora que foi enviar o DM, envia uma
-- outra msg lembrando". O relógio começa no ENVIO CONFIRMADO da primeira DM
-- (a fila só agenda o lembrete depois que a Meta devolve message_id), não no
-- comentário.
--
-- LIMITE DA META (não é escolha nossa): DM só sai com a janela de 24h aberta, e
-- quem abre a janela é a RESPOSTA da pessoa. Resposta privada a comentário fura a
-- janela, mas é UMA por comentário — já gastamos na primeira DM. Então:
--   • respondeu e parou no "me segue" → recebe o nudge do porteiro;
--   • respondeu e já pegou o link     → recebe "conseguiu abrir o link?";
--   • NUNCA respondeu                 → não recebe nada (fila marca
--     'janela_24h_fechada' e pula). Não há como mandar, por regra da Meta.
--
-- Fila: tipo próprio `followup_1h`, separado do `followup` (o lembrete longo de
-- 20/24h da automação). É esse tipo que dá o dedup — quem comenta três vezes no
-- mesmo anúncio recebe UM lembrete, não três.
--
-- Kill-switch geral: IG_LEMBRETE_1H_OFF='true' no ambiente da API.
-- ═════════════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ Rodar no projeto GERADOR (ancecdfqfwlaujknizof). Nada aqui toca o MAIN.    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Nulo = usa a copy padrão do motor (igGate.ts): com link vira "conseguiu abrir
-- o link?" + o link; sem link vira "viu o que eu te mandei?".
alter table ig_automations add column if not exists lembrete_1h_texto text;
alter table ig_automations add column if not exists lembrete_1h_off   boolean not null default false;

-- ── Como reverter ────────────────────────────────────────────────────────────
-- IG_LEMBRETE_1H_OFF='true' no ambiente, ou:
-- update ig_automations set lembrete_1h_off = true;
