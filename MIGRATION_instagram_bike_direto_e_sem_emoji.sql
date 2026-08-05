-- ─────────────────────────────────────────────────────────────────────────────
-- Instagram — 05/08/2026, pedidos do Thiago em sequência:
--   1) bike entrega o contato NA HORA (negociação é ao vivo) → sem porteiro,
--      e com CARD de botão "Falar no WhatsApp" em vez de link solto;
--   2) mensagem sem emoji em todas as automações;
--   3) lembrete de 20h desligado (fica só o followup de 1h).
--
-- Projeto: GERADOR (ancecdfqfwlaujknizof), tabela ig_automations.
--
-- ROLLBACK — o que estava lá antes (copiar de volta se quiser voltar):
--   lembrete_texto:
--     Solar / Boas-vindas : 'Ainda dá tempo de fazer sua simulação de economia ⚡ É rapidinho: https://solardoc.app/simular'
--     Eletroposto         : 'Ainda dá pra conhecer a oportunidade do Eletroposto ⚡ Dá uma olhada: https://solardoc.app/io/eletroposto'
--     Kit                 : 'Ainda dá pra pegar o Kit de Fechamento por R$ 27 🔑 https://solardoc.app/kit?...utm_content=lembrete'
--     Bike                : 'A bike ainda tá disponível 🚴 Quer que eu te passe os valores?'
--     Indicação           : 'Ainda dá pra indicar e ganhar sua recompensa 💛: https://solardoc.app/io/indicacao'
--   bike dm_boas_vindas   : '🚴 Show! Te passo todos os detalhes e valores da bike por aqui. Chama a gente no WhatsApp:'
--   bike gate_off         : false   |   botao_rotulo: null (em todas)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) BIKE: contato na hora, sem porteiro, com botão.
-- A copy fica curta de propósito: o card do Instagram só aceita 80 caracteres
-- de título + 80 de subtítulo (a 1ª linha vira título, o resto vira subtítulo).
update ig_automations set
  gate_off = true,
  botao_rotulo = 'Falar no WhatsApp',
  dm_boas_vindas = 'Bike Konnan, pronta entrega.
Toque no botão e fale agora com a gente no WhatsApp: valores e condições.'
where id in ('c42f99d4-8063-4e40-b177-2253e400b7f0',    -- Bike Konnan
             '12cc8351-09bb-42c8-9e23-d642cf686f29');   -- Reel Bike Konnan

-- 2) SEM EMOJI nas mensagens que o lead recebe.
update ig_automations set
  dm_boas_vindas = 'Boa! Pra montar sua simulação de economia com energia solar, é só preencher aqui rapidinho (leva 30s) que um especialista já te chama:',
  respostas_publicas = array['Prontinho, te chamei no direct (se não achar, olha em Solicitações ou na aba Geral)',
                             'Já tá no seu direct, dá uma conferida também em Solicitações ou na aba Geral']
where id in ('cf1928b2-e859-4a69-98b7-0a2a6f0011d0',    -- Anúncio Solar
             '92f243ae-d967-4adf-8255-4450f02abcdf');   -- Solar — simulação

update ig_automations set
  dm_boas_vindas = 'Show! O Eletroposto é uma oportunidade de investimento em carregadores de carro elétrico, com retorno recorrente. Veja como funciona aqui:',
  respostas_publicas = array['Te chamei no direct (olha também em Solicitações ou na aba Geral)',
                             'Manda ver no direct (se não achar, confere em Solicitações ou na aba Geral)']
where id in ('077a84a7-beea-4f0a-af3a-82f8ed6f5bc9',    -- Anúncio Eletroposto
             '000b6b68-288c-4293-a2d4-1135a213b4d0');   -- Eletroposto — investimento

update ig_automations set
  dm_boas_vindas = 'Boa! O Kit de Fechamento do Integrador é o passo a passo pra parar de perder venda na hora do orçamento: roteiro de visita, resposta pronta pra cada objeção, precificação com margem e pós-venda. São R$ 27, acesso na hora e o conteúdo fica dentro da plataforma, junto com o gerador de documentos. Dá uma olhada:'
where id in ('170a9781-192f-4f63-9b82-9a56a9cb22a9',    -- Anúncio Kit
             '1cc09cf4-f828-4dbf-a9b7-97619eb2863d');   -- Kit de Fechamento

update ig_automations set
  dm_boas_vindas = 'Que ótimo! Indique alguém pra Irmãos na Obra e ganhe uma recompensa quando o projeto fechar e for instalado. É só preencher aqui rapidinho:'
where id = '45d1a061-6f19-4a6d-a171-6b61b980a073';      -- Indicação

update ig_automations set
  dm_boas_vindas = 'Oi, seja muito bem-vindo(a) à Irmãos na Obra! A gente ajuda você a economizar até 90% na conta de luz com energia solar. Quer ver quanto VOCÊ economiza? Leva 30 segundos:'
where id = 'b73df713-bb84-4f2a-96d7-e79c404527af';      -- Boas-vindas

-- Menu e rede de segurança: o mesmo texto, sem os ícones das opções.
update ig_automations set
  dm_boas_vindas = 'Oi! Vi seu comentário e vim te responder por aqui.

Pra eu te mandar a informação certa, é só responder com UMA palavra:

SOLAR - economizar até 90% na conta de luz
ELETROPOSTO - investir em carregador de carro elétrico
BIKE - bicicleta elétrica

Ou me manda seu WhatsApp que um especialista te chama.'
where id in ('6e377ebb-3187-4d1c-b42e-98292000e3f5',    -- Menu
             '94c614d4-161f-4be2-959a-dd4430e4a758');   -- Rede de segurança

-- Resposta pública das demais (bike, kit, indicação, boas-vindas, menu, rede).
update ig_automations set
  respostas_publicas = array['Prontinho, te chamei no direct (se não achar, olha em Solicitações ou na aba Geral)']
where respostas_publicas::text like '%👀%' or respostas_publicas::text like '%⚡%';

-- 3) LEMBRETE DE 20h DESLIGADO — sobra o followup de 1h, que é o que o dono pediu.
update ig_automations set lembrete_texto = null where lembrete_texto is not null;
