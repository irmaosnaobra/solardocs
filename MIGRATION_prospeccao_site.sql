-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPECÇÃO — quarto produto: Site do integrador
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof).
-- Complemento de MIGRATION_prospeccao.sql.
-- Aplicada em: 2026-08-02 (via Supabase MCP, migration "prospeccao_produto_site")
--
-- PREÇO: R$ 1.890 — número do próprio desenho da tela, dado pelo Thiago. Não há
-- checkout nem página de venda no repo pra conferir contra (diferente dos outros
-- três, que foram batidos com o código). Se o preço mudar, muda em
-- Listas → Produtos e scripts; o valor que entra no faturamento continua sendo o
-- digitado na hora de registrar a venda.
--
-- ORDEM 4: é o último degrau da escada — maior ticket, e o que mais depende de
-- confiança já construída. Quem nunca comprou nada continua entrando pelo
-- primeiro degrau.
--
-- Os scripts PERGUNTAM se a empresa tem site em vez de afirmar que não tem: a
-- base importada de planilha não traz coluna de site, então "sem site" na tela
-- quer dizer "não cadastrado aqui", não "não existe". Afirmar isso pro cliente
-- que tem site queima o contato no primeiro minuto.
-- ─────────────────────────────────────────────────────────────────────────────

insert into prospeccao_produtos (id, nome, sigla, cor, preco, sub, ordem, ativo) values
  ('site', 'Site do integrador', 'ST', '#EA580C', 1890.00, 'projeto · entrega em 7 dias', 4, true)
on conflict (id) do update
  set nome = excluded.nome, sigla = excluded.sigla, cor = excluded.cor,
      preco = excluded.preco, sub = excluded.sub, ordem = excluded.ordem, ativo = true;

delete from prospeccao_scripts where produto_id = 'site';

insert into prospeccao_scripts (produto_id, ordem, texto) values
 ('site', 1, E'Oi! {consultor} aqui, da Irmãos na Obra.\n\nPergunta rápida sobre a {empresa}: vocês têm site hoje, ou o contato chega só pelo Google e pelo Instagram?\n\nPergunto porque cliente de solar pesquisa a empresa antes de chamar — e quando não acha nada, vai no concorrente que tem. Fazemos o site com página de captação já ligada no seu WhatsApp.\n\n{preco}, no ar em 7 dias. Quer ver dois que fizemos pra integrador?'),
 ('site', 2, E'Oi! {consultor}, da Irmãos na Obra.\n\nA {empresa} tem avaliação boa no Google — e é justamente aí que dói: a pessoa vê a nota, procura o site pra confirmar que a empresa é séria, e se não acha, esfria.\n\nSite com página de captação ligada no WhatsApp, {preco}, pronto em 7 dias.\n\nTe mando dois exemplos?'),
 ('site', 3, E'Bom dia! {consultor} aqui, da Irmãos na Obra.\n\nQuantos orçamentos a {empresa} perde por mês pra empresa pior, só porque a outra aparece melhor na internet?\n\nMontamos o site completo com página de captação em 7 dias, {preco}. Tenho portfólio de integrador na mão.\n\nQuer ver?');
