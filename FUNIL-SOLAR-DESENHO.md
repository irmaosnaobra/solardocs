# Funil de energia solar, redesenho no molde do eletroposto

Rodada de desenho. Nada foi construído, nada foi commitado, nada foi para o ar.
Levantado em 16/09/2026 no código e no banco de produção (`ancecdfqfwlaujknizof`).

Janela usada em tudo: 90 dias, 18/06 a 16/09/2026. Filtro de solar:
`created_by` fora de `%eletroposto%` e de `ep-%` em `agendamentos`, e
`tipo='solar'` em `propostas`.

**Método de casamento, para quem for refazer a conta:** card e proposta são
casados pelos **8 últimos dígitos do telefone**, porque `agendamentos` guarda
`telefone_norm` sem o nono dígito e `propostas` guarda o telefone formatado à
mão. O método descarta o DDD, então em tese dois clientes de cidades diferentes
com os mesmos 8 dígitos finais casariam errado. No volume atual o risco é
pequeno, mas quem refizer com outro método vai achar número um pouco diferente
do meu. É método, não erro.

**Leia primeiro a seção 0.** Três conclusões do briefing não se sustentaram na
medição, e uma delas manda mexer justamente na regra que mais protege a agenda
hoje.

---

## 0. Onde eu discordo do briefing, com o número

O briefing pediu para conferir antes de usar e disse que onde houver conflito, o
banco manda. Conferi. Em três pontos o banco diz outra coisa.

### 0.1 O corte dos 700 kWh está certo e está funcionando

O item 5 diz que o corte "manda 4 de cada 5 leads para a fila que converte menos"
e estima R$ 35 mil de perda a cada 100 leads. A medição diz o contrário.

Conversão por faixa de consumo declarado, 408 cards de solar em 90 dias:

| Faixa | Cards | Com orçamento | Vendas | % venda | Ticket médio |
|---|---|---|---|---|---|
| Baixa (< 700 kWh) | 314 | 48,7% | 1 | **0,32%** | R$ 13.022 |
| Alta (>= 700 kWh) | 70 | 45,7% | 3 | **4,29%** | R$ 22.451 |
| Sem resposta | 24 | 58,3% | 4 | 16,67% | R$ 14.904 |

Receita esperada por card: faixa alta R$ 963, faixa baixa R$ 42. **Diferença de
23 vezes.** O lead de conta alta não é um pouco melhor, é outro negócio.

A linha "sem resposta" é armadilha. São 24 cards, e praticamente todos entraram
na mão: 10 com `created_by='Thiago'`, 3 de `indicacao`, 1 da Nilce. São
indicações e clientes conhecidos digitados no CRM, não leads de anúncio. Os
16,67% são o efeito de ser indicação, não de não ter respondido o consumo. Não
tire daí que consumo desconhecido é bom.

E o corte não só está certo como mudou o comportamento do funil. Separando os
leads do Meta antes e depois de 12/08/2026, quando a regra entrou:

| Janela | Faixa | Leads | Foram para Thiago ou Diego |
|---|---|---|---|
| Antes de 12/08 | Alta | 50 | 68,0% |
| Antes de 12/08 | Baixa | 188 | **52,7%** |
| Depois de 12/08 | Alta | 20 | **85,0%** |
| Depois de 12/08 | Baixa | 124 | **1,6%** |

Antes da regra, 99 leads de conta baixa queimaram manhã de dono. Depois, 2. O
vazamento caiu de 52,7% para 1,6% e a captura de conta alta subiu de 68% para
85%. Essa é a peça mais eficaz do funil de solar hoje.

Ressalva honesta: depois de 12/08 a faixa alta tem 0 venda em 20 leads. É pouco
lead e é recente demais para o ciclo de venda fechar. A regra provou que parou o
vazamento. Ela ainda **não** provou que aumentou venda. As 3 vendas de conta alta
são todas da janela anterior, que teve mais volume e mais tempo para maturar.

**Recomendação: não mexa no corte.** Mexa no que alimenta o corte, que é o
assunto da seção 2.

### 0.2 O roteador não está sendo furado. O que existe é um remanejamento de carteira

Eu ia reportar que a Giovanna recebeu 29 leads de conta alta, uma faixa que a
regra diz que ela nunca recebe. Fui atrás e não é isso.

A tabela `backup_acao_giovanna_20260911` guarda o dono de cada card antes da ação
de 11/09. Cruzando com o dono de hoje: **28 dos 29 cards de conta alta da
Giovanna vieram do remanejamento de 11/09**, não do roteador. O roteador entregou
certo.

O mesmo cruzamento mostra o que aconteceu com o Diego naquela ação:

| Dono antes de 11/09 | Dono hoje | Cards |
|---|---|---|
| Diego | Nilce | 77 |
| Diego | Giovanna | 41 |
| Nilce | Giovanna | 32 |
| Thiago | Giovanna | 24 |
| Thiago | Nilce | 5 |

O Diego tinha 119 cards e ficou com 1. Então "o Diego recebeu 9 leads em 90 dias"
é efeito da ação de 11/09, não do roteamento. Restaurando o dono original, a
distribuição da faixa alta foi Thiago 30, Diego 21, Nilce 18, Giovanna 1. Isso é
exatamente a proporção escrita em `FILA_CONTA_ALTA` (4 Thiago, 4 Diego, 2 Nilce).
O código está fazendo o que está escrito.

**Consequência prática: `vendedor_nome` hoje não diz quem atendeu, diz quem é o
dono depois do último remanejamento.** Qualquer leitura de desempenho por pessoa
feita em cima desse campo está contaminada. Vale para qualquer painel que você
olhe hoje.

### 0.3 Thiago fecha 7 das 8 vendas, e isso ainda não prova o que parece

Restaurando os donos, quem tem venda rastreada é o Thiago: 7 de 8. Eu quase
escrevi que o ativo escasso do solar é a atenção do Thiago.

Não escrevi porque os dados não sustentam. Das 8 vendas, pelo menos 4 chegaram
nele já mornas: 2 são `created_by='Thiago'` (digitadas por ele), 1 é `indicacao`,
1 foi criada pela Nilce e aparece com ele como vendedor. Se o card migra para o
Thiago **depois** do sinal de compra aparecer, os 13% dele são seleção, não
habilidade. E com 7 eventos, tirando os contaminados não sobra nada que sustente
conclusão.

