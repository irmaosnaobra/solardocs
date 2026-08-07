# CLAUDE.md — PROJETO PLUGCASH

Arquivo de memória do projeto. Leia antes de qualquer tarefa.

---

## O QUE É

**PlugCash** — plataforma de conteúdo, serviços e intermediação para o mercado de
eletropostos (estações de recarga de veículos elétricos) no Brasil.

Faz parte do grupo Aioros, junto com SolarDoc Pro, Irmãos na Obra e Limpa Solar Pro.
A operação de eletroposto roda sob a marca **Irmãos na Obra — Mobilidade Elétrica**;
o PlugCash é o braço digital dela.

**Domínio:** `plugcash.solardoc.app`
**Página de captação existente:** `solardoc.app/io/eletroposto`
**CRM existente:** `solardoc.app/gerador`

---

## MODELO DE NEGÓCIO EM UMA TELA

O tráfego pago cai na página do eletroposto. A VSL de 7 minutos roda no topo, liberada.
O formulário qualifica o lead de 0 a 11 pontos.

| Nota | Faixa | Destino |
|---|---|---|
| 3 | 9–11 | Agenda reunião — venda turnkey, ticket ~R$ 160 mil |
| 2 | 5–8 | Agenda reunião com foco em definir o ponto |
| 1 | 0–4 | **Não agenda.** Vai para a página de vendas de R$ 197 |

O nota 1 compra o produto de entrada, cai dentro do PlugCash, e percorre uma esteira
de cursos e serviços **organizada pelo motivo que o desqualificou**. Quando ele resolve
a falta (consegue o ponto, viabiliza o capital, convence o sócio), volta para a agenda
como nota 3.

**Onde o negócio ganha dinheiro de verdade:** não é no curso. É no backend —
equipamento comprado pela rede de fornecedores, engenharia, projeto, homologação e
execução credenciada. Os produtos digitais são aquisição e aquecimento.

---

## STACK E INFRAESTRUTURA

- Next.js + Supabase + Vercel
- **Mesmo projeto Supabase e mesmo Auth do solardoc.app.** Não criar projeto novo.
- **O auth NÃO é Supabase Auth** (premissa corrigida em 07/08/2026 lendo o código):
  o solardoc.app usa JWT próprio — `api/src/routes/auth.ts` → `authController`,
  bcrypt, cookie `solardoc_token`, tabela `users` do projeto **solardoc-pro**.
  É esse auth que o PlugCash reaproveita; Supabase aqui é só banco.
- Usuário do SolarDoc entra no PlugCash sem novo cadastro; o acesso é um registro
  na tabela de níveis
- Tabelas do PlugCash com prefixo `pc_` para não colidir
- **Dois bancos, sem FK entre eles.** `pc_*` e `users` ficam em *solardoc-pro*;
  `agendamentos` e `eletroposto_nota1` ficam em *gerador-propostas*. Não fazer
  consulta cruzada em runtime: a qualificação é copiada (snapshot) para
  `pc_membros` na primeira vez que o usuário abre o app. A ponte é o TELEFONE,
  atravessada uma vez só.
- **A ponte é `telefone_norm` = DDD (2) + os 8 últimos dígitos.** `users.whatsapp`
  vem com 10, 11 ou 13 dígitos (com ou sem o 55, às vezes mascarado); a ficha do
  eletroposto vem sempre com 13. Igualdade crua dá zero para sempre, e casar
  pelos últimos 10 come o primeiro dígito do DDD (32999126804 bateria com
  82999126804). A regra vive em `public.ep_tel_norm()` no banco do gerador
  (coluna gerada + índice) e espelhada em `telNorm()` em `api/src/routes/plugcash.ts`.
- A pontuação chama `pts` em `eletroposto_nota1` e `pontuacao_total` em
  `agendamentos`. O alias do PostgREST (`pontuacao_total:pts`) uniformiza.
