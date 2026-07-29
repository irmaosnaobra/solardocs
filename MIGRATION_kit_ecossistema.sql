-- Ecossistema do kit R$27: segmento da compra, bump não aplicado, instalação do
-- app e cadência da campanha "VIP com o curso junto".
-- APLICADO no Supabase em 29/07/2026 (migration kit_segmento_bump_e_instalacao_app).

-- ── Segmento da compra ────────────────────────────────────────────────────────
-- Carimbado na hora do webhook: quem lê depois não precisa reconstruir a regra.
-- 'lp'      = veio da landing /kit (tráfego novo)
-- 'membro'  = veio do checkout sem order bump (base própria, sem risco de comprar
--             30 dias de VIP em cima de uma assinatura que já paga)
-- 'direto'  = qualquer outra origem
alter table kit_pedidos add column if not exists segmento text;
alter table kit_pedidos add column if not exists checkout_link text;
alter table kit_pedidos add column if not exists oferta_id text;

-- ── Bump comprado por quem JÁ era assinante ───────────────────────────────────
-- concederTrialVip recusa mexer em quem é pro/ilimitado (não rebaixa plano pago),
-- então a pessoa paga R$19 e não recebe nada. false aqui = caso pra reembolso.
alter table kit_pedidos add column if not exists bump_aplicado boolean;

-- ── Origem de aquisição durável ───────────────────────────────────────────────
-- users.utm_source é sobrescrito pela campanha de mídia, e o membro antigo que
-- compra o kit não recebia carimbo nenhum.
alter table users add column if not exists origem_aquisicao text;

-- ── Instalação do PWA ─────────────────────────────────────────────────────────
alter table users add column if not exists app_instalado_em timestamptz;

-- ── Campanha "VIP com o curso junto" ──────────────────────────────────────────
-- Cadência própria: o upgrade_nudge tem cap de 3 toques já consumido pela base,
-- e zerar aquele contador contaminaria a métrica do nudge existente.
alter table users add column if not exists campanha_curso_count integer not null default 0;
alter table users add column if not exists campanha_curso_last_sent_at timestamptz;

create index if not exists idx_kit_pedidos_segmento on kit_pedidos (segmento);
create index if not exists idx_users_origem_aquisicao on users (origem_aquisicao);
