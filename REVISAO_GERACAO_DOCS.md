# Revisão — Geração de Documentos (SolarDoc)

Data: 2026-06-05. Escopo: todo o fluxo de geração de documentos (forms → API → template/IA → save → preview).

## Método
- Sinais empíricos: `tsc --noEmit` (API, strict) e suíte de testes vitest.
- Leitura do motor compartilhado: `documentsController.ts`, `aiService.ts`, `templateService.ts`, `documentPrompts.ts`, `planService.ts`.
- Field-contract pass: chaves que cada form envia (`fields`) × chaves que cada template/prompt lê (`f.<key>`).
- **Não foi possível** rodar geração real (precisa Supabase + chaves de IA + auth). Render final precisa ser confirmado no site.

## O que foi CORRIGIDO
- **Teste `documents.route.test.ts` estava quebrado (2/6 falhando).** Causa: o controller passou a fazer 7 chamadas `.single()` (adicionou check de plano free na L63 e check de VIP na L160), mas o mock só enfileirava 5 → mocks desalinhavam → 500 em vez de 200/403. **Não era bug do controller** (em produção cada query bate na sua tabela; o desalinhamento só existe no mock compartilhado do teste). Corrigido adicionando os 2 mocks faltantes nas posições certas. Agora 6/6 verde.

## O que foi VERIFICADO e está OK
- **Dispatch dos 7 tipos** (`generateFromTemplate`): contratoSolar, contratoPJ, procuracao, propostaBanco, prestacaoServico, vistoria, propostaSolar — todos têm branch; `default` lança erro claro (sem string vazia silenciosa).
- **Modelo de IA**: `aiService.ts` usa `claude-sonnet-4-6` — ID válido e atual (confirmado via skill claude-api). OpenAI `gpt-4o` como primário se `OPENAI_API_KEY` setado.
- **Prompts de IA** (`getPrompt`): branch por tipo para os 5 docs jurídicos; `default` lança erro (sem prompt vazio). vistoria/propostaSolar são template-only (forms sempre mandam `useTemplate:true`).
- **Field contracts** (forms × templates): batem em todos. Convenções singular/plural são consistentes POR template (ContratoSolar usa `quantidade_*`; PrestacaoServico/PropostaSolar usam `qtd_*`) e os forms correspondentes seguem a mesma convenção.
- **PropostaSolar (free-tier, maior tráfego)**: chaves do form batem com `propostaSolarM1`. Reads que não vêm do form: `codigo` (injetado no controller L135), `cidade`/`uf` (injetados no payload), `ref.tarifa`/`ref.hsp` (dados regionais via getRef, nunca vazios), e `vendedor_*`/`nomes_procuradores` (fallback gracioso `'___'`, sem input no form — cosmético, não quebra).
- **Modo avulso** (`cliente_nome_avulso`, só vistoria+propostaSolar): templates leem `client.*` mas com fallback para `f.*` (ex: `cidade`, `uf`, `tipo_telhado` vêm do form). Sem campo em branco crítico.
- **Reverse field-contract (form → template), checado nos 2 críticos:**
  - PropostaSolar: `garantia_extra1/2_*` e `pag_cartao_1..17` do form SÃO lidos via chave computada no template (`f[\`garantia_extra${i}_nome\`]`, `f[\`pag_cartao_${n}\`]`). Não caem no vazio. ✓
  - Vistoria avulso: `endereco` lê `f.endereco_visita` PRIMEIRO (form), só cai pra `client.*` se vazio; `client.cpf_cnpj` é condicional (omite o trecho se ausente, não imprime `___`); `client.nome` vem do avulso. Render correto em avulso. ✓
- **Save + Storage**: insert com retry em race de `codigo_curto` (unique constraint). VIP sobe HTML pro Storage. PRO/free sem histórico completo (esperado).

## Achados FORA do escopo (não corrigidos — precisa decisão)
- **`cron.route.test.ts` > GET /cron/master falha (500 esperado 200).** Mesmo padrão de mock desatualizado: o handler `/master` passou a chamar `cleanupProDocuments`, `enviarReagendarDiario`, `syncLeadsMeta`, `syncSocialWindsor` — nenhum mockado no teste → chamadas reais → 500. Não é geração de docs; corrigir exige entender o handler master inteiro.
- **Label cosmético**: `documentsController.ts:153` grava `modelo_usado = 'claude-opus-4-6'` quando na verdade o aiService usa `claude-sonnet-4-6`. String no DB, não afeta geração.

## TESTAR NO SITE (não dá pra confirmar render aqui)
1. Gerar **proposta avulsa** (sem cliente cadastrado) e confirmar que cidade/UF/tipo de telhado aparecem.
2. Gerar **proposta com cliente cadastrado** e conferir os mesmos campos.
3. Gerar 1 de cada: Contrato Solar (M1 e M2), Procuração (M1/M2/M3), Proposta Banco (M1/M2), Prestação de Serviço, Contrato Vendedor, Vistoria.
4. Conferir que assinatura/valores/datas saem preenchidos (não `___` onde deveria ter dado).
5. Como VIP: confirmar que o doc aparece no Histórico e o PDF abre.