- Mesmo gateway de pagamento dos outros produtos — verificar no código qual é
- Pixel + CAPI com deduplicação por `event_id`, mesmo padrão dos outros projetos

---

## REGRAS DE TRABALHO

1. **Leia o código existente antes de escrever qualquer coisa.** Reutilize design system,
   componentes e padrões do solardoc.app. Não adicione biblioteca sem necessidade.
2. **Não invente valores.** Todo preço está declarado nos documentos. Se não estiver,
   pergunte.
3. **Preços nunca hardcoded.** Sempre em tabela editável pelo `/admin`.
4. **Links de checkout nunca no código.** Sempre em tabela.
5. **Não altere as premissas de cálculo do simulador** da página do eletroposto.
6. Pare e reporte ao final de cada item. Não encadeie várias etapas de uma vez.
7. Ao terminar, liste o que mudou e o que precisa de confirmação humana.

---

## GUARDRAILS CRÍTICOS

**A oferta de R$ 197 não pode aparecer em lugar nenhum da página principal.**
Nem antes do formulário, nem para nota 2, nem para nota 3. Ela existe exclusivamente
na tela pós-desqualificação. Se vazar, troca-se venda de R$ 160 mil por venda de R$ 197.

**Nada vai ao ar com conteúdo placeholder.** Curso publicado sem aula gravada gera
reembolso, e a base do PlugCash é a mesma do SolarDoc — o dano não fica contido.

**Sem artifício de conversão.** Nada de contador regressivo falso, vaga fictícia,
depoimento inventado ou "de R$ X por R$ Y" sem que o preço cheio tenha existido.
O público chega de uma peça técnica de 7 minutos; truque aqui contamina a marca
principal.

**Capacidade antes de venda.** Todo serviço da esteira tem limite mensal configurável.
Ao atingir o teto, vira lista de espera. Isso protege a garantia de execução.

---

## PREÇOS

Todos **a confirmar** — nenhum foi validado em mercado. Editáveis pelo admin.

| Item | Valor |
|---|---|
| Fundamentos do Eletroposto | R$ 197 |
| Order bump — planilha de viabilidade | R$ 47 |
| Ponto Zero | R$ 497 |
| Capital e financiamento | R$ 397 |
| Dossiê do sócio | R$ 297 |
| Projeto e homologação | R$ 697 |
| Equipamento | R$ 497 |
| Operação e precificação | R$ 397 |
| Credenciamento Integrador | R$ 997 + R$ 97/mês |
| Mentoria Investidor | R$ 5.997 |
| Turnkey (eletroposto completo) | R$ 120 mil a R$ 220 mil · 80 kW ≈ R$ 160 mil |

Valor pago em curso abate no upgrade para Integrador ou Mentoria, via crédito na conta.

---

## GARANTIAS (pendentes de aprovação humana)

Estas duas aparecem na VSL e nos criativos. **Não publique nada que as cite sem
confirmação explícita do Aioros e do Thiago** — elas viram compromisso comercial.

1. Projeto reprovado na distribuidora seguindo nosso direcionamento: refazemos até
   aprovar, sem custo adicional. *Restringir às regiões onde já há histórico de aprovação.*
2. Se o estudo de viabilidade concluir que o ponto não presta: devolução integral e o
   cliente fica com o laudo.

Cursos: garantia de 7 dias, devolução integral, o aluno mantém o material baixado.

---

## MARCA

Preto `#0A0A0A` · branco `#FFFFFF` · verde `#00C853` (acento) · verde escuro `#009B40`.
Verde é acento, nunca fundo de bloco grande.
Hero e páginas de venda em fundo preto; interior do app em fundo claro.
Logo e símbolo em `/brand`. Converter o texto do lockup para vetor antes de publicar.

Detalhamento completo em `docs/02-marca-e-layout.md`.

---

## MAPA DOS DOCUMENTOS

