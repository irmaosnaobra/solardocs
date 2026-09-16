-- Eletroposto no Instagram: o convite da comunidade no lembrete de 1h.
-- (15/09/2026)  Projeto: gerador-propostas (ancecdfqfwlaujknizof)
--
-- NAO EXECUTADO AINDA: falta o link do convite da comunidade.
--
-- SAO DUAS PARTES INDEPENDENTES. Rode a PARTE 1 sozinha se quiser so o convite;
-- a PARTE 2 mexe no PRIMEIRO toque e tem risco proprio, explicado la embaixo.
--
-- O QUE JA EXISTE HOJE, pra ninguem achar que isto liga algo do zero:
--   . quem comenta em post de eletroposto ja recebe DM automatica com o link
--     do /io/eletroposto, e uma resposta publica "te chamei no direct";
--   . uma hora depois ja sai um lembrete -- que ate agora repetia o MESMO link
--     ("conseguiu abrir o link?"). E esse texto que vira o convite.
--
-- LIMITE QUE NAO E NOSSO, e que decide o alcance:
--   o lembrete de 1h so sai com a janela de 24h da Meta ABERTA, e quem abre a
--   janela e a RESPOSTA da pessoa. Medido nos ultimos 60 dias: 52 de 109 que
--   comentaram em eletroposto responderam (48%). Quem so clicou no botao e
--   sumiu nao recebe o convite -- a fila marca 'janela_24h_fechada' e pula.
--   Pra alcancar a base ANTIGA (quem ja comentou e ja fechou a janela) o
--   caminho e outro: disparo por WhatsApp, io_broadcasts em api/src/routes/admin.ts.


-- ── PARTE 1 ── o convite da comunidade no lembrete de 1h ─────────────────────
-- Aditivo de verdade: nao encosta no primeiro toque. Atinge as DUAS automacoes
-- de eletroposto (o anuncio pago fixado nas midias e a organica por palavra-chave).
--
-- Copy dimensionada pro card do Instagram: 1a linha = titulo (teto 80), 2a linha
-- = subtitulo (teto 80), rotulo do botao teto 20. 'Entrar na comunidade' tem 20
-- exatos. Texto acima de 160 caracteres deixaria de ser card e viraria texto
-- puro com o link no fim -- por isso as duas linhas sao curtas.

update ig_automations set
  lembrete_1h_texto = 'Enquanto voce decide, entra na comunidade do Eletroposto.'
                   || chr(10) || 'La tem vaga nova, retorno real e bastidor de quem ja instalou.',
  lembrete_1h_link  = 'COLE_O_LINK_AQUI',      -- chat.whatsapp.com/...
  lembrete_1h_botao = 'Entrar na comunidade'
where produto = 'eletroposto' and ativo = true;
-- Esperado: UPDATE 2

-- SONDA (arquivo no repo nao prova que rodou):
-- select nome, lembrete_1h_botao, lembrete_1h_link, lembrete_1h_off
--   from ig_automations where produto = 'eletroposto' and ativo = true;

-- VOLTAR ATRAS:
-- update ig_automations
--    set lembrete_1h_link = null, lembrete_1h_botao = null, lembrete_1h_texto = null
--  where produto = 'eletroposto';


-- ── PARTE 2 ── (OPCIONAL, SEPARADA) primeiro toque vira card com botao ───────
-- Hoje a primeira DM sai como texto + link solto. Isto a transforma no card com
-- botao "Ver as vagas", que e o "frase simples e ele clica no botao" pedido.
--
-- RISCO, e por isso esta separado: o texto de hoje ("Show! O Eletroposto e uma
-- oportunidade...") e o mesmo nas duas automacoes, inclusive na 077a84a7, que
-- esta fixada em DOIS CRIATIVOS DE ANUNCIO PAGO. Trocar a copy aqui muda a
-- resposta da campanha que esta rodando. O destino nao muda (continua o
-- /io/eletroposto), so a forma.
--
-- Rode SO se quiser mudar a campanha paga junto. Pra mudar so a organica,
-- troque o WHERE por: where id = '000b6b68-288c-4293-a2d4-1135a213b4d0'

-- update ig_automations set
--   dm_boas_vindas = 'Eletroposto: renda recorrente com carregador de carro eletrico'
--                 || chr(10) || 'Veja as vagas na sua regiao e agende sua conversa.',
--   botao_rotulo   = 'Ver as vagas'
-- where produto = 'eletroposto' and ativo = true;

-- COPY DE HOJE, pra voltar atras sem precisar procurar:
-- update ig_automations set
--   dm_boas_vindas = 'Show! O Eletroposto e uma oportunidade de investimento em carregadores de carro eletrico, com retorno recorrente. Veja como funciona aqui:',
--   botao_rotulo   = null
-- where produto = 'eletroposto';