Não dá para resolver isso com o que está gravado: `proposta_em` está zerado em
408 cards e `historico` está vazio em 148. Fica registrado como pergunta aberta,
não como achado. Item 1 da seção 10.

---

## 1. O retrato do solar hoje

### O funil inteiro, 90 dias

| Etapa | Número | Taxa |
|---|---|---|
| Leads do Meta | 436 | — |
| Viraram card | 390 | 89,4% |
| Cards de solar, todas as origens | 408 | — |
| Com orçamento (casado por telefone) | 199 | 48,8% |
| Propostas geradas | 434 | — |
| Propostas abertas pelo cliente | 167 | 38,5% |
| Propostas vendidas | 10 | 2,3% do total |
| Cards rastreados até a venda | 8 | **2,0%** |

Faturamento de 90 dias: **R$ 137.811,50**. Ticket médio R$ 13.781.

Confere com o briefing dentro do arredondamento de um dia de diferença.

### Origem dos cards, 90 dias

| Origem | Cards |
|---|---|
| `lead-meta` | 382 |
| `manychat` | 10 |
| `Thiago` (na mão) | 10 |
| `indicacao` | 3 |
| `Nilce` (na mão) | 1 |
| `lp_solar` | **1** |
| `prosp_solar` | 1 |

**93,6% da entrada vem do Meta Lead Ads.** A landing page própria do solar
produziu 1 ficha em 90 dias. Confirmado.

### O consumo que as pessoas declaram

Respostas do formulário do Meta, 90 dias:

| Resposta | Leads | Fatia |
|---|---|---|
| Até 500 kWh | 209 | 51,2% |
| 500 a 700 | 69 | 16,9% |
| 700 a 900 | 27 | 6,6% |
| 900 a 1200 | 15 | 3,7% |
| Acima de 1200 | 21 | 5,1% |
| Campo inutilizável | 41 | 10,0% |

Somando as três faixas de cima do corte: **63 leads, 18,5% de quem respondeu.**
Confere com os 19,8% do briefing.

### Volume por semana, leads do Meta

26, 35, 39, 30, 27, 17, 21, 34, 36, 32, 26, **16**.

A última semana completa (07/09) tem 16 leads contra 36 em 17/08. **Queda de
56% em quatro semanas.** A semana de 14/09 tem 4 e está incompleta. A queda é
real e não há instrumento para explicar, porque não há pixel nem UTM (seção 1.3).

### 1.1 O sinal de compra, e o erro que eu cometi aqui

> **CORREÇÃO, 17/09/2026.** A versão anterior desta seção dizia que a abertura
> da proposta "não dispara nada" e que "nenhum serviço lê esses campos". **Isso
> está errado, e o erro era meu.** O aviso existe e está no ar.
>
> `api/src/controllers/trackingGeradorController.ts:90` chama
> `notificarConsultor()` para `abertura` e `abertura_expirada`, e manda WhatsApp
> na linha `io` para o consultor dono, com debounce de 2h por proposta feito na
> RPC `pode_notificar_consultor`. Está vivo e medido: **266 propostas de solar
> já foram notificadas, 49 nos últimos 14 dias, a mais recente em 17/09 às
> 13h36 UTC**, com os quatro consultores recebendo.
>
> Por que meu `grep` não viu: procurei quem **lê** `acessos`,
> `proposta_acessos` e `ultimo_acesso`. O notificador vivo não lê nenhuma dessas
> colunas. Ele está no caminho de **escrita**: o cliente abre a página, a página
> chama `POST /gerador/track`, e o `trackEvent` avisa na mesma request. Procurar
> pelo consumidor de um dado é cego para quem age no produtor dele.
>
> **O que muda:** o item 1 da ordem de construção estava errado e foi retirado.
> Construir aquele tick teria mandado uma segunda mensagem ao consultor de 2 a
> 17 minutos depois da que ele já recebe, mais uma cópia nova para o Thiago.
>
> **O que NÃO muda:** os R$ 2.338.427,07 em propostas abertas e não vendidas
> continuam lá, e a correlação abaixo continua de pé. O que muda é o
> diagnóstico. O problema não é encanamento, é o que acontece **depois** do
> aviso: o consultor é avisado e a venda não sai. Isso é processo, não código, e
> não se conserta com mais um alerta.

O tamanho do que está parado, já filtrado por `tipo='solar'`:

- **157 propostas de solar abertas e não vendidas em 90 dias, R$ 2.338.427,07.**
- Vivo agora: 19 propostas abertas nos últimos 7 dias, **R$ 283.141**.

Conferi a contaminação: a tabela `propostas` tem também 6 de eletroposto na
janela, mas nenhuma delas tem `precoVista`, então o valor acima é solar puro. O
número não muda com o filtro, só a contagem (157 em vez de 160).

E abrir prevê compra:

| Aberturas | Propostas | Vendidas | % |
|---|---|---|---|
| 0 | 267 | 3 | 1,12% |
| 1 a 2 | 95 | 3 | 3,16% |
| 3 ou mais | 72 | 4 | **5,56%** |

Quem abre três vezes compra 5 vezes mais que quem nunca abriu.

Leia isso como triagem, não como causa. O comprador abre mais porque já está
comprando. Agir na abertura não cria a venda, **ordena a fila**. Mesmo assim é o
melhor ordenador que o solar tem hoje, e ele vale mais que o score atual, que
não ordena nada (seção 7.1). Com 10 vendas no total, não dá para prometer "N
vendas a mais". Dá para prometer que o consultor liga para a pessoa certa
primeiro.

### 1.2 A boca pergunta e o ouvido está fechado

Confirmado no código. `solarRespostas.ts:252` e `:258` filtram
`.eq('status','agendado')`. As boas-vindas saem para ficha em vários status.

**Onde exatamente cada coisa é lida**, porque o tick atravessa os dois Supabase:

