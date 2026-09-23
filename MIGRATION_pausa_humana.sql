-- ─────────────────────────────────────────────────────────────────────────────
-- PAUSA HUMANA — quando alguém da equipe entra na conversa, o robô cala.
--
-- Medido em 23/09/2026 na linha IO (553498165040), janela de 3 dias:
--   104 contatos em que um humano digitou pelo celular
--    31 deles (29,8%) receberam mensagem do robô DEPOIS do humano
--   165 mensagens do robô por cima de conversa humana (~55/dia)
--
-- Por que nenhum detector de takeover pegava isso. Quando o humano digita pelo
-- CELULAR, a Z-API entrega o remetente como LID, não como telefone:
--
--   humano digitou →  phone: "253068247589084@lid"   (14-15 dígitos)
--   robô enviou    →  phone: "5534991360172"  + chatLid: "253068...@lid"
--   lead escreveu  →  phone: "5534991360172"  + chatLid: "253068...@lid"
--
-- Todo detector existente faz `phone.replace(/\D/g,'')` e `.eq('phone', ...)`.
-- Contra um LID isso nunca casa, e não dá erro: dá silêncio do lado errado.
-- Era o caso de `/io-sent` (webhook.ts) e de `processIoTakeoverEvents`
-- (sdrIoPolling.ts) — ligar o cron não teria produzido um takeover sequer.
--
-- A saída é que quem traz o telefone REAL traz o chatLid junto. Dá pra montar o
-- mapa LID→telefone a partir dessas linhas: medido, 143 de 145 LIDs resolvidos
-- (98,6%), ZERO ambíguo, com 85h de antecedência média.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. O mapa LID → telefone ────────────────────────────────────────────────
-- Persistido de propósito: recalcular 981 linhas a cada tick de cron é caro e,
-- pior, some com o histórico quando a janela de varredura passa.
create table if not exists wa_lid_telefone (
  lid           text primary key,
  telefone      text        not null,   -- dígitos puros, como a Z-API entregou
  chave         text        not null,   -- DDD + 8 últimos (chaveContato)
  visto_em      timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists wa_lid_telefone_chave_idx on wa_lid_telefone (chave);

-- ── 2. A pausa em si ────────────────────────────────────────────────────────
-- Tabela PRÓPRIA, não `whatsapp_suppression`. Parece o mesmo slot e não é:
-- supressão é opt-out PERMANENTE ("não me manda mais nada"). Pausa é
-- TEMPORÁRIA. Uma resposta da Giovanna gravada como supressão calaria aquele
-- contato pra sempre, em todas as trilhas.
--
-- Chave é `chaveContato` (DDD + 8 últimos), a mesma do silenciar.ts, porque a
-- Z-API alterna o 9º dígito entre mensagens do MESMO contato.
create table if not exists atendimento_pausa (
  chave              text primary key,   -- chaveContato(telefone)
  telefone           text        not null,
  linha              text        not null default 'io',
  origem             text        not null default 'celular',  -- celular|crm|grupo|blast
  quem               text,               -- chatName/senderName, só pra auditoria
  pausado_em         timestamptz not null default now(),
  ultima_fala_humano timestamptz not null default now(),
  ultima_fala_lead   timestamptz,
  liberado_em        timestamptz,        -- null = PAUSADO
  liberado_por       text,
  motivo_liberacao   text,
  bloqueios          integer     not null default 0,  -- envios que o gate barrou
  ultimo_bloqueio_em timestamptz,
  atualizado_em      timestamptz not null default now()
);
-- O gate carrega "quem está pausado agora" — filtra por liberado_em is null.
create index if not exists atendimento_pausa_ativo_idx
  on atendimento_pausa (liberado_em, ultima_fala_humano desc);

-- ── 3. LID que ainda não deu pra resolver ───────────────────────────────────
-- 6 dos 145 LIDs só ganharam entrada no mapa DEPOIS de o humano já ter digitado,
-- e 2 nunca ganharam. Sem esta fila esses casos sumiriam calados — que é
-- exatamente o modo de falha que este arquivo inteiro existe pra matar.
-- O tick reprocessa: quando o mapa enche, a pausa nasce com a data certa.
create table if not exists wa_lid_pendente (
  lid            text primary key,
  primeira_fala  timestamptz not null default now(),  -- quando o humano digitou
  ultima_fala    timestamptz not null default now(),
  chat_name      text,
  tentativas     integer     not null default 0,
  resolvido_em   timestamptz,
  atualizado_em  timestamptz not null default now()
);
create index if not exists wa_lid_pendente_aberto_idx
  on wa_lid_pendente (resolvido_em, ultima_fala desc);
