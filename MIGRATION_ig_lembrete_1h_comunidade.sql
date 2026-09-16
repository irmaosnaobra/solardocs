-- Segundo destino do lembrete de 1h do Instagram  (15/09/2026)
-- Projeto: gerador-propostas (ancecdfqfwlaujknizof) -- a ig_automations mora la.
--
-- POR QUE: a primeira DM de quem comenta em post de eletroposto leva pro
-- agendamento. Uma hora depois o lembrete leva pra COMUNIDADE do WhatsApp.
-- Sao dois destinos diferentes, e ate agora o lembrete so sabia repetir o
-- link_url da propria automacao -- o mesmo link, uma hora depois, pra quem ja
-- tinha decidido nao clicar.
--
-- Aditivo e reversivel: coluna nula = comportamento de antes, sem botao.
-- O codigo so monta o botao quando link + rotulo + copy propria estao os tres
-- preenchidos (ver lembrete1h em api/src/services/instagram/igGate.ts).

alter table ig_automations add column if not exists lembrete_1h_link  text;
alter table ig_automations add column if not exists lembrete_1h_botao text;

comment on column ig_automations.lembrete_1h_link is
  'Destino do lembrete de 1h quando ele leva pra OUTRO lugar que nao o link_url (ex.: convite da comunidade). Nulo = lembrete sem botao.';
comment on column ig_automations.lembrete_1h_botao is
  'Rotulo do botao do lembrete de 1h. Teto da Meta: 20 caracteres. Exige lembrete_1h_link e lembrete_1h_texto preenchidos.';

-- SONDA: arquivo no repo nao prova que rodou.
-- select column_name from information_schema.columns
--  where table_name = 'ig_automations' and column_name like 'lembrete_1h%';
-- Esperado: lembrete_1h_texto, lembrete_1h_off, lembrete_1h_link, lembrete_1h_botao