| O que é lido | Cliente | Projeto | Tabela | Linha |
|---|---|---|---|---|
| Ficha tocada pelas boas-vindas | `supabaseGerador` | gerador-propostas | `agendamentos` | 249 |
| Ficha tocada pelo bom dia | `supabaseGerador` | gerador-propostas | `agendamentos` | 256 |
| Até onde já avisou | `supabase` | solardoc-pro | `system_state` | 281 |
| **A resposta do cliente** | `supabase` | solardoc-pro | **`wa_mensagens`** | 304 |

Precisão que muda onde se mexe: **a mensagem do cliente é lida sim.** A consulta
de `wa_mensagens` (linha 304) não tem filtro de status nenhum, ela traz tudo. O
que acontece é que a ficha não entrou no mapa `porChave` por causa do
`agendado`, e aí a mensagem é **descartada na memória** na linha 321
(`const f = porChave.get(k); if (!f) continue;`).

Ou seja: o ouvido escuta, o crachá é que é conferido antes e reprovado. **Não
mexa na consulta de `wa_mensagens`**, ela está certa. O conserto é nas linhas
252 e 258, trocando o `agendado` por uma lista de permissão.

Medido nos 90 dias:

- **142 pessoas receberam a mensagem de boas-vindas** que pede o consumo e a foto
  da conta.
- **32 ainda estão em `agendado`**, o único status que o leitor enxerga.
- **110 estão fora do portão, 77,5%.**

Então mais de três de cada quatro pessoas que a operação tocou podem responder
sem que ninguém receba o recado. E o momento em que a ficha sai de `agendado` é
justamente quando o consultor mexeu nela, ou seja, quando a conversa está viva.

Isso é pior que os 66,9% do briefing.

### 1.3 O funil é cego para o tráfego que paga por ele

Confirmado nos três pontos:

- `dashboard/public/simular/index.html`: **zero ocorrência** de `fbq` ou
  `facebook.net`. A página que recebe o tráfego de solar não tem Meta Pixel.
  Para comparar, `/io/solar` tem 7 e `/io` tem 5.
- `utm_source` preenchido em **0 de 408 cards**.
- Também zerados em 408 cards: `nota`, `motivo_descarte`, `lead_resposta_at`,
  `proposta_em`.

Sem pixel e sem UTM, a queda de 56% da seção 1 não tem diagnóstico possível. Não
dá para saber se caiu entrega, se caiu criativo ou se subiu custo.

### 1.4 Metade vira lixo sem registro

| Status | Cards | Fatia |
|---|---|---|
| `sem_interesse` | 208 | **51,0%** |
| `agendado` | 91 | 22,3% |
| `nao_atendeu` | 35 | 8,6% |
| `fez_orcamento` | 25 | 6,1% |
| `cancelado` | 23 | 5,6% |
| `em_atendimento` | 7 | 1,7% |
| `fechou` | 6 | 1,5% |
| `fechou_concorrente` | 6 | 1,5% |
| `perdido` | 4 | 1,0% |
| `falando_whatsapp` | 3 | 0,7% |

`motivo_descarte` preenchido: **0 de 408.** Metade do funil é descartada e não
existe uma linha dizendo por quê.

E o descarte não está todo nessa linha. A Giovanna tem 136 cards e **0% em
`sem_interesse`**. Fui conferir se era o campo abandonado e não é: olhando só os
48 cards dela que **não** vieram do remanejamento de 11/09, os status estão
sendo usados normalmente (20 `agendado`, 13 `fez_orcamento`, 7 `nao_atendeu`,
5 `em_atendimento`, 3 `cancelado`).

O que existe é outra coisa: **cada pessoa descarta num status diferente.** Ela
usa `nao_atendeu` e `cancelado` onde a Nilce usa `sem_interesse`. Então os 51%
não são o descarte real do funil, são o descarte de quem usa aquele status
específico, e **não dá para comparar descarte entre pessoas hoje**. Padronizar o
status de descarte é pré-requisito de qualquer painel por pessoa.

### 1.5 As páginas que recebem dado e jogam fora

Verifiquei uma por uma:

- **`/io`**: o `submit` monta `wa.me` com nome, tipo e cidade, e faz
  `window.location.href`. **O WhatsApp e o e-mail que a pessoa digitou são
  descartados.** Não há `fetch` de gravação. Confirmado em
  `dashboard/public/io/index.html:2790`.
- **`/irmaosnaobra`**: **zero** ocorrência de `fetch(`. Não grava nada.
- **`/simular`**: grava, em `POST /_api/gerador/form-solar`. É a única das três
  que registra. Mas entra como `manychat`, igual ao lead de DM, então não dá
  para separar no banco quem veio da página.

### 1.6 Onde está a maior perda

Em dinheiro, na ordem:

1. **Proposta aberta sem retorno: R$ 2,34 milhões parados.** O consultor é
   avisado na hora e a venda não sai (ver a correção em 1.1).
2. **110 pessoas tocadas cuja resposta não chega a ninguém.** Custo já pago, lead
   já quente, conversa morrendo sozinha.
3. **208 descartes sem motivo e sem destino.** Nenhuma lista, nenhuma oferta,
   nenhum retorno.
4. **A queda de 56% de volume que não dá para diagnosticar.**

---

## 2. Qual é o ativo escasso do solar

**É o lead com conta alta comprovada.**

Não o telhado, não a equipe de instalação, não a agenda em si.

### A evidência

- **Escassez real.** 63 de 341 leads que responderam consumo estão acima do
  corte. 18,5%. A média ponderada do formulário é 473 kWh/mês, bem abaixo do
  corte de 762 kWh.
- **Valor desproporcional.** 4,29% de venda contra 0,32%, ticket R$ 22.451
  contra R$ 13.022. Receita esperada 23 vezes maior por card.
- **A régua já reconhece isso e funciona.** Seção 0.1: o vazamento de conta baixa
  para a manhã dos donos caiu de 52,7% para 1,6% depois da regra.

A taxa de orçamento (n=199) é onde a estatística é sólida. As contagens de venda
(n=8) são direcionais. Estou apoiando a conclusão na primeira e usando a segunda
só para dizer o sentido.

### A parte que muda o desenho: hoje a conta é declarada, não comprovada

O funil inteiro decide pelo que a pessoa marcou numa faixa de formulário do Meta.
Isso é frágil de três jeitos, todos medidos:

