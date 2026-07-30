-- ════════════════════════════════════════════════════════════
-- Curso Kit de Fechamento deixa de ser entrega do plano (30/07/2026)
--
-- Assinatura NÃO libera mais o curso: quem quiser, compra. Mas quem JÁ tinha o
-- curso aberto pelo plano não pode perder — pagou enquanto a regra era outra,
-- e parte dessa gente assinou justamente pela campanha "o curso entra junto".
--
-- Esta coluna é o grandfather. Derivar de kit_progresso NÃO serve: aquela tabela
-- só ganha linha quando a pessoa CONCLUI uma lição, então quem abriu e leu sem
-- marcar nada ficaria de fora.
--
-- ORDEM: rode este arquivo ANTES do deploy. Se o código subir primeiro, a API
-- detecta que a coluna não existe e mantém o comportamento antigo (assinante
-- abre o curso) — ninguém perde acesso no meio do caminho.
-- ════════════════════════════════════════════════════════════

-- 1. A flag. Default false: conta nova não ganha curso.
ALTER TABLE users ADD COLUMN IF NOT EXISTS curso_vitalicio BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill A — quem tem acesso HOJE pelo plano E já pagou por ele.
--    É a foto do momento da virada. Quem está nos 7 dias grátis do Stripe fica de
--    FORA: ainda não pagou nada, e cancelar no dia 6 levando curso vitalício é
--    exatamente o buraco que não queremos abrir. 'past_due' e 'suspended' entram —
--    essa gente pagou, só falhou uma cobrança depois.
UPDATE users
   SET curso_vitalicio = true
 WHERE plano IN ('pro', 'ilimitado')
   AND coalesce(billing_status, '') <> 'trialing'
   AND curso_vitalicio = false;

-- 3. Backfill B — quem já estava estudando, mesmo que hoje esteja no free.
--    Pega o ex-assinante que concluiu lição e depois caiu pro freemium. Mesma
--    régua do trial: estudar durante os 7 dias grátis não compra o curso.
UPDATE users u
   SET curso_vitalicio = true
  FROM (SELECT DISTINCT user_id FROM kit_progresso) p
 WHERE u.id = p.user_id
   AND coalesce(u.billing_status, '') <> 'trialing'
   AND u.curso_vitalicio = false;

-- 4. Conferência — rode depois e guarde o número.
--    liberados_por_flag = quantos foram grandfathered nesta migration.
SELECT
  count(*) FILTER (WHERE curso_vitalicio)                              AS liberados_por_flag,
  count(*) FILTER (WHERE plano IN ('pro','ilimitado'))                 AS assinantes_hoje,
  count(*) FILTER (WHERE billing_status = 'trialing')                  AS em_teste_ficaram_de_fora,
  count(*) FILTER (WHERE coalesce(campanha_curso_count, 0) > 0)        AS receberam_campanha_antiga
FROM users;
