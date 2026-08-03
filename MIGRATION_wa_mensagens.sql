-- MIGRATION_wa_mensagens.sql — histórico de conversa do WhatsApp legível
-- Aplicado em produção (projeto solardoc-pro / qdpfwncyzuztibpujlbq) em 03/08/2026.
--
-- POR QUÊ
-- A Z-API não deixa ler histórico em multi-device: GET /chat-messages/{phone}
-- responde {"error":"Does not work in multi device version"} pra qualquer número.
-- Sem isso, ninguém consegue abrir o contexto de um cliente antes de responder.
--
-- Mas o histórico SEMPRE esteve aqui: toda mensagem — recebida e enviada,
-- inclusive a digitada no celular, porque a instância está com
-- receiveCallbackSentByMe=true — chega no webhook e é gravada crua em
-- webhook_debug. O que faltava era poder LER: 92 mil linhas de jsonb sem índice
-- davam statement timeout (57014) em qualquer busca por telefone.
--
-- Esta migration normaliza e indexa o que já existe. Não muda nada do webhook:
-- a captura é um trigger AFTER INSERT que engole o próprio erro, então nenhuma
-- falha aqui derruba a gravação da mensagem crua.
--
-- LER: select * from conversa_wa('19988280958');

-- ── tabela ──────────────────────────────────────────────────────────────────
create table if not exists wa_mensagens (
  id               bigserial primary key,
  chave            text not null unique,   -- messageId, ou wd:<id> pros ~21 payloads sem ele
  message_id       text,
  webhook_debug_id uuid,                   -- de onde veio; o payload cru fica a um join
  telefone         text not null,          -- só dígitos (em grupo, o id do grupo)
  is_group         boolean not null default false,
  from_me          boolean not null default false,
  from_api         boolean,                -- false = digitada no celular, não pela automação
  chat_name        text,
  sender_name      text,
  tipo             text not null default 'outro',
  texto            text,
  media_url        text,
  momment          timestamptz not null,
  instancia        text,
  criado_em        timestamptz not null default now()
);

create index if not exists wa_mensagens_tel_mom on wa_mensagens (telefone, momment desc);
create index if not exists wa_mensagens_mom     on wa_mensagens (momment desc);
create index if not exists wa_mensagens_tail    on wa_mensagens (right(telefone, 8));

-- RLS ligado e sem policy: service key (API, cron) passa; anon key não lê nada.
-- Conversa de cliente não podia nascer exposta como o resto do projeto está.
alter table wa_mensagens enable row level security;

comment on table wa_mensagens is
  'Conversa do WhatsApp legível por telefone. Alimentada por trigger em webhook_debug + backfill desde 21/04/2026. Ler com conversa_wa(telefone).';

-- ── projeção: único lugar do mapeamento ─────────────────────────────────────
-- Trigger e backfill leem daqui. Mudou o formato do payload? Muda só esta view.
create or replace view wa_mensagens_src as
select
  w.id  as wd_id,
  coalesce(w.payload->>'messageId', 'wd:' || w.id::text) as chave,
  w.payload->>'messageId' as message_id,
  regexp_replace(coalesce(w.payload->>'phone',''), '\D', '', 'g') as telefone,
  coalesce((w.payload->>'isGroup')::boolean, false) as is_group,
  coalesce((w.payload->>'fromMe')::boolean, false)  as from_me,
  (w.payload->>'fromApi')::boolean as from_api,
  w.payload->>'chatName'   as chat_name,
  w.payload->>'senderName' as sender_name,
  case
    when w.payload->'text'->>'message'          is not null then 'texto'
    when w.payload->'audio'->>'audioUrl'        is not null then 'audio'
    when w.payload->'image'->>'imageUrl'        is not null then 'imagem'
    when w.payload->'video'->>'videoUrl'        is not null then 'video'
    when w.payload->'document'->>'documentUrl'  is not null then 'documento'
    when w.payload->'sticker'                   is not null then 'figurinha'
    when w.payload->'reaction'                  is not null then 'reacao'
    when w.payload->>'notification'             is not null then 'notificacao'
    when w.payload->>'callId'                   is not null then 'chamada'
    else 'outro'
  end as tipo,
  coalesce(
    w.payload->'text'->>'message',
    w.payload->'image'->>'caption',
    w.payload->'video'->>'caption',
    w.payload->'document'->>'title',
    w.payload->'document'->>'fileName',
    w.payload->'reaction'->>'value',
    w.payload->>'notification'
  ) as texto,
  coalesce(
    w.payload->'audio'->>'audioUrl',
    w.payload->'image'->>'imageUrl',
    w.payload->'video'->>'videoUrl',
    w.payload->'document'->>'documentUrl',
    w.payload->'sticker'->>'stickerUrl'
  ) as media_url,
  case
    when (w.payload->>'momment') ~ '^[0-9]{12,}$'
      then to_timestamp((w.payload->>'momment')::bigint / 1000.0)
    else w.created_at at time zone 'UTC'
  end as momment,
  w.payload->>'instanceId' as instancia,
  w.created_at