1. **10% do campo é inutilizável.** 41 de 408 leads não têm consumo aproveitável.
2. **É faixa larga.** "Até 500" e "500 a 700" são 68% da base e não distinguem
   R$ 380 de R$ 690 de conta.
3. **É autodeclarado.** Ninguém confere.

E existe uma fonte melhor, que **já chega sozinha e é jogada fora**: a foto da
conta de luz. As boas-vindas pedem a foto. As pessoas mandam. Ninguém lê (seção
1.2).

Pior: **o leitor de conta já está construído e em produção.**
`api/src/controllers/contaScanController.ts` recebe foto ou PDF, passa por Claude
vision com tool-use forçado e devolve, entre outros campos:

- `concessionaria`
- `consumo_medio_kwh`
- `tarifa_kwh`
- `historico` de consumo dos últimos meses
- padrão de entrada e telhado

Hoje ele só é chamado pelo upload manual do dashboard.

**Então o ativo escasso é o lead de conta alta, e o instrumento para achá-lo já
existe, já recebe o insumo e está desligado do funil.** Essa é a peça central do
redesenho e é a resposta do solar para o estudo automático do eletroposto: lá o
dado vem de fonte pública porque o ativo é o ponto; aqui vem da conta que o
cliente já mandou, porque o ativo é a conta.

---

## 3. O mapa do funil novo

### Caminho A, o principal: anúncio do Meta até a venda

**Passo 1. Anúncio.** Sem mudança de mídia nesta rodada. Muda o destino: em vez
do formulário nativo do Meta, o anúncio passa a poder apontar para `/simular` com
UTM. Os dois convivem enquanto a comparação não estiver feita.

**Passo 2. `/simular`, reconstruída como quiz.** Uma pergunta por tela. Ver
seção 4 para as perguntas e a ordem.

**Passo 3. Gravação imediata, a cada passo.** Toda resposta grava, mesmo se a
pessoa abandonar. Hoje a página só grava no fim. Quem desiste no passo 4 some.

**Passo 4. Roteamento.** Pelo valor da conta, regra atual mantida
(`CONTA_CORTE_REAIS = 800`). Se a foto da conta veio, o valor lido pelo
`scanConta` manda. Se não veio, vale o declarado, como hoje.

**Passo 5A, conta alta.** Vai para a agenda dos donos. Portão de presença antes
de marcar, como no eletroposto: uma janela pergunta se a pessoa vai mesmo
participar, e só o "Sim" grava a reunião.

Texto do portão, na tela:

> **Você vai mesmo participar dessa conversa?**
> São 12 horários por semana e cada um fica reservado só para você.
> [ Sim, vou participar ]  [ Ainda não posso confirmar ]

Mensagem ao cliente quando a reunião é gravada:

```
☀️ Tudo certo, <nome>!

Sua conversa com o <consultor> ficou marcada para <dia> às <hora>.
É uma ligação de uns 20 minutos, você não precisa preparar nada.

Se puder, manda uma foto da sua conta de luz aqui antes.
Com ela eu já chego com o número certo da sua economia. 📄
```

A foto pedida aqui alimenta a ficha da seção 5. É o mesmo pedido das
boas-vindas, no momento em que a pessoa está mais disposta a atender.

**Passo 5B, conta baixa.** Vai para a fila da Nilce e da Giovanna, como hoje.
A mensagem muda de tom: não promete conversa com sócio, promete retorno.

```
☀️ Recebi seu pedido, <nome>!

Quem vai te atender é a <consultora>, ela cuida dos projetos da sua região.
Ela te liga hoje ainda.

Enquanto isso, manda uma foto da sua conta de luz aqui.
É com ela que a gente calcula quanto você economiza de verdade. 📄
```

**Passo 5C, fora de área ou imóvel alugado sem decisão.** Não some. Vai para o
Caminho B.

**Passo 6. Antes da reunião:** o consultor recebe a ficha pronta (seção 5).

**Passo 7. Proposta enviada.** Sem mudança no gerador.

**Passo 8. Proposta aberta.** Já dispara aviso no WhatsApp do dono hoje, pelo
`trackEvent`. Não precisa ser construído (ver 1.1).

### Caminho B: quem não qualifica

Hoje some. 208 cards em `sem_interesse` sem motivo e sem destino.

**Passo 1.** Vira cadastro automático com o que já respondeu, sem formulário
novo. Mesmo mecanismo do eletroposto.

**Passo 2.** `motivo_descarte` preenchido na hora, pelo caminho que o levou ali.
Sem isso não há como medir nada depois.

**Passo 3.** Cai numa página de saída com uma oferta que resolva o problema
**dele**, não o do eletroposto. O desqualificado do solar é quase sempre conta
baixa demais para pagar o sistema. A oferta natural é a que reduz a conta sem
investimento de R$ 13 mil.

**Suposição não confirmada:** qual produto de entrada existe ou deveria existir
aqui é decisão sua, não medição minha. Deixei o mecanismo desenhado e o produto
em aberto de propósito. Não copie o material de R$ 177 do eletroposto: ele
ensina a achar ponto e não serve para esse público.

**Passo 4.** Convite para seguir o Instagram na saída, como no eletroposto.

Texto da página de saída, para você riscar e reescrever:

> **Com a sua conta hoje, o sistema não se paga.**
> Seria desonesto te vender um projeto de R$ 13 mil que levaria mais de 10 anos
> para voltar. Então a gente não vai.
>
> O que dá para fazer com a sua conta é baixar ela agora, sem investir nada.
> [ Quero ver como baixar minha conta ]
>
> E quando sua conta passar de R$ 800, volta aqui. Aí o projeto vale a pena.
> [ Seguir a Irmãos na Obra no Instagram ]

Mensagem ao cliente, no mesmo momento:

```
☀️ <nome>, fui honesto com você

Com a sua conta de hoje, o sistema solar demoraria demais pra se pagar.
Não vou te empurrar um projeto que não fecha a conta.

Deixei aqui o que dá pra fazer agora: <link>
E quando sua conta passar de R$ 800, me chama. Aí muda tudo.
```

