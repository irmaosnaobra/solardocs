-- Eletroposto no Instagram: DM leva pro agendamento, lembrete de 1h leva pra
-- COMUNIDADE do WhatsApp.  (15/09/2026)
-- Projeto: gerador-propostas (ancecdfqfwlaujknizof)
--
-- NAO EXECUTADO AINDA: falta o link do convite da comunidade.
-- Troque COLE_O_LINK_AQUI pelo chat.whatsapp.com/... e rode.
--
-- Atinge as DUAS automacoes de eletroposto (o anuncio pago fixado nas midias e
-- a organica por palavra-chave), porque o primeiro toque continua levando pro
-- /io/eletroposto exatamente como hoje. O que muda:
--   1) a primeira DM vira CARD com botao (hoje sai como texto + link solto);
--   2) o lembrete de 1h, que hoje repete "conseguiu abrir o link?" com o MESMO
--      link, passa a convidar pra comunidade.
--
-- LIMITES DA META, medidos no codigo, nao chutados:
--   . card: 1a linha = titulo (80), resto = subtitulo (80), rotulo do botao 20;
--   . texto acima de 160 caracteres deixa de ser card e vira texto puro;
--   . o lembrete de 1h SO sai com a janela de 24h aberta, e quem abre a janela
--     e a RESPOSTA da pessoa. Nos ultimos 60 dias isso foi 48% de quem comentou
--     em eletroposto (52 de 109). Quem so clicou no botao e sumiu nao recebe.

update ig_automations set
  dm_boas_vindas = 'Eletroposto: renda recorrente com carregador de carro eletrico'
                || chr(10) || 'Veja as vagas na sua regiao e agende sua conversa.',
  botao_rotulo   = 'Ver as vagas',

  lembrete_1h_texto = 'Enquanto voce decide, entra na comunidade do Eletroposto.'
                   || chr(10) || 'La tem vaga nova, retorno real e bastidor de quem ja instalou.',
  lembrete_1h_link  = 'COLE_O_LINK_AQUI',
  lembrete_1h_botao = 'Entrar na comunidade'
where produto = 'eletroposto' and ativo = true;
-- Esperado: UPDATE 2

-- SONDA (arquivo no repo nao prova que rodou):
-- select nome, botao_rotulo, lembrete_1h_botao, lembrete_1h_link
--   from ig_automations where produto = 'eletroposto' and ativo = true;

-- VOLTAR ATRAS (desliga o convite sem mexer no resto):
-- update ig_automations set lembrete_1h_link = null, lembrete_1h_botao = null,
--        lembrete_1h_texto = null
--  where produto = 'eletroposto';
