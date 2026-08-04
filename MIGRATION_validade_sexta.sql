-- ════════════════════════════════════════════════════════════════════════════
-- Prazo do orçamento vira data cravada: próxima sexta às 18h
--
-- A validade nasceu como contagem de dias (validade_dias / dados.validadeDias).
-- Isso não expressa "vence sexta às 18h": o mesmo orçamento gerado segunda e
-- quinta teria que ter 4 e 1 dia pra vencer na mesma hora, e o selo do PDF
-- mentiria em um dos dois.
--
-- Então o prazo passa a ser um instante: `expira_em`. Quem escolhe "dias"
-- continua funcionando igual — a ordem de precedência é
--   1. dados->>'expiraEmISO'  — data cravada (padrão: próxima sexta 18h BRT)
--   2. propostas.expira_em    — espelho em coluna, pro CRM e pra consulta
--   3. created_at + validade  — o caminho antigo (dados.validadeDias > coluna > 2)
--
-- Nada de fuso no SQL: quem calcula a sexta é o navegador do consultor, que
-- grava o instante em UTC. O Brasil não tem horário de verão desde 2019, então
-- 18h de Brasília é sempre 21h UTC.
--
-- Assinatura do get_proposta_pub segue intocada (4 colunas) pelo mesmo motivo de
-- sempre: DROP FUNCTION derruba o GRANT do anon e quebra todo link em campo.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE propostas
  ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ;

COMMENT ON COLUMN propostas.expira_em IS
  'Instante em que o link para de mostrar os valores. NULL = cai na contagem de dias (validade_dias / dados.validadeDias).';

CREATE INDEX IF NOT EXISTS idx_propostas_expira_em
  ON propostas (expira_em DESC NULLS LAST);

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
  v_expira_col timestamptz;
  v_whats text;
  v_extra jsonb;
BEGIN
  SELECT p.codigo, p.dados, p.created_at, p.consultor_nome, p.expira_em,
         GREATEST(1, LEAST(365, COALESCE(
           NULLIF(NULLIF(regexp_replace(COALESCE(p.dados->>'validadeDias', ''), '[^0-9]', '', 'g'), '')::numeric, 0),
           p.validade_dias::numeric,
           2
         )))::int
    INTO v_codigo, v_dados, v_created, v_consultor, v_expira_col, v_dias
  FROM propostas p
  WHERE p.codigo = p_codigo;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Data cravada manda; sem ela, a conta antiga.
  -- O ISO vem de um <input> no navegador: se vier lixo, o cast explodiria dentro
  -- da RPC e o cliente veria "não foi possível carregar" em vez do orçamento.
  BEGIN
    v_expira := NULLIF(v_dados->>'expiraEmISO', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_expira := NULL;
  END;
  v_expira := COALESCE(v_expira, v_expira_col, v_created + (v_dias || ' days')::interval);

  SELECT regexp_replace(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g')
    INTO v_whats
  FROM consultores c
  WHERE c.nome = v_consultor;

  v_whats := COALESCE(
    NULLIF(v_dados->>'consultorWhats', ''),
    NULLIF(v_dados->'vendedor'->>'contato', ''),
    NULLIF(v_whats, ''),
    ''
  );

  v_extra := jsonb_build_object(
    'validadeDias', v_dias,
    'validadeModo', COALESCE(NULLIF(v_dados->>'validadeModo', ''), CASE WHEN v_expira_col IS NOT NULL THEN 'data' ELSE 'dias' END),
    'expiraEm', v_expira,
    'consultorWhats', v_whats
  );

  IF now() > v_expira THEN
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