**Por que esse tom:** é a única mensagem do funil que precisa vender sem ter
produto caro para vender. Recusar a venda grande é o que compra o direito de
oferecer a pequena, e é o que faz a pessoa voltar quando a conta subir. Se a
oferta de entrada for outra, o tom continua valendo.

### Caminho C: recuperação de proposta aberta

Roda sobre o estoque atual. Não depende de redesenhar nada.

**Gatilho:** `propostas.acessos` incrementou nas últimas horas e a proposta não
está vendida.

**Destino:** WhatsApp do dono do card.

**Mensagem interna:**

```
👀 Abriu a proposta agora

Proposta 202600XXX · 3ª abertura
Cliente: <nome>
Cidade: <cidade>
Valor: R$ 22.400
Telefone: <telefone>
```

Cabeçalho próprio com emoji e segunda linha dizendo em uma frase o que chegou,
pela mesma razão do eletroposto: os avisos caem na mesma conversa e no celular a
pessoa lê o cabeçalho errado.

---

## 4. As portas da primeira pergunta

**Não faça três portas de perfil.** Concordo com o briefing e a medição apoia.
O solar B2C tem um comprador só, o dono do imóvel com conta alta. 93,6% da
entrada é a mesma origem. Três portas ali é cerimônia.

A primeira pergunta do quiz deve ser **o valor da conta de luz**, porque é a
única coisa medida que separa alguma coisa (23 vezes em receita esperada, seção
2).

### A ordem proposta

| # | Pergunta | Por quê | Condição |
|---|---|---|---|
| 1 | Quanto vem a sua conta de luz por mês? | Único separador medido. Define a rota. | Sempre |
| 2 | Manda uma foto da conta? (pode pular) | Transforma declarado em comprovado. Alimenta a ficha da seção 5. | Sempre |
| 3 | O imóvel é seu? | Só para separar quem não pode decidir sozinho. Sem peso de score. | Sempre |
| 4 | Em que cidade fica? | Distância e concessionária. Já existe `cidades_atendimento`. | Sempre |
| 5 | Como prefere investir? | Único campo de intenção que separou (57,3% contra 43,2%). | Só conta alta |
| 6 | Seu nome | — | Sempre |
| 7 | Seu WhatsApp | **Último passo, sempre.** | Sempre |

O telefone é o último passo pelo motivo do eletroposto: é o campo que mais trava
quem ainda está decidindo. No fim ele deixa de ser pedágio e vira o canal por
onde a reunião chega.

Regras de construção que vêm prontas do eletroposto e devem ser copiadas sem
discussão, porque já custaram teste:

1. Uma pergunta por tela. O público é mais velho.
2. Escolher não avança. A pessoa marca e aperta Continuar.
3. Resposta é botão grande, e o `<select>` continua no DOM com o mesmo id, só
   escrito pelos botões. Sem script a página cai no select de sempre.
4. Passo que não se aplica some sozinho (coluna Condição acima).
5. Campo opcional que só traz ruído fica fora.
6. Asset com caminho absoluto, sempre.

### A pergunta nova que vale a pena: a foto da conta

É o passo 2 e é opcional de propósito. Quem manda a foto entrega consumo real,
tarifa real, concessionária e histórico de uma vez, sem responder mais nada. É a
troca mais barata do quiz inteiro: um toque no lugar de quatro perguntas.

**Suposição não confirmada:** não sei qual fatia das pessoas vai mandar a foto
no quiz. Sei que 142 receberam o pedido por WhatsApp e que o briefing mediu 95
respondendo com consumo, áudio ou foto. Isso sugere que a disposição existe, mas
o número dentro do quiz é chute até subir e medir.

---

## 5. O que o consultor recebe antes da reunião

O equivalente solar do estudo automático de local. Não copie o estudo do
eletroposto (seção 9). Monte este.

Uma ficha, entregue por link ao consultor quando a reunião é marcada:

| Bloco | De onde sai | Existe hoje? |
|---|---|---|
| Consumo médio real e histórico mês a mês | `scanConta` sobre a foto da conta | **Sim, pronto** |
| Tarifa vigente R$/kWh | `scanConta` | **Sim, pronto** |
| Concessionária | `scanConta` | **Sim, pronto** |
| Padrão de entrada e telhado | `scanConta` | **Sim, pronto** |
| Distância até a cidade | `cidades_atendimento` | **Sim, pronto** |
| Irradiação do município (HSP) | `hspRef`, já usado na proposta | **Sim, pronto** |
| Kit provável e faixa de preço | Fórmula do gerador | **Sim, pronto** |
| Payback estimado | `payback`, já na proposta | **Sim, pronto** |
| Roteiro de perguntas | Chamada de IA sobre os campos acima | Não, é o único a construir |

**Oito dos nove blocos já existem em produção.** O trabalho não é levantar dado,
é juntar o que já está espalhado e entregar num link antes da ligação. Isso é o
que faz o consultor parar de gastar os primeiros vinte minutos levantando o que
o sistema já sabia.

**Ressalva:** a ficha completa só sai quando a foto da conta chega. Sem a foto,
os quatro primeiros blocos ficam com o declarado e a ficha sai mais fraca. Isso é
argumento para insistir na foto, não para adiar a ficha.

---

## 6. Os avisos internos e os toques ao cliente, com o relógio de cada um

### O que está no ar hoje

O briefing disse que `api/vercel.json` tem quatro crons. **Hoje tem um:**

```
{ "path": "/cron/master", "schedule": "30 11 * * *" }
```

Um cron, uma vez por dia, 11h30 UTC (08h30 BRT). Conferi que não há um segundo
arquivo carregando os outros três: dos 7 `vercel.json` do disco, só o da `api/`
tem bloco `crons`, e o do `dashboard/` não tem nenhum. Isso torna a conclusão mais
forte, não mais fraca: **o solar não tem nenhum toque em relógio confiável.**

Onde os ticks de solar realmente rodam:

