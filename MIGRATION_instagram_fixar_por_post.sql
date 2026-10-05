-- ─────────────────────────────────────────────────────────────────────────────
-- Instagram — rotear por POST, não por palavra (01/08/2026).
-- Complementa MIGRATION_instagram_roteamento.sql. Roda TUDO no projeto
-- GERADOR (ancecdfqfwlaujknizof). Nada aqui toca o MAIN.
--
-- POR QUE: "quero" era palavra-chave do Solar (prioridade 40), então quem
-- digitava só "Quero" em QUALQUER post recebia a DM de simulação solar.
-- Medido em 01/08/2026 nos ig_events:
--   • @paulacccampos e @zenaldogas comentaram "Quero" no anúncio de ELETROPOSTO
--     (18237694144312091 — a legenda pede "Digita Eletroposto") → automação
--     escolhida: 92f243ae (Solar). As duas DMs só não chegaram erradas porque
--     a Meta devolveu 500.
--   • @thiagomachado.mg comentou "Eu quero" no reel da BIKE KONNAN
--     (18110430728286770) → mesma coisa.
--
-- A CORREÇÃO: quem roteia é o post. `escolher()` no igEngine dá score 1.000.000
-- pra linha cuja `midias` casa com o media_id/ad_id — ela ganha de qualquer
-- palavra-chave global. Então a palavra pode continuar sendo "Quero" em todo
-- lugar (que é o que a pessoa digita de qualquer jeito).
--
-- ⚠ ARMADILHA: `handleMessage` chama `escolher(autos,'dm'|'story',text)` SEM
-- passar mídia (igEngine ~L220). Em `escolher`, toda linha com `midias`
-- não-vazia é descartada quando não casa. Logo linha fixada em mídia só
-- funciona no gatilho COMENTÁRIO. Por isso as linhas novas são novas mesmo,
-- com {"comment":true,"story":false,"dm":false} — as antigas (por palavra)
-- continuam intactas cuidando de DM e resposta de story.
-- ═════════════════════════════════════════════════════════════════════════════

-- ⚠ JÁ APLICADO EM 01/08/2026 (via execute_sql, projeto GERADOR). Este arquivo
--   é o registro do que foi feito. Rodar de novo é seguro: todo insert tem
--   guarda por `nome`. O update do Solar é idempotente.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1 · Linhas fixadas por anúncio/post ──────────────────────────────────────
-- prioridade 5 só pra aparecerem no topo do painel; entre si nunca empatam
-- (cada media_id está em uma linha só).
--
-- match_tipo:
--   'qualquer' nos ANÚNCIOS — clique pago é caro demais pra filtrar comentário.
--   'contem'   no reel orgânico da bike — post orgânico junta piada.

insert into ig_automations
  (nome, ativo, prioridade, fallback, produto, gatilhos, palavras_chave, match_tipo,
   post_id, midias, respostas_publicas, dm_boas_vindas, botao_rotulo, link_url,
   lembrete_texto, lembrete_horas, criado_por)
select v.* from (values
  -- Anúncio "Sua vaga parada não paga conta nenhuma" (2 criativos, 22 e 25/07)
  ('⚡ Anúncio Eletroposto — vaga parada', true, 5, false, 'eletroposto',
   '{"comment":true,"story":false,"dm":false}'::jsonb,
   array[]::text[], 'qualquer',
   null, array['18237694144312091','18018599066908998'],
   array['Te chamei no direct ⚡ (olha também em Solicitações ou na aba Geral)',
         'Manda ver no direct 👀 (se não achar, confere em Solicitações ou na aba Geral)'],
   E'⚡ Show! O Eletroposto é uma oportunidade de investimento em carregadores de carro elétrico, com retorno recorrente. Veja como funciona aqui:',
   null,
   'https://solardoc.app/io/eletroposto?src=ig&utm_source=instagram&utm_medium=dm&utm_campaign=eletroposto&utm_content=comentario',
   'Ainda dá pra conhecer a oportunidade do Eletroposto ⚡ Dá uma olhada: https://solardoc.app/io/eletroposto',
   20, 'claude'),

  -- Anúncio "Especialista Solar, está com dificuldade nas vendas?" (30/07)
  ('🔑 Anúncio Kit de Fechamento — app do especialista', true, 5, false, 'kit',
   '{"comment":true,"story":false,"dm":false}'::jsonb,
   array[]::text[], 'qualquer',
   null, array['17892818568595320'],
   array['Prontinho, te chamei no direct 👀 (se não achar, olha em Solicitações ou na aba Geral)'],
   E'🔑 Boa! O Kit de Fechamento do Integrador é o passo a passo pra parar de perder venda na hora do orçamento: roteiro de visita, resposta pronta pra cada objeção, precificação com margem e pós-venda. São R$ 27, acesso na hora e o conteúdo fica dentro da plataforma, junto com o gerador de documentos. Dá uma olhada:',
   null,
   'https://solardoc.app/kit?utm_source=instagram&utm_medium=dm&utm_campaign=kit-fechamento&utm_content=comentario',
   'Ainda dá pra pegar o Kit de Fechamento por R$ 27 🔑 https://solardoc.app/kit?utm_source=instagram&utm_medium=dm&utm_campaign=kit-fechamento&utm_content=lembrete',
   20, 'claude'),

  -- Anúncio "10 placas de 620W + inversor Saj 6K por R$12.998" (24/07)
  ('☀️ Anúncio Solar — 10 placas R$ 12.998', true, 5, false, 'solar',
   '{"comment":true,"story":false,"dm":false}'::jsonb,
   array[]::text[], 'qualquer',
   null, array['18089094848647783'],
   array['Prontinho, te chamei no direct 👀 (se não achar, olha em Solicitações ou na aba Geral)',
         'Já tá no seu direct ⚡ dá uma conferida também em Solicitações ou na aba Geral'],
   E'Boa! ⚡ Pra montar sua simulação de economia com energia solar, é só preencher aqui rapidinho (leva 30s) que um especialista já te chama:',
   null,
   'https://solardoc.app/simular?utm_source=instagram&utm_medium=dm&utm_campaign=solar&utm_content=comentario',
   'Ainda dá tempo de fazer sua simulação de economia ⚡ É rapidinho: https://solardoc.app/simular',
   20, 'claude'),

  -- Reel orgânico "BIKE KONNAN – PRONTA ENTREGA" (09/07)
  ('🚴 Reel Bike Konnan — pronta entrega', true, 5, false, 'bike',
   '{"comment":true,"story":false,"dm":false}'::jsonb,
   array['quero','eu quero','tenho interesse','interesse','quanto custa','quanto fica',
         'preco','preço','valor','orcamento','orçamento','informacoes','informações',
         'como funciona','quero saber','saber mais','me chama','disponivel','disponível',
         'bike','bicicleta','konnan'],
   'contem',
   null, array['18110430728286770'],
   array['Prontinho, te chamei no direct 👀 (se não achar, olha em Solicitações ou na aba Geral)'],
   E'🚴 Show! Te passo todos os detalhes e valores da bike por aqui. Chama a gente no WhatsApp:',
   null,
   'https://wa.me/5534998165040',
   'A bike ainda tá disponível 🚴 Quer que eu te passe os valores?',
   20, 'claude')
) as v(nome, ativo, prioridade, fallback, produto, gatilhos, palavras_chave, match_tipo,
       post_id, midias, respostas_publicas, dm_boas_vindas, botao_rotulo, link_url,
       lembrete_texto, lembrete_horas, criado_por)