| Arquivo | Conteúdo |
|---|---|
| `docs/01-funil-e-fases.md` | Build do funil: métricas de nota, roteamento, página de vendas, checkout, app. Dividido em fase 1 e fase 2. |
| `docs/02-marca-e-layout.md` | Design tokens, rotas, login, catálogo de cursos, card travado, página de conversão, admin |
| `docs/03-vsl-7min.md` | Roteiro da VSL principal + versão de 90s para teste A/B |
| `docs/04-criativos.md` | 6 roteiros de criativo e estrutura de teste ABO |
| `docs/arquivo/` | Versões superadas, mantidas só como referência. **Não usar.** |

---

## ORDEM DE EXECUÇÃO

**Fase 1 — gera caixa e dado, não depende do app:**
1. Persistência da pontuação + backfill *(bloqueante — fazer primeiro)*
2. Painel de métricas de nota 1 / 2 / 3
3. Roteamento do nota 1 para a página de vendas
4. Página de vendas + checkout
5. VSL no topo da página *(depende do vídeo gravado)*
6. Instrumentação de eventos

**Fase 2 — só depois da fase 1 no ar e com conteúdo gravado:**
Login, schema `pc_*`, admin, catálogo, páginas de conversão, dashboard, esteira.

---

## ESTADO ATUAL

- **Fase 1 item 1 (persistência da pontuação) — FEITO em 07/08/2026.**
  `MIGRATION_eletroposto_qualificacao.sql` no banco *gerador-propostas*: a nota
  saiu do texto de `observacao` e virou coluna (`nota`, `pontuacao_total`,
  `tem_ponto`, `capital_faixa`, `e_decisor`, `motivo_descarte`, `utm_*`…). Um
  trigger estrutura toda ficha nova mesmo se a LP em cache for a versão velha.
  Backfill: 25 fichas recuperadas com resposta completa (11 nota 2 + 14 nota 3);
  as 83 anteriores a 01/08 ficam sem nota — inventar nota ali contaminaria a
  comparação de criativo.
- **Base do app — FEITA em 07/08/2026.** Schema `pc_*` em *solardoc-pro*, rotas
  `/plugcash/*` na API e as telas em `dashboard/src/app/(plugcash)/`:
  `/plugcash`, `/plugcash/entrar`, `/plugcash/app` (onboarding + próximo passo +
  catálogo com card travado), `/plugcash/app/curso/[slug]` (player),
  `/plugcash/curso/[slug]` (página de venda que o cadeado abre) e
  `/plugcash/admin` (CRUD de curso e aula, preço e link de checkout).
  Os 9 cursos estão semeados em **rascunho** — nenhum aparece pra ninguém.
- Página `/io/eletroposto` no ar, com régua de qualificação implementada e mais de 30
  reuniões agendadas na primeira semana de agosto de 2026
- Grupo de WhatsApp em uso para o nota 1 — **será substituído** pela página de R$ 197
- VSL de 7 minutos: roteiro pronto, **não gravada**
- Criativos: roteiros prontos, **não produzidos**. Falta b-roll de obra real
- Cursos: **nenhuma aula gravada**
- Cases: **nenhum eletroposto entregue e documentado** — os blocos de prova da VSL e dos
  criativos estão com placeholder
- Números de distribuição de nota: **desconhecidos**. É o que o item 1 da fase 1 resolve

---

## PENDÊNCIAS QUE BLOQUEIAM

1. A pontuação está sendo persistida no banco, ou só calculada em runtime? Se for o
   segundo, o histórico dos agendamentos anteriores é irrecuperável.
2. Condição com o fornecedor por escrito — preço, volume, comissão e como o pedido entra.
   É o que sustenta a promessa de rede de compra.
3. Capacidade de entrega: quantos projetos simultâneos a equipe toca sem estourar prazo.
   Esse número vira o limite da esteira e a escassez real da oferta.
4. Aprovação das duas garantias.