| Tick | Rota | Disparo | Relógio real |
|---|---|---|---|
| `solar-boas-vindas` | `/cron/process-messages` | `process-messages.yml`, `*/5 * * * *` | **2 a 5 horas** |
| `solar-respostas` | `/cron/process-messages` | idem | **2 a 5 horas** |
| `solar-giovanna` (bom dia 7h e "oi" 5 min antes) | `/cron/process-messages` | idem | **2 a 5 horas** |
| os mesmos três | `/cron/master` | `cron.yml`, `0 * * * *` | 1 hora |
| os mesmos três | `/cron/master` | Vercel, `30 11 * * *` | 1 vez por dia |
| `lembretes-agenda` | `/cron/master` | — | **no-op, kill-switch** |
| `agenda-proxima` | própria | `0 12,19,23 * * *` | 3 vezes ao dia |

O aviso de "5 minutos antes" está pendurado num relógio cuja melhor resolução é
1 hora e cuja pior é 5 horas. **Isso é no-show fabricado por infraestrutura**,
exatamente como no eletroposto.

### Os toques ao cliente estão mortos desde 28/07, e é pior que 44%

`lembretesAgenda.ts:39` tem `AVISOS_CLIENTE_ATIVOS = false` escrito no código
desde 28/07/2026. Religar exige deploy.

Medi antes e depois dessa data, porque a janela de 90 dias atravessa ela:

| | Cards | Confirmação | Lembrete 1h | Lembrete 5min | Bom dia |
|---|---|---|---|---|---|
| Antes de 28/07 | 205 | 156 (76%) | 122 (60%) | 87 (42%) | 30 |
| **Depois de 28/07** | 203 | **3 (1,5%)** | **2 (1,0%)** | 27 (13%) | 35 |

**Desde 28/07 praticamente nenhum cliente de solar recebeu confirmação nem
lembrete de 1 hora: 3 e 2 em 203 cards.** Não é uma régua com 44% de furo, é uma
régua desligada.

Atenção a uma mistura na tabela acima, que eu quase reportei errado: as colunas
vêm de **dois módulos diferentes**. Confirmação e lembrete de 1 hora são do
`lembretesAgenda`, que está desligado. O lembrete de 5 minutos e o bom dia que
ainda aparecem depois de 28/07 vêm do `solarAgendaGiovanna`, que é outro módulo,
tem chave própria e **só roda na carteira da Giovanna e da Nilce**. Por isso
27 e 35 continuam pingando enquanto os outros dois zeraram.

Consequência: quem está na carteira de conta alta, que é o ativo escasso, é
justamente quem **não** recebe toque nenhum hoje.

As boas-vindas são o terceiro módulo e o único saudável: 142 disparos, todos
depois de 28/07. Ele fala. Quem não escuta é o leitor de respostas (seção 1.2).

### A armadilha que precisa ser respeitada

**Não mova `/cron/process-messages` inteiro para a Vercel.** Esse lote carrega os
robôs de prospecção, cujo orçamento é calibrado por tique. Rodar 36 vezes mais
ali é bloqueio de linha de WhatsApp.

O que fazer: **extrair o tick de solar para uma rota própria** (por exemplo
`/cron/solar-toques`) e pôr **só ela** na Vercel. Os ticks já têm rota individual
exposta (`/cron/solar-boas-vindas`, `/cron/solar-respostas`,
`/cron/solar-giovanna`), então o trabalho é pequeno.

### A segunda armadilha: a tabela é compartilhada

`agendamentos` atende solar **e** eletroposto, separados só por um `like` no
`created_by`. Já documentado em `lembretesAgenda.ts:33-38`: o lead #584 respondeu
"não solicitei nenhum serviço de energia solar" em 28/07 porque a copy é escrita
em cima de solar.

**Toda régua nova precisa filtrar por produto antes de mandar a primeira
mensagem.** E não religue a régua completa de toques de uma vez: ligue um toque,
confira no ar, ligue o próximo.

### Os toques propostos, com relógio

| Toque | Quando | Relógio | Para quem |
|---|---|---|---|
| Confirmação ao marcar | na hora | evento | cliente |
| Bom dia no dia | 07h | cron Vercel | cliente |
| Lembrete de 1 hora | T-1h | **cron Vercel** | cliente |
| Lembrete de 5 minutos | T-5min | **cron Vercel** | cliente |
| Proposta aberta | na hora | cron Vercel, 15 em 15 min | **consultor** |
| Resposta do cliente chegou | na hora | cron Vercel | **consultor** |
| Cadastro novo | na hora | evento | Thiago e Diego |

### Formato do aviso interno

Cabeçalho próprio com emoji por tipo e uma segunda linha dizendo em uma frase o
que chegou. Cada campo com emoji próprio, para achar telefone e cidade sem ler
tudo. Emoji é liberado aqui porque é mensagem de WhatsApp, não interface.

```
☀️ Lead novo de solar, conta alta
Conta de R$ 1.240, acima do corte, entrou na sua fila

👤 <nome>
📍 <cidade>
📱 <telefone>
⚡ 1.180 kWh/mês · CEMIG · R$ 1,05/kWh
📄 Ficha: <link>
```

---

## 7. O que vai ser cortado, com a medição

Esta é a parte que gera resistência, então vem com número.

### 7.1 Corte o score de temperatura como critério de prioridade

Ele não ordena nada, e em duas das cinco entradas ele está **invertido**.

Medição por campo, taxa de orçamento, leads do Meta em 90 dias:

**Urgência** (o código dá +3 para "7 dias" e 0 para "Pesquisando"):

| Resposta | n | % orçamento |
|---|---|---|
| Pesquisando | 93 | **49,5%** |
| 30 dias | 46 | 45,7% |
| 7 dias | 14 | 42,9% |

Quem diz que está pesquisando converte **mais** que quem diz que quer para 7
dias. O score premia exatamente ao contrário.

**Imóvel** (o código dá -3 para "Alugado", a punição mais forte da régua):

| Resposta | n | % orçamento |
|---|---|---|
| Construindo | 4 | 100% |
| Alugado | 10 | **50,0%** |
| Próprio | 139 | 46,0% |

Alugado converte mais que próprio. A punição mais pesada da régua está no campo
que não pune nada. O n de alugado é pequeno (10), então o certo é **remover o
peso**, não inverter.

**Padrão de entrada:**

| Resposta | n | % orçamento |
|---|---|---|
| Não sei | 10 | 50,0% |
| Tri | 8 | 50,0% |
| Bi | 116 | 47,4% |
| Mono | 19 | 47,4% |