where not exists (select 1 from ig_automations a where a.nome = v.nome);

-- ── 2 · Palavra genérica não pode ter dono ───────────────────────────────────
-- 'quero', 'orcamento' e 'preco' saem do Solar: enquanto forem dele, o Solar
-- continua sendo o padrão silencioso de todo post que não estiver fixado.
-- As palavras de produto ficam — "energia solar", "conta de luz" etc.
update ig_automations
   set palavras_chave = array['solar','energia solar','simulacao','simulação','economia',
                              'economizar','conta de luz','energia','placa','placas',
                              'painel','paineis','painéis']
 where nome like 'Solar —%';

-- ── 3 · Menu pra quem diz só "Quero" fora de post fixado ─────────────────────
-- Prioridade 800: perde pra qualquer automação de produto ("quero investir" vai
-- pro Eletroposto, "quero o fechamento" vai pro Kit). Só pega o "Quero" pelado.
-- Diferente da rede de segurança (900, fallback), este vale também em post
-- ORGÂNICO e em DM/story — onde o fallback não chega.
-- A resposta do menu ("SOLAR"/"ELETROPOSTO"/"BIKE") cai no gatilho de DM das
-- automações de produto e roteia sozinha.
insert into ig_automations
  (nome, ativo, prioridade, fallback, produto, gatilhos, palavras_chave, match_tipo,
   post_id, midias, respostas_publicas, dm_boas_vindas, botao_rotulo, link_url,
   lembrete_texto, lembrete_horas, criado_por)
select '🤔 Menu — interesse sem produto', true, 800, false, 'solar',
       '{"comment":true,"story":true,"dm":true}'::jsonb,
       array['quero','eu quero','tenho interesse','quanto custa','quanto fica',
             'orcamento','orçamento','preco','preço','valor',
             'informacoes','informações','mais informacoes','mais informações',
             'como funciona','quero saber','saber mais','me chama'],
       'contem',
       null, array[]::text[],
       array['Te chamei no direct 👀 (se não achar, olha em Solicitações ou na aba Geral)'],
       E'Oi! 👋 Vi seu comentário e vim te responder por aqui.\n\nPra eu te mandar a informação certa, é só responder com UMA palavra:\n\n⚡ SOLAR — economizar até 90% na conta de luz\n🔌 ELETROPOSTO — investir em carregador de carro elétrico\n🚴 BIKE — bicicleta elétrica\n\nOu me manda seu WhatsApp que um especialista te chama 😉',
       null, null, null, 24, 'claude'
where not exists (select 1 from ig_automations where nome like '%Menu — interesse sem produto%');

-- ── Como reverter ────────────────────────────────────────────────────────────
-- delete from ig_automations where criado_por = 'claude' and prioridade in (5, 800);
-- update ig_automations
--    set palavras_chave = array['solar','energia solar','simulacao','simulação','economia',
--                               'economizar','conta de luz','energia','placa','placas','painel',
--                               'paineis','painéis','quero','orcamento','orçamento','preco','preço']
--  where nome like 'Solar —%';
