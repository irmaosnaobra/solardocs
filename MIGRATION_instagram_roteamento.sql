-- ─────────────────────────────────────────────────────────────────────────────
-- Instagram — roteamento de comentário (30/07/2026). Complementa
-- MIGRATION_instagram_automacao.sql.
--
-- POR QUE: com campanha rodando, comentário de anúncio estava se perdendo.
--   • colisão de palavra-chave sem desempate ("quero o fechamento" caía no Solar
--     porque bateu "quero"; "quanto custa?" num anúncio de solar caía na Bike,
--     que tinha "quanto"/"valor" como palavra-chave);
--   • comentário com interesse real e SEM palavra-chave ("Tenho interesse",
--     "Pagando à vista tem desconto?") não recebia nada;
--   • "enviado" na fila era só HTTP 200 — não guardava o message_id da Meta,
--     então não dava pra provar entrega quando alguém reclamava que não recebeu.
--
-- SÃO DOIS PROJETOS SUPABASE — rode cada bloco no lugar certo.
-- ═════════════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCO A — projeto MAIN (SUPABASE_URL / SUPABASE_SERVICE_KEY)              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Prova de entrega: message_id só existe quando a Meta CRIOU a mensagem.
alter table ig_queue add column if not exists message_id text;
alter table ig_queue add column if not exists resposta   jsonb;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCO B — projeto GERADOR (ancecdfqfwlaujknizof)                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- prioridade: menor ganha no empate de palavra-chave.
-- midias:     fixa a automação em posts/anúncios (aceita media_id ou ad_id).
-- fallback:   rede de segurança — só entra quando NENHUMA outra casou.
-- produto:    'solar' | 'eletroposto' → card no CRM quando vem telefone.
--             (qualquer outro valor não deposita: bike e kit não são consultoria)
alter table ig_automations add column if not exists prioridade int not null default 100;
alter table ig_automations add column if not exists midias     text[] not null default '{}';
alter table ig_automations add column if not exists fallback   boolean not null default false;
alter table ig_automations add column if not exists produto    text;

update ig_automations set prioridade = 10 where nome like 'Kit de Fechamento%';
update ig_automations set prioridade = 20 where nome like 'Indicação%';
update ig_automations set prioridade = 30 where nome like 'Eletroposto%';
update ig_automations set prioridade = 40 where nome like 'Solar%';
update ig_automations set prioridade = 50 where nome like 'Bike%';
update ig_automations set prioridade = 60 where nome like 'Boas-vindas%';

-- Bike não pode mais roubar quem pergunta preço em anúncio de solar.
update ig_automations
   set palavras_chave = array['bike','bicicleta','konnan','bike eletrica','bicicleta eletrica','magrinha'],
       produto = 'bike'
 where nome like 'Bike%';

update ig_automations
   set palavras_chave = array['indicar','indicacao','indicação','indico','indiquei','quero indicar','renda extra'],
       produto = 'solar'
 where nome like 'Indicação%';

update ig_automations
   set palavras_chave = array['solar','energia solar','simulacao','simulação','economia','economizar','conta de luz','energia','placa','placas','painel','paineis','painéis','quero','orcamento','orçamento','preco','preço'],
       produto = 'solar',
       respostas_publicas = array['Prontinho, te chamei no direct 👀 (se não achar, olha em Solicitações)','Já tá no seu direct ⚡ dá uma conferida também em Solicitações'],
       link_url = 'https://solardoc.app/simular?utm_source=instagram&utm_medium=dm&utm_campaign=solar&utm_content=comentario'
 where nome like 'Solar%';

-- ?src=ig era parâmetro inventado: a LP descarta e a venda cai como "não
-- trackeada" na UTMify. utm_* de verdade.
update ig_automations
   set palavras_chave = array['eletroposto','carregador','recarga','carro eletrico','carro elétrico','ponto de recarga','investir','investimento','aporte','retorno','posto'],
       produto = 'eletroposto',
       respostas_publicas = array['Te chamei no direct ⚡ (olha também em Solicitações)','Manda ver no direct 👀 (se não achar, confere em Solicitações)'],
       link_url = 'https://solardoc.app/io/eletroposto?utm_source=instagram&utm_medium=dm&utm_campaign=eletroposto&utm_content=comentario'
 where nome like 'Eletroposto%';

update ig_automations set produto = 'kit'   where nome like 'Kit de Fechamento%';
update ig_automations set produto = 'solar' where nome like 'Boas-vindas%';

update ig_automations
   set respostas_publicas = array['Prontinho, te chamei no direct 👀 (se não achar, olha em Solicitações)']
 where nome like 'Kit de Fechamento%' or nome like 'Bike%' or nome like 'Indicação%' or nome like 'Boas-vindas%';

-- Rede de segurança. A DM é um menu: a resposta ("SOLAR"/"ELETROPOSTO"/"BIKE")
-- cai no gatilho de DM das outras automações e roteia sozinha.
insert into ig_automations (nome, ativo, prioridade, fallback, produto, gatilhos, palavras_chave, match_tipo, respostas_publicas, dm_boas_vindas, link_url, lembrete_texto, lembrete_horas, criado_por)
select 'Interesse geral (rede de segurança)', true, 900, true, 'solar',
       '{"comment":true,"story":false,"dm":false}'::jsonb,
       array[]::text[], 'qualquer',
       array['Te chamei no direct 👀 (se não achar, olha em Solicitações)'],
       E'Oi! 👋 Vi seu comentário e vim te responder por aqui.\n\nPra eu te mandar a informação certa, é só responder com UMA palavra:\n\n⚡ SOLAR — economizar até 90% na conta de luz\n🔌 ELETROPOSTO — investir em carregador de carro elétrico\n🚴 BIKE — bicicleta elétrica\n\nOu me manda seu WhatsApp que um especialista te chama 😉',
       null, null, 24, 'claude'
where not exists (select 1 from ig_automations where fallback = true);

-- ORDEM IMPORTA: o código ANTIGO não conhece a coluna `fallback` e leria
-- match_tipo='qualquer' como "responde todo comentário". Deixe desligada e ligue
-- SÓ depois que o igEngine novo estiver em produção.
update ig_automations set ativo = false where fallback = true;
-- pós-deploy:
-- update ig_automations set ativo = true where fallback = true;