Completamente plano. **É o mesmo caso da entrada trifásica do eletroposto**, que
foi cortada porque 63% respondiam "Sim" e quem respondia "Não sei" convertia
mais. Aqui "Não sei" também está no topo. A pergunta não muda a régua nem a
proposta. **Corte do quiz.** Ela volta de graça pelo `scanConta`.

**O único campo que separa é Pagamento:**

| Resposta | n | % orçamento |
|---|---|---|
| Financiamento | 75 | **57,3%** |
| Cartão de crédito | 59 | 54,2% |
| À vista | 100 | 44,0% |
| Pesquisando | 148 | 43,2% |

14 pontos de diferença entre o topo e a base. **Mantenha, e note que o código
hoje dá +3 para "À vista" tratando como pagamento definido, mas "À vista"
converte abaixo de financiamento.** Quem financia é quem compra.

**Quem decide** é fraco e direcionalmente certo: Decisor 49,6% (n=254), Decide
Junto 45,1% (n=122), Não decide 33,3% (n=6). O n do lado que discrimina é 6.
Mantenha a pergunta, não confie no peso.

### E tem um detalhe que invalida qualquer leitura da coluna `temperatura`

Fui ver quem escreve essa coluna. **O score calculado e a coluna gravada são
duas coisas diferentes.**

- `medirTemperatura()` é chamado em `leadsMetaService.ts:462` e o resultado vai
  para o **texto da notificação de WhatsApp** do consultor, para ele bater o olho.
  Não é o que define prioridade de ninguém.
- A **coluna** `temperatura` é escrita pelas páginas (`ioSolar.ts:261`,
  `ioEletroposto.ts:462`, que só sabem gravar `quente` ou `morno`) e por
  `ioIndicacoes.ts:130`, que grava `quente` fixo. **Nenhum desses caminhos grava
  `frio`.**

Mesmo assim existem 96 cards com `frio` no banco. Ou seja, `frio` entra por fora
do código, provavelmente na mão pelo CRM ou por um caminho antigo. Uma coluna
preenchida em parte por página e em parte por gente, depois do card ser
trabalhado, não serve para prever nada: ela é consequência, não causa.

Por isso **não estou usando a tabela de baldes para sustentar o corte.** Os
números dela (vazia 274 cards, frio 96, morno 25, quente 13) divergem dos do
briefing, e é esperado que divirjam. O que sustenta o corte é a medição por
campo acima, que tem n grande, sai do que o lead respondeu no formulário e não
depende dessa coluna.

O que fica registrado da coluna é só isto: está vazia em **67,2%** dos cards e
não é escrita por um caminho único. Não use para ordenar fila.

**O que substitui o score:** a abertura da proposta (1,12% / 3,16% / 5,56%,
seção 1.1) e o valor da conta (seção 2). Os dois são medidos e os dois separam.

### 7.2 Corte as três perguntas que não separam

Padrão de entrada, Telhado e "Vai aumentar o consumo" saem do quiz. Padrão e
telhado voltam pelo `scanConta` sem custar um toque ao cliente.

### 7.3 Corte as páginas que recebem dado e jogam fora

`/io` e `/irmaosnaobra` (seção 1.5). Ou passam a gravar, ou param de pedir
telefone e e-mail. Pedir dado e descartar é o pior dos dois mundos: custa atrito
ao visitante e não entrega nada.

`/irmaosnaobra` ainda é órfã, nenhum link aponta para ela.

### 7.4 Não corte: o corte dos 700 kWh

Ver seção 0.1. É a peça que mais protege a manhã dos donos hoje.

---

## 8. A ordem de construção

Ordenada por resultado por hora de trabalho. O que já existe está marcado.

### ~~1. Aviso de proposta aberta~~ — RETIRADO EM 17/09

**Este item estava errado e não vai ser construído.** O aviso já existe e está
no ar (`trackingGeradorController.ts:90`), medido em 49 propostas nos últimos
14 dias. Ver a correção na seção 1.1. Construir o tick teria criado um segundo
aviso sobre o mesmo clique.

**O que sobra de verdadeiro:** R$ 2,34 milhões abertos e não vendidos, com o
consultor JÁ avisado. A pergunta certa deixou de ser "como avisar" e passou a
ser **"por que o aviso não vira ligação"**. Isso precisa de uma medição nova
que eu ainda não fiz: quantas das 49 notificadas tiveram contato depois.

### 2. Abrir o portão do leitor de respostas

**Retorno:** 110 de 142 pessoas tocadas hoje estão fora do portão.
**Já existe:** `solarRespostas.ts` inteiro.
**Falta:** trocar `.eq('status','agendado')` por uma lista de permissão nas duas
linhas (`:252` e `:258`). É a menor mudança de código do documento inteiro.

### 3. Pixel e UTM na `/simular`

**Retorno:** destrava o diagnóstico da queda de 56% e liga o Meta de volta.
**Já existe:** `/io/solar` e `/io` já têm pixel, é copiar o bloco. As colunas
`utm_*` já existem em `agendamentos`.
**Falta:** o bloco na página, a propagação até o `POST`, e separar `lp_solar` de
`manychat` na gravação.

### 4. Tirar os toques do relógio do GitHub

**Retorno:** acaba o no-show fabricado. Desde 28/07, 3 de 203 cards receberam
confirmação e 2 receberam o lembrete de 1 hora. Quem está na carteira de conta
alta não recebe toque nenhum.
**Já existe:** os três ticks já têm rota individual.
**Falta:** uma rota agregadora só de solar, entrada em `api/vercel.json`, e
religar `AVISOS_CLIENTE_ATIVOS` com filtro de produto.
**Cuidado:** não mover `/cron/process-messages` inteiro.

### 5. `scanConta` ligado na foto que já chega

**Retorno:** transforma conta declarada em conta comprovada, que é o ativo
escasso. Melhora o roteamento e alimenta a ficha do item 7.
**Já existe:** `contaScanController.ts` inteiro, em produção.
**Falta:** pegar a foto de `wa_mensagens` e chamar o scan. Atenção: o Gerador tem
dois Supabase, e quem lê resposta busca no outro projeto e não escreve de volta.
É por isso que `lead_resposta_at` está zerado.

