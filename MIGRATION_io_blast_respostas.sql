-- Fila de quem RESPONDEU a um disparo em massa.
-- APLICADO no Supabase em 29/07/2026 (migration io_blast_respostas).
--
-- Por que existe: hoje a resposta a um blast cai no vazio. O agente de SDR tem
-- early-return para a linha 'io', e o próprio disparo marca human_takeover pra
-- calar os bots — então só aparece pra quem abrir o WhatsApp na mão.
--
-- Quem pede pra parar vai direto pra whatsapp_suppression (a mesma lista que o
-- motor de disparo consulta antes de mandar) e aparece aqui só como informação:
-- se o número de negativas cresce, o problema é a copy, não a lista.
create table if not exists io_blast_respostas (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  tel_key text not null,
  texto text,
  broadcast_id uuid,
  respondido_em timestamptz not null default now(),
  classificacao text not null default 'atender',   -- 'atender' | 'negativa'
  atendido boolean not null default false,
  atendido_em timestamptz,
  criado_em timestamptz not null default now()
);

-- Evita registrar a mesma resposta a cada tick do cron.
create unique index if not exists idx_blast_resp_unica on io_blast_respostas (tel_key, respondido_em);
create index if not exists idx_blast_resp_fila on io_blast_respostas (atendido, respondido_em desc);
