# PROMPT PARA CLAUDE CODE — PROJETO ELETROPOSTO

> Cole este arquivo inteiro no Claude Code. Ele está dividido em duas fases.
> **Execute a FASE 1 completa antes de tocar na FASE 2.** A fase 1 gera caixa e dado;
> a fase 2 depende de conteúdo que ainda está sendo produzido.

---

## CONTEXTO DO PROJETO

Página atual: `solardoc.app/io/eletroposto` (Irmãos na Obra — Mobilidade Elétrica).
CRM atual: `solardoc.app/gerador`.
Stack: Next.js + Supabase + Vercel.

A página já está no ar e converte. Ela tem simulador de retorno, faixa de investimento
e um formulário de agendamento com régua de qualificação de 0 a 11 pontos, que classifica
o lead em nota 1 (0–4), nota 2 (5–8) e nota 3 (9–11).

Hoje o nota 1 é removido da agenda e convidado para um grupo de WhatsApp.
**Isso vai ser substituído por uma página de vendas de um produto de R$ 197.**

Regras de trabalho:
- **Antes de escrever qualquer código, leia o código existente** da página, do formulário
  e do CRM. Reutilize o design system, as cores (#0B2003), a tipografia e os componentes
  que já existem. Não introduza biblioteca nova sem necessidade.
- Não altere as premissas de cálculo do simulador.
- Não invente valores. Todo preço está declarado neste documento.
- Ao final de cada bloco, liste o que foi alterado e o que precisa de confirmação humana.

---

# FASE 1 — MÉTRICAS, ROTEAMENTO E PÁGINA DE VENDAS

## 1.1 · Persistência da pontuação (BLOQUEANTE — faça primeiro)

Verifique se a tabela de leads persiste os campos abaixo. Se a pontuação estiver sendo
calculada apenas em runtime e descartada, **isso é o problema mais urgente do projeto.**

Campos obrigatórios por lead:
- `pontuacao_total` (int, 0–11)
- `nota` (int, 1 | 2 | 3)
- `tem_ponto` (enum: sim | nao_mas_arrendo | nao)
- `capital_faixa` (enum, conforme opções atuais do formulário)
- `e_decisor` (bool)
- `perfil` / `fluxo_estimado`
- `motivo_descarte` (array de text — quais critérios zeraram; só para nota 1)
- `utm_source`, `utm_campaign`, `utm_content`, `utm_medium`
- `created_at`

Se faltarem colunas: crie a migration e **faça backfill recalculando a pontuação
a partir das respostas já salvas**. Sem histórico não há comparação de criativo.

Se as respostas antigas também não foram salvas, informe explicitamente que o
histórico anterior é irrecuperável e que a contagem começa do zero a partir de agora.

## 1.2 · Painel de métricas

Nova rota: `/gerador/eletroposto/metricas` (protegida pelo mesmo auth do CRM).

**Cards no topo:**
- Total de leads no período
- Nota 3 — quantidade e % do total
- Nota 2 — quantidade e % do total
- Nota 1 — quantidade e % do total
- Taxa de qualificação = (nota 2 + nota 3) / total

**Filtro de período:** hoje · 7 dias · 30 dias · tudo · range customizado.

**Tabela por dia:** data | total | nota 1 | nota 2 | nota 3 | % qualificação

**Quebra do descarte:** para os nota 1, gráfico de barras por `motivo_descarte`
(sem ponto · sem capital · não é decisor · fluxo baixo). Um lead pode contar em mais de um.

**Quebra por criativo:** mesma tabela agrupada por `utm_content`, com custo por lead
nota ≥ 5 se houver campo de custo; se não houver, deixe a coluna preparada e vazia.

**Funil do nota 1:** viu a tela de desqualificação → clicou no CTA → chegou no checkout
→ comprou. Instrumente os eventos que ainda não existirem.

**Export CSV** com todos os campos, respeitando período e filtro de nota.

## 1.3 · VSL no topo da página pública

Na `/io/eletroposto`, inserir o player da VSL acima da dobra.

- Vídeo **liberado**: controles visíveis, o usuário pode pular, pausar e buscar.
- Autoplay mudo com botão de som, se o navegador permitir.
- **O botão de agendar continua visível na primeira dobra, ao lado ou logo abaixo do
  player.** Não esconda o CTA atrás do vídeo — quem já decidiu não pode ser penalizado.
- Repetir o CTA logo após o player.
- Instrumentar marcos de visualização: 25%, 50%, 75%, 100%, e salvar o percentual
  máximo assistido no lead quando ele enviar o formulário (campo `vsl_watch_pct`).
  Esse cruzamento entre tempo assistido e nota final é o dado que vai decidir se no
  futuro vale travar a VSL.

## 1.4 · Roteamento do nota 1

No envio do formulário, manter a régua atual. Alterar apenas o destino do nota 1:

| Nota | Destino |
|---|---|
| 9–11 | Confirma horário normalmente |
| 5–8 | Confirma horário, com a reunião marcada como foco em definir o ponto |
| 0–4 | **Não exibe horário.** Redireciona para `/io/eletroposto/material` |

Passar o `motivo_descarte` para a página de destino (querystring assinada ou sessão —
não exponha a pontuação bruta na URL).

**Guardrail crítico:** a oferta de R$ 197 não pode aparecer em nenhum lugar da página
principal, nem antes do envio do formulário, nem para nota 2 ou 3. Ela existe
exclusivamente após a desqualificação. Se vazar, troca-se venda de R$ 160 mil por R$ 197.

Remover o CTA que apontava para o grupo de WhatsApp.

## 1.5 · Página de vendas `/io/eletroposto/material`

Página de vendas do produto de entrada. **Preço: R$ 197.**

**Personalização por motivo do descarte** — o bloco de abertura muda conforme o
`motivo_descarte` recebido. Quatro variações do headline e do primeiro parágrafo:

- **sem_ponto** — "Você respondeu que ainda não tem o ponto definido."
- **sem_capital** — "Você respondeu que o capital ainda não está disponível."
- **nao_decisor** — "Você respondeu que a decisão não é só sua."
- **perfil_tecnico** — "Pelo seu perfil, você não quer investir — quer executar."

O restante da página é comum às quatro. O texto final de cada variação será entregue
separadamente; por ora use placeholders claramente marcados como `[COPY_SEM_PONTO]` etc.

**Estrutura da página:**
1. Headline personalizado + reconhecimento do que ele acabou de responder
2. Vídeo curto (3 a 4 min) — placeholder de player, o vídeo ainda será gravado
3. O que ele leva (lista de entregas)
4. Preço: R$ 197 · parcelamento
5. Garantia de 7 dias, devolução integral, ele fica com o material
6. Um único order bump: planilha de viabilidade e payback — **R$ 47**
7. CTA de checkout

Sem contador regressivo falso, sem estoque fictício. O público é o mesmo que assistiu
7 minutos de conteúdo técnico; artifício derruba a credibilidade da marca principal.

## 1.6 · Checkout e conta

- Checkout do produto de R$ 197 + bump opcional de R$ 47.
- Use o gateway já utilizado nos outros produtos (verifique no código qual é).
- **Após a compra aprovada, criar automaticamente a conta do comprador no app**
  (ver Fase 2) e enviar e-mail com o acesso. Se o app ainda não existir, gravar o
  registro na tabela de compradores e enfileirar o provisionamento.
- Disparar evento de conversão para o pixel e para a CAPI, com deduplicação por
  `event_id`, no mesmo padrão já usado nos outros projetos.

## 1.7 · Eventos a instrumentar

`vsl_play` · `vsl_25` · `vsl_50` · `vsl_75` · `vsl_100` · `form_start` ·
`form_submit` · `lead_nota1` · `lead_nota2` · `lead_nota3` · `agendamento_confirmado` ·
`desqualificacao_view` · `material_view` · `checkout_start` · `purchase_197` · `bump_47`

---

# FASE 2 — APLICATIVO

> **Só comece depois que a Fase 1 estiver no ar e o conteúdo do produto estiver gravado.**
> Construir o app antes de existir conteúdo é o caminho mais rápido para atrasar o projeto.

## 2.1 · Base

Área logada. Autenticação via Supabase Auth. Provisionamento automático a partir da
compra da Fase 1.

**Níveis de acesso:**

| Nível | Origem | Preço |
|---|---|---|
| Base | Compra de R$ 197 | R$ 197 (vitalício) |
| Integrador | Compra direta ou upgrade | R$ 997 de credenciamento + R$ 97/mês |
| Investidor | Venda consultiva | A definir |
| Projeto | Cliente turnkey fechado | Sob escopo |

Modelo de permissão por nível, com conteúdo e ofertas visíveis conforme o nível.

## 2.2 · Onboarding

Primeira pergunta ao entrar: **"o que você quer fazer com eletroposto?"**
Opções: entender o mercado · executar para terceiros · investir no meu próprio ·
tenho um ponto e quero monetizar.

A resposta define a trilha carregada e as ofertas priorizadas na esteira. Combine com
o `motivo_descarte` que veio do formulário original.

## 2.3 · Conteúdo

Trilha única, comum a todos, com módulos liberados conforme o nível:
como o mercado funciona · avaliação de ponto · carga disponível e padrão de entrada ·
projeto e aprovação na distribuidora · escolha de equipamento · custos e retorno ·
operação e precificação.

Player de vídeo, material em PDF para download, marcação de progresso por aula.

## 2.4 · Esteira interna (o motor do modelo)

Catálogo de produtos e serviços comprável dentro do app, **priorizado pelo motivo do
descarte e pela resposta do onboarding**:

| Motivo | Oferta priorizada |
|---|---|
| Sem ponto | Programa Ponto Zero — mapear, avaliar e arrendar |
| Sem capital | Trilha de financiamento, sociedade e captação |
| Não é decisor | Dossiê de viabilidade pronto para apresentar ao sócio |
| Perfil técnico | Credenciamento Integrador + acesso à rede de fornecedores |

**Serviços avulsos do catálogo** (preços a definir, deixe configuráveis via painel admin,
nunca hardcoded):
análise de viabilidade de ponto · levantamento de carga disponível · projeto elétrico
executivo · entrada e acompanhamento na distribuidora · revisão de projeto reprovado ·
ART e responsabilidade técnica · especificação de equipamento · cotação pela rede de
fornecedores · sessão de engenharia sob demanda · comissionamento assistido.

**Regras de exibição:**
- Cada oferta aparece **no fim da aula correspondente à dor que ela resolve**, com preço
  na tela. Menu de "serviços" não é suficiente — ninguém abre menu.
- Preço público e fixo. Nada de "solicite um orçamento" dentro do autoatendimento.
- Cada serviço tem **capacidade máxima mensal configurável**. Ao atingir o limite, o item
  aparece como indisponível com lista de espera. Isso não é escassez de marketing — é
  proteção operacional real.

## 2.5 · Upgrade e retorno para a agenda

- Botão de upgrade de nível sempre visível, mostrando o que está bloqueado.
- **Quando o usuário resolve o motivo do descarte** (marca que já tem ponto, que o capital
  foi viabilizado, ou que o sócio aprovou), o app oferece o retorno para o agendamento
  com a nota recalculada. Esse é o ciclo que transforma lead fraco em cliente.
- Painel admin deve listar quem virou elegível para reagendamento.

## 2.6 · Painel admin

Assinantes por nível · receita recorrente · churn mensal · consumo de conteúdo ·
vendas por item da esteira · capacidade usada por serviço · leads elegíveis para retorno.

---

# ORDEM DE EXECUÇÃO

1. `1.1` persistência e backfill — **bloqueante, faça hoje**
2. `1.2` painel de métricas
3. `1.4` roteamento do nota 1
4. `1.5` + `1.6` página de vendas e checkout
5. `1.3` VSL no topo (depende do vídeo gravado)
6. `1.7` eventos
7. Fase 2 completa, só depois

Ao terminar cada item, pare e reporte. Não encadeie os sete de uma vez.