### 6. Caminho B, o destino de quem não qualifica

**Retorno:** 208 cards por trimestre que hoje somem.
**Já existe:** o mecanismo do eletroposto, para copiar.
**Falta:** `motivo_descarte` sendo preenchido, a lista própria e a oferta. A
oferta é decisão sua.

### 7. Ficha do consultor antes da reunião

**Retorno:** os primeiros vinte minutos de cada reunião.
**Já existe:** 8 dos 9 blocos (seção 5).
**Falta:** juntar e servir num link, e o roteiro por IA.

### 8. `/simular` reconstruída como quiz

**Retorno:** real, mas só medível depois do item 3. Sem pixel e sem UTM não dá
para saber se o quiz novo é melhor que a página atual.
**Falta:** tudo. É o maior item do documento.

**Faça o 3 antes do 8.** Reconstruir a página antes de ter instrumento é
trabalhar às cegas e discutir resultado por opinião depois.

### 9. Lista diária para o vendedor

Ver seção 9.4. Só depois de existir um score que preveja alguma coisa.

---

## 9. O que do eletroposto NÃO faz sentido copiar

### 9.1 O estudo automático do local

Lá o ativo escasso é o ponto, e dá para avaliar um ponto de longe com dado
público (IBGE, SENATRAN, Places, Street View). No solar o ativo é a conta de quem
já levantou a mão, e o próprio código registra que a visita técnica foi abolida.

O equivalente útil aqui é outro e está na seção 5: concessionária, tarifa
vigente, irradiação e histórico real de consumo, tirados da conta que o cliente
manda, não de base pública.

### 9.2 As três portas de perfil na primeira tela

O eletroposto tem três compradores com três destinos. O solar B2C tem um: o dono
do imóvel com conta alta. 93,6% da entrada é a mesma origem e a mesma pessoa.
Três portas é cerimônia sem benefício.

### 9.3 O top 20 do dia e a pré-nota no card

Ranquear pressupõe um score que separa. O do solar não separa, e em duas entradas
está invertido (seção 7.1). Ranquear com esse score colocaria o lead errado no
topo todo dia, com aparência de método.

**Primeiro o score precisa prever alguma coisa.** Quando previr, a lista diária
vale. O candidato pronto para virar score é a abertura de proposta, que já
separa 5 vezes.

### 9.4 O produto de entrada, do jeito que está lá

**Copie o mecanismo**, que é capturar o desqualificado numa lista própria com uma
oferta. **Não copie o produto.** O material do eletroposto ensina a achar ponto.
O desqualificado do solar tem conta baixa demais para pagar o sistema, que é
outro problema.

### 9.5 A régua completa de toques ligada de uma vez

Pelo motivo da tabela compartilhada (seção 6). Já produziu um cliente respondendo
"não solicitei nenhum serviço de energia solar". Ligue um toque, confira no ar,
ligue o próximo.

---

## 10. Suposições que eu não consegui confirmar

Marcadas para você corrigir. É melhor corrigir uma suposição declarada do que
descobrir depois que o desenho se apoiava num palpite.

1. **Se o Thiago converte mais por habilidade ou por seleção.** 7 das 8 vendas
   são dele, mas pelo menos 4 chegaram já mornas. Com `proposta_em` zerado e
   `historico` vazio em 148 cards, não dá para saber se o card migra para ele
   antes ou depois do sinal de compra. **Isso muda o desenho:** se for seleção, o
   caminho é distribuir melhor; se for habilidade, o caminho é botar o Thiago só
   na conta alta. Você sabe a resposta, eu não.

2. **Qual produto de entrada oferecer a quem não qualifica.** Desenhei o
   mecanismo e deixei o produto em aberto. É decisão de oferta, não de medição.

3. **Que fatia vai mandar a foto da conta no quiz.** 142 receberam o pedido por
   WhatsApp e o briefing mediu 95 respondendo com consumo, áudio ou foto. Dentro
   do quiz é chute até subir e medir.

4. **Por que o volume caiu 56% em quatro semanas.** Sem pixel e sem UTM não há
   diagnóstico. Pode ser entrega, criativo, custo ou orçamento. O item 3 da
   seção 8 é o que destrava essa pergunta.

5. **Se o Diego está fora do solar por decisão ou por efeito da ação de 11/09.**
   Ele tinha 119 cards e ficou com 1. Se for decisão, `FILA_CONTA_ALTA` precisa
   ser reescrita, senão 40% da conta alta continua indo para uma fila parada.
   **Este é o mais urgente dos cinco**, porque afeta o ativo escasso hoje.

6. **Quem grava `frio` na coluna `temperatura`.** Nenhum caminho do código que
   eu achei grava esse valor, e mesmo assim existem 96 cards com ele (seção
   7.1). Ou é a mão no CRM, ou é um caminho antigo que eu não localizei. Não
   muda o desenho, porque a coluna sai de uso de qualquer jeito, mas se alguém
   citar um número de temperatura numa decisão, vale saber disso antes.

7. **Se a queda de volume é da fonte ou da conta.** 92% da entrada depende do
   Meta Lead Ads. Um token expirado, uma conta em revisão ou um criativo
   reprovado dão o mesmo sintoma que "o anúncio piorou", e hoje não dá para
   distinguir. Isso é risco de parada total, não só de queda.

---

## Resumo em cinco linhas

1. O corte dos 700 kWh está certo e funcionando. Não mexa nele. O vazamento de
   conta baixa para a manhã dos donos caiu de 52,7% para 1,6% depois da regra.
2. O ativo escasso é o lead de conta alta, e o instrumento para comprová-lo
   (`scanConta`) já existe, já recebe a foto e está desligado do funil.
3. R$ 2,34 milhões em propostas abertas e não vendidas. O consultor JÁ é avisado
   de cada abertura (corrigido em 17/09): o furo não é o aviso, é o que vem
   depois dele.
4. 110 de 142 pessoas tocadas podem responder sem que o recado chegue a ninguém,
   e desde 28/07 quem é de conta alta não recebe toque nenhum.
5. Construa o instrumento (pixel, UTM) antes de reconstruir a página, senão não
   dá para saber se melhorou.
