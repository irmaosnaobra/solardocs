-- ════════════════════════════════════════════════════════════════════════════
-- Validade do orçamento: editável por proposta, padrão 2 dias
--
-- Antes: o link vivia 7 dias fixos, escritos dentro do get_proposta_pub. Nem o
-- consultor podia mudar, nem o cliente sabia até quando valia.
--
-- Agora a validade sai, em ordem:
--   1. dados->>'validadeDias'  — o que o consultor digitou na hora de gerar
--   2. propostas.validade_dias — âncora das propostas antigas (backfill = 7)
--   3. 2                       — padrão novo
--
-- Por que a coluna existe se o valor mora no `dados`: as 540 propostas que já
-- estão no ar foram enviadas sob a promessa de 7 dias. Baixar o padrão pra 2 sem
-- âncora mataria na hora todo link com 2 a 7 dias de vida — cliente no meio da
-- negociação abrindo tela de expirado. O backfill congela o passado; o futuro
-- usa o campo do formulário.
--
-- A assinatura do get_proposta_pub NÃO muda (mesmas 4 colunas): a RPC é chamada
-- do navegador do cliente com a chave publishable, e um DROP FUNCTION derrubaria
-- o GRANT do anon — todo link em campo quebraria. Os campos novos entram DENTRO
-- do jsonb `dados`, que o front já lê.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Âncora do passado. NULL em linha nova = "usa o dados/padrão".
ALTER TABLE propostas
  ADD COLUMN IF NOT EXISTS validade_dias INTEGER;

UPDATE propostas SET validade_dias = 7 WHERE validade_dias IS NULL;

COMMENT ON COLUMN propostas.validade_dias IS
  'Validade do link em dias. Preenchida no backfill (7) para as propostas anteriores a 04/08/2026; nas novas quem manda é dados->>validadeDias.';

-- 2. A RPC pública do cliente.
CREATE OR REPLACE FUNCTION public.get_proposta_pub(p_codigo text)
 RETURNS TABLE(codigo text, dados jsonb, created_at timestamp with time zone, expirou boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_codigo text;
  v_dados jsonb;
  v_created timestamptz;
  v_consultor text;
  v_dias int;
  v_expira timestamptz;
  v_whats text;
  v_extra jsonb;
BEGIN
  SELECT p.codigo, p.dados, p.created_at, p.consultor_nome,
         -- Clamp 1..365: o campo é livre no formulário e já chegou "99999999999999"
         -- por aí. Sem o teto, o ::int estoura e a RPC devolve 500 — o cliente
         -- veria "não foi possível carregar" em vez do orçamento.
         GREATEST(1, LEAST(365, COALESCE(
           NULLIF(NULLIF(regexp_replace(COALESCE(p.dados->>'validadeDias', ''), '[^0-9]', '', 'g'), '')::numeric, 0),
           p.validade_dias::numeric,
           2
         )))::int
    INTO v_codigo, v_dados, v_created, v_consultor, v_dias
  FROM propostas p
  WHERE p.codigo = p_codigo;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_expira := v_created + (v_dias || ' days')::interval;

  -- Telefone de QUEM atende. Cai em cascata porque 529 das 540 propostas não
  -- congelaram contato nenhum no jsonb — sem o cadastro `consultores` a tela de
  -- expirado ficaria sem botão justamente nas propostas antigas, que são as que
  -- expiram. O cliente não está logado; quem resolve isso é o servidor.
  SELECT regexp_replace(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g')
    INTO v_whats
  FROM consultores c
  WHERE c.nome = v_consultor;

  v_whats := COALESCE(
    NULLIF(v_dados->>'consultorWhats', ''),               -- solar: congelado na proposta
    NULLIF(v_dados->'vendedor'->>'contato', ''),          -- eletroposto: card do vendedor
    NULLIF(v_whats, ''),                                  -- cadastro de consultores
    ''
  );

  v_extra := jsonb_build_object(
    'validadeDias', v_dias,
    'expiraEm', v_expira,
    'consultorWhats', v_whats
  );

  IF now() > v_expira THEN
    -- Expirou: nenhum número comercial sai daqui. Só o suficiente pra tela de
    -- expirado chamar o cliente pelo nome e dar um botão pro consultor certo.
    RETURN QUERY SELECT
      v_codigo,
      jsonb_build_object(
        'nome', v_dados->>'nome',
        'consultor', COALESCE(NULLIF(v_dados->>'consultor', ''), v_consultor),
        'produto', v_dados->>'produto'
      ) || v_extra,
      v_created,
      true;
  ELSE
    RETURN QUERY SELECT v_codigo, v_dados || v_extra, v_created, false;
  END IF;
END;
$function$;
