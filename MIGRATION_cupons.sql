-- =============================================
-- MIGRATION: cupons de primeiro mês (link + código que o Thiago manda pro cliente)
-- Execute no Supabase SQL Editor (projeto solardoc-pro qdpfwncyzuztibpujlbq)
--
-- Um cupom aqui diz UMA coisa: quanto o cliente paga no PRIMEIRO mês. Da segunda
-- cobrança em diante é o preço cheio do plano — no cartão (desconto `once` da
-- Stripe) e no Pix recorrente (primeira cobrança separada da mensalidade).
-- =============================================

CREATE TABLE IF NOT EXISTS cupons (
  codigo              text PRIMARY KEY,           -- sempre em MAIÚSCULO
  descricao           text,
  primeiro_mes_valor  numeric NOT NULL,           -- o que o cliente paga no 1º mês
  planos              text[] NOT NULL DEFAULT ARRAY['ilimitado'],
  validade            timestamptz,                -- NULL = sem prazo
  usos_max            integer,                    -- NULL = ilimitado
  usos                integer NOT NULL DEFAULT 0,
  ativo               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Um uso = um pagamento confirmado. `referencia` (checkout_session_id no cartão,
-- contract_id no Pix) é ÚNICA: reentrega de webhook não conta duas vezes.
CREATE TABLE IF NOT EXISTS cupom_usos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      text NOT NULL REFERENCES cupons(codigo) ON DELETE CASCADE,
  email       text,
  origem      text NOT NULL,                      -- 'stripe' | 'pix'
  referencia  text NOT NULL UNIQUE,
  valor_pago  numeric,
  em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cupom_usos_codigo ON cupom_usos(codigo);

-- Contagem de uso no BANCO, não na aplicação: dois pagamentos no mesmo instante
-- não podem ler 4 e gravar 5 os dois. Devolve 'ok' ou 'repetido'.
CREATE OR REPLACE FUNCTION registrar_uso_cupom(
  p_codigo text, p_email text, p_origem text, p_referencia text, p_valor numeric
) RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO cupom_usos (codigo, email, origem, referencia, valor_pago)
  VALUES (upper(p_codigo), p_email, p_origem, p_referencia, p_valor)
  ON CONFLICT (referencia) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'repetido';
  END IF;

  UPDATE cupons SET usos = usos + 1 WHERE codigo = upper(p_codigo);
  RETURN 'ok';
END;
$$;

-- Cupom pedido pelo Thiago em 08/08/2026: primeiro mês a R$ 19, depois o preço
-- cheio do VIP (R$ 67). Sem prazo e sem teto de usos — para limitar, é só
-- preencher `validade` e/ou `usos_max` aqui pelo painel do Supabase; desligar é
-- `ativo = false` (não precisa de deploy nem de mexer na Stripe).
INSERT INTO cupons (codigo, descricao, primeiro_mes_valor, planos)
VALUES ('ACESSO19', 'Primeiro mês por R$ 19 — depois R$ 67/mês', 19, ARRAY['ilimitado'])
ON CONFLICT (codigo) DO NOTHING;
