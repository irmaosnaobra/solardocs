-- Rastreamento nível 5 (10/11/2026). Só acrescenta: nada de DROP, nada de UPDATE em linha existente.
-- Cards antigos ficam com origem nula; quem lê usa coalesce(origem, created_by, 'manual').

-- ============================================================
-- Banco do Gerador (gerador-propostas, ancecdfqfwlaujknizof)
-- ============================================================

-- Origem e anúncio no card: dado não sensível, pode morar em agendamentos.
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS ad_id  text;

-- Dado de casamento com o Meta (fbc, fbp, IP, navegador) fica FORA de agendamentos,
-- que é lida pela chave pública do /gerador. Só o servidor (service role) lê e grava.
CREATE TABLE IF NOT EXISTS public.agendamento_rastreio (
  agendamento_id bigint PRIMARY KEY REFERENCES public.agendamentos(id) ON DELETE CASCADE,
  fbc         text,
  fbp         text,
  fbclid      text,
  client_ip   text,
  user_agent  text,
  landing_url text,
  referrer    text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agendamento_rastreio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agendamento_rastreio FROM anon, authenticated;

-- Medidor de qualidade dos pixels (Dataset Quality API), uma linha por pixel x evento x medição.
CREATE TABLE IF NOT EXISTS public.meta_qualidade_dataset (
  id         bigserial PRIMARY KEY,
  medido_em  timestamptz NOT NULL DEFAULT now(),
  dataset_id text NOT NULL,
  produto    text,
  event_name text,
  nota       numeric,
  cobertura  jsonb,
  bruto      jsonb
);
CREATE INDEX IF NOT EXISTS meta_qualidade_dataset_idx
  ON public.meta_qualidade_dataset (dataset_id, event_name, medido_em DESC);
ALTER TABLE public.meta_qualidade_dataset ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_qualidade_dataset FROM anon, authenticated;

-- Card que nasce sem origem: deriva de created_by; sem created_by vira 'manual'.
-- Nunca levanta erro (agenda nunca bloqueia).
CREATE OR REPLACE FUNCTION public.agendamentos_origem_padrao()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origem IS NULL OR btrim(NEW.origem) = '' THEN
    NEW.origem := COALESCE(NULLIF(btrim(NEW.created_by), ''), 'manual');
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER trg_agendamentos_origem
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.agendamentos_origem_padrao();

-- ============================================================
-- Banco principal da SolarDoc (solardoc-pro, qdpfwncyzuztibpujlbq)
-- ============================================================

ALTER TABLE public.page_visits
  ADD COLUMN IF NOT EXISTS fbc    text,
  ADD COLUMN IF NOT EXISTS fbp    text,
  ADD COLUMN IF NOT EXISTS fbclid text;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS fbc         text,
  ADD COLUMN IF NOT EXISTS fbp         text,
  ADD COLUMN IF NOT EXISTS fbclid      text,
  ADD COLUMN IF NOT EXISTS landing_url text,
  ADD COLUMN IF NOT EXISTS referrer    text;
