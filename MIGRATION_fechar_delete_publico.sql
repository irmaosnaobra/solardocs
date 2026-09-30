-- ─────────────────────────────────────────────────────────────────────────────
-- A CHAVE DA PÁGINA PARA DE APAGAR A BASE  (Supabase: gerador-propostas)
-- Rodada em produção em 29/09/2026, pelo MCP, e conferida de fora (veja a sonda).
--
-- O ACHADO: o /gerador é HTML estático com login por cima, então o fonte é público
-- e a chave publishable vem dentro dele. Conferido com `curl` anônimo em
-- solardoc.app/gerador: HTTP 200 com a chave no corpo. Com essa chave:
--   • `agendamentos` tem RLS ligada, mas a policy é `agendamentos_anon_all`
--     (FOR ALL, roles anon+authenticated, USING true, WITH CHECK true);
--   • `eletroposto_parceria`, `eletroposto_nota1` e `eletroposto_negociacao` estão
--     com RLS DESLIGADA, e aí policy nem é avaliada: o GRANT é o único portão.
-- Ou seja, quem abrisse o código-fonte da página podia apagar 1.198 reuniões, 839
-- propostas e 2.194 contatos de prospecção, e nada apareceria como erro aqui.
--
-- O QUE ISTO FAZ: tira o verbo DELETE de `anon` e `authenticated` nas tabelas que
-- guardam a base e que NINGUÉM apaga no código. Conferido com busca multilinha no
-- repositório inteiro (front e servidor): zero chamadas de DELETE nessas tabelas.
--
-- O QUE NÃO MUDA: SELECT, INSERT e UPDATE seguem iguais, então nenhuma tela muda
-- de comportamento. `service_role` (a API) não é afetada por GRANT de anon.
--
-- POR QUE REVOKE E NÃO POLICY: com RLS desligada a policy não é avaliada, e o
-- GRANT funciona nos dois casos. É também reversível numa linha (GRANT), e não
-- precisa de DROP, que é bloqueado por hook nesta casa.
--
-- FICA DE FORA DE PROPÓSITO, porque as telas e a API apagam de verdade:
-- `eletroposto_propostas` (histórico do orçamento), `crm_perdidos`,
-- `agenda_bloqueios`, `prospeccao_toques`, `prospeccao_scripts` e `social_audience`.
-- Tirar o DELETE delas quebraria botão que funciona hoje.
--
-- O QUE ISTO NÃO RESOLVE: UPDATE continua aberto para a chave da página, e é o que
-- as telas usam pra mexer em status, horário e ficha. O conserto de verdade é as
-- escritas do /gerador passarem pela API com a service key, que é obra maior e
-- fica anotada como próximo passo.
-- ─────────────────────────────────────────────────────────────────────────────

revoke delete on table
  public.agendamentos,
  public.propostas,
  public.proposta_acessos,
  public.leads_meta,
  public.eletroposto_nota1,
  public.eletroposto_parceria,
  public.eletroposto_negociacao,
  public.eletroposto_match,
  public.prospeccao_contatos,
  public.backup_acao_giovanna_20260911,
  public.backup_divisao_nilce_20260915,
  public.backup_divisao2_nilce_20260915,
  public.plano_nilce_agenda_20260915
  from anon, authenticated;

-- ── SONDA (arquivo no repo não prova que rodou) ──────────────────────────────
-- 1) Pelo banco:
--
--   select c.relname,
--          has_table_privilege('anon', c.oid, 'DELETE') as anon_apaga,
--          has_table_privilege('anon', c.oid, 'UPDATE') as anon_altera,
--          has_table_privilege('service_role', c.oid, 'DELETE') as api_apaga
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('agendamentos','propostas','eletroposto_parceria','eletroposto_propostas')
--    order by 1;
--
--   Esperado: anon_apaga false nas três primeiras e true em eletroposto_propostas,
--   anon_altera true em todas, api_apaga true em todas.
--
-- 2) De fora, com a chave que está no fonte da página (alvo inexistente, id=-1):
--
--   curl -s -o /dev/null -w '%{http_code}\n' -X DELETE \
--     -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
--     'https://ancecdfqfwlaujknizof.supabase.co/rest/v1/agendamentos?id=eq.-1'
--
--   Esperado: 401, com "permission denied for table agendamentos". Em 29/09/2026
--   deu exatamente isso, e `eletroposto_propostas` no mesmo teste deu 204.
