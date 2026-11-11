-- ─────────────────────────────────────────────────────────────────────────────
-- TRAVA DE AVISO AO CONSULTOR (WhatsApp "o cliente abriu / clicou / baixou o PDF")
--
-- RODAR NO PROJETO SUPABASE DO **GERADOR** (ancecdfqfwlaujknizof), o mesmo de propostas, consultores
-- e proposta_acessos. NÃO rodar no principal do SolarDoc.
--
-- Por que existe: o aviso passa a sair também no clique do WhatsApp e no download do PDF, e o link é público. Sem
-- trava no banco, um robô ou alguém atrás do link poderia fazer a linha do Gerador mandar WhatsApp em volume.
-- A trava mora AQUI (e não na memória da api) porque a api é serverless: cada invocação nasce com a memória vazia.
--
-- Regras, todas decididas numa operação só, atrás de pg_advisory_xact_lock (duas chamadas ao mesmo tempo não
-- furam o limite):
--   0. Proposta que não existe, ou cujo consultor não tem telefone em consultores.whatsapp -> NEGA SEM gravar
--      reserva (não gasta a cota). O telefone é buscado ANTES de reservar.
--   1. O mesmo (código, grupo) avisou há menos de 30 minutos  -> NEGA.
--   2. Já houve 12 reservas na última hora (todas as propostas) -> NEGA.
--   3. Já houve 6 reservas nos últimos 10 minutos (todas)       -> NEGA.
--   4. Senão grava a reserva e devolve o que o envio precisa (telefone e nome do consultor, nome do cliente).
-- Grupos: abertura + abertura_expirada = 'abertura'; click_wpp_cta + click_wpp_expirado = 'whatsapp'; click_pdf = 'pdf'.
-- Tipo fora dessa lista: nega sem gravar. Reservas com mais de 2 dias são apagadas no mesmo passo.
--
-- O evento em si (proposta_acessos) é gravado sempre, por registrar_acesso_ev: esta RPC só decide se o WhatsApp sai.
--
-- NÃO mexe em pode_notificar_consultor: ela continua no banco para voltar atrás (a api cai nela sozinha quando
-- esta função ainda não existe). Devolve as mesmas 4 colunas dela: pode, consultor_telefone, consultor_nome, cliente_nome.
-- O telefone vem SÓ de consultores.whatsapp, pelo propostas.consultor_nome (consultores.nome), como na
-- pode_notificar_consultor de produção. Definição antiga conferida em 10/11/2026 com pg_get_functiondef: SECURITY DEFINER,
-- `SELECT ... FROM consultores c WHERE c.nome = v_consultor_nome`, e propostas.codigo é text.
--
-- PERMISSÃO: a api fala com o banco do Gerador pela chave publishable (a SUPABASE_GERADOR_SERVICE_KEY não existe na Vercel), e a
-- pode_notificar_consultor de produção é executável por anon, authenticated e service_role. Esta segue o mesmo padrão:
-- GRANT a anon, authenticated e service_role. O risco que fica: alguém com a chave anon (que está no HTML do /gerador)
-- chamar a RPC em loop e gastar a cota, CALANDO avisos por algumas horas. Nunca mandar mensagem: quem envia é a api, e só
-- para o telefone do consultor dono da proposta, dentro dos mesmos tetos. A tabela de reserva fica com RLS ligada, sem política e sem
-- grant a anon/authenticated: só a função (SECURITY DEFINER) escreve nela.
-- Prova: sonda-reserva-aviso.sql e sonda-reserva-aviso-real.sql (transações que terminam em ROLLBACK).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.aviso_consultor_reserva (
  id        bigserial PRIMARY KEY,
  codigo    text NOT NULL,
  tipo      text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aviso_reserva_codigo ON public.aviso_consultor_reserva (codigo, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_aviso_reserva_criado ON public.aviso_consultor_reserva (criado_em DESC);

-- RLS ligada e SEM política: nem anon nem authenticated enxergam a tabela. A tabela guarda só código e tipo.
ALTER TABLE public.aviso_consultor_reserva ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aviso_consultor_reserva FROM anon, authenticated;

-- O grupo de um tipo de evento. NULL = tipo que não avisa.
CREATE OR REPLACE FUNCTION public.aviso_consultor_grupo(p_tipo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_tipo
    WHEN 'abertura' THEN 'abertura'
    WHEN 'abertura_expirada' THEN 'abertura'
    WHEN 'click_wpp_cta' THEN 'whatsapp'
    WHEN 'click_wpp_expirado' THEN 'whatsapp'
    WHEN 'click_pdf' THEN 'pdf'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.reservar_aviso_consultor(p_codigo text, p_tipo text)
 RETURNS TABLE(pode boolean, consultor_telefone text, consultor_nome text, cliente_nome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo text;
  v_consultor text;
  v_dados jsonb;
  v_tel text;
BEGIN
  -- Uma fila só para todas as chamadas: os limites são globais, então a checagem e a gravação não podem se cruzar.
  PERFORM pg_advisory_xact_lock(hashtext('reservar_aviso_consultor'));

  DELETE FROM aviso_consultor_reserva WHERE criado_em < now() - interval '2 days';

  v_grupo := aviso_consultor_grupo(p_tipo);
  IF v_grupo IS NULL OR p_codigo IS NULL OR p_codigo = '' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT p.consultor_nome, p.dados INTO v_consultor, v_dados FROM propostas p WHERE p.codigo = p_codigo;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- O telefone ANTES de reservar: sem telefone o aviso não tem para quem ir, e a reserva gastaria a cota à toa.
  SELECT regexp_replace(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') INTO v_tel FROM consultores c WHERE c.nome = v_consultor;
  IF v_tel IS NULL OR v_tel = '' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 1. O mesmo código e grupo avisou há menos de 30 minutos.
  IF EXISTS (
    SELECT 1 FROM aviso_consultor_reserva r
    WHERE r.codigo = p_codigo AND aviso_consultor_grupo(r.tipo) = v_grupo AND r.criado_em > now() - interval '30 minutes'
  ) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 2 e 3. Teto global: 12 por hora e 6 a cada 10 minutos (todas as propostas juntas).
  IF (SELECT count(*) FROM aviso_consultor_reserva r WHERE r.criado_em > now() - interval '1 hour') >= 12
     OR (SELECT count(*) FROM aviso_consultor_reserva r WHERE r.criado_em > now() - interval '10 minutes') >= 6 THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  INSERT INTO aviso_consultor_reserva (codigo, tipo) VALUES (p_codigo, p_tipo);

  RETURN QUERY SELECT
    true,
    v_tel,
    COALESCE(NULLIF(v_dados->>'consultor', ''), v_consultor),
    COALESCE(NULLIF(v_dados->>'nome', ''), 'Cliente');
END;
$function$;

-- Mesmo padrão da pode_notificar_consultor de produção: anon, authenticated e service_role executam.
REVOKE EXECUTE ON FUNCTION public.reservar_aviso_consultor(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_aviso_consultor(text, text) TO anon, authenticated, service_role;