from webhook_debug w
where w.payload->>'type' = 'ReceivedCallback'
  and coalesce(w.payload->>'phone','') <> '';

comment on view wa_mensagens_src is
  'Projeção webhook_debug -> mensagem. Único lugar do mapeamento: trigger e backfill leem daqui.';

-- ── captura ao vivo ─────────────────────────────────────────────────────────
create or replace function wa_registrar_mensagem() returns trigger
language plpgsql security definer
set search_path = public, pg_temp   -- definer sem search_path fixo é escalação
as $$
begin
  insert into wa_mensagens (
    chave, message_id, webhook_debug_id, telefone, is_group, from_me, from_api,
    chat_name, sender_name, tipo, texto, media_url, momment, instancia)
  select chave, message_id, wd_id, telefone, is_group, from_me, from_api,
         chat_name, sender_name, tipo, texto, media_url, momment, instancia
  from wa_mensagens_src where wd_id = new.id
  on conflict (chave) do nothing;
  return new;
exception when others then
  -- Nunca derruba o insert do webhook: perder a cópia legível é ruim,
  -- perder a mensagem crua é pior.
  return new;
end $$;

drop trigger if exists trg_wa_registrar_mensagem on webhook_debug;
create trigger trg_wa_registrar_mensagem
  after insert on webhook_debug
  for each row execute function wa_registrar_mensagem();

-- ── leitura ─────────────────────────────────────────────────────────────────
-- Casa pelos 8 últimos dígitos: o telefone aparece como 55DDD9..., DDD9... e +55...
-- Grupo fica de fora por padrão: o id de grupo (120363410228854732) colide nos
-- 8 dígitos finais com algum telefone mais cedo ou mais tarde, e aí a conversa
-- do cliente apareceria salpicada de papo de grupo. Terceiro argumento traz.
create or replace function conversa_wa(
  p_fone text,
  p_limite int default 300,
  p_incluir_grupo boolean default false
)
returns table (
  quando   timestamptz,
  quem     text,
  tipo     text,
  texto    text,
  telefone text,
  midia    text
)
language sql stable
set search_path = public, pg_temp
as $$
  select m.momment,
         case when m.from_me
              then case when m.from_api then 'nós (automação)' else 'nós (celular)' end
              else coalesce(nullif(m.chat_name,''), m.sender_name, m.telefone) end,
         m.tipo, m.texto, m.telefone, m.media_url
  from wa_mensagens m
  where right(m.telefone, 8) = right(regexp_replace(p_fone, '\D', '', 'g'), 8)
    and (p_incluir_grupo or not m.is_group)
  order by m.momment desc
  limit p_limite;
$$;

comment on function conversa_wa(text, int, boolean) is
  'Thread do WhatsApp de um número, sem grupo por padrão. Ex: select * from conversa_wa(''19988280958'');';

-- ── backfill (já rodado em 03/08/2026) ──────────────────────────────────────
-- Em janelas por causa do statement timeout: 28.886 ReceivedCallback ->
-- 27.477 linhas (1.409 eram messageId repetido, mortos pelo on conflict).
-- Rodar de novo é seguro: idempotente pela chave.
--
-- insert into wa_mensagens (chave, message_id, webhook_debug_id, telefone, is_group, from_me, from_api,
--                           chat_name, sender_name, tipo, texto, media_url, momment, instancia)
-- select chave, message_id, wd_id, telefone, is_group, from_me, from_api,
--        chat_name, sender_name, tipo, texto, media_url, momment, instancia
-- from wa_mensagens_src
-- where created_at >= '2026-04-01' and created_at < '2026-06-01'   -- e depois cada janela
-- on conflict (chave) do nothing;
