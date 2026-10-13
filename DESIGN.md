---
name: Gerador Irmãos na Obra
description: Ferramenta interna de vendas, clara e direta, com casca marinho, amarelo de obra e a trena como assinatura.
colors:
  io-navy-950: "#061A38"
  io-navy-900: "#0A2450"
  io-navy-800: "#123A72"
  io-tinta: "#0B2447"
  io-azul: "#1D4ED8"
  io-azul-sf: "#E8EFFD"
  io-azul-h: "#1740B5"
  io-amarelo: "#FFC220"
  io-amarelo-forte: "#E5A900"
  io-amarelo-sf: "#FFF3C7"
  n-bg: "#F2F4F8"
  n-sf: "#FFFFFF"
  n-sf2: "#F7F9FC"
  n-sf3: "#EEF2F7"
  n-bd: "#DDE3EC"
  n-bd2: "#B9C4D4"
  io-borda-campo: "#7D8CA3"
  n-tx: "#0F1B2D"
  n-tx2: "#44546A"
  n-tx3: "#5B6C83"
  n-inv: "#FFFFFF"
  n-inv2: "#B9C7DE"
  io-ok: "#147B3B"
  io-ok-sf: "#E7F6EC"
  io-er: "#B91C1C"
  io-er-sf: "#FDECEC"
  io-er-h: "#991B1B"
  io-av: "#AD5009"
  io-av-sf: "#FFF1DC"
  io-wa: "#0B7A43"
  io-wa-h: "#095F34"
  io-ok-inv: "#7BE0A0"
  s-solar: "#B4610F"
  s-eletro: "#1D4ED8"
typography:
  display:
    fontFamily: "'Inter IO2', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.01em"
    fontFeature: "'tnum'"
  headline:
    fontFamily: "'Inter IO2', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "22px"
    letterSpacing: "normal"
  title:
    fontFamily: "'Inter IO2', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "'Inter IO2', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'Inter IO2', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  caption:
    fontFamily: "'Inter IO2', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "normal"
rounded:
  trena: "4px"
  interno: "8px"
  controle: "10px"
  cartao: "12px"
  modal: "16px"
  pilula: "999px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
components:
  button-primary:
    backgroundColor: "{colors.io-amarelo}"
    textColor: "{colors.io-tinta}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.io-amarelo-forte}"
    textColor: "{colors.io-tinta}"
  button-secondary:
    backgroundColor: "{colors.n-sf}"
    textColor: "{colors.n-tx}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.n-sf3}"
    textColor: "{colors.n-tx}"
  button-forte:
    backgroundColor: "{colors.io-azul}"
    textColor: "{colors.n-inv}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "40px"
  button-forte-hover:
    backgroundColor: "{colors.io-azul-h}"
    textColor: "{colors.n-inv}"
  button-perigo:
    backgroundColor: "{colors.io-er}"
    textColor: "{colors.n-inv}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "40px"
  button-perigo-hover:
    backgroundColor: "{colors.io-er-h}"
    textColor: "{colors.n-inv}"
  button-whatsapp:
    backgroundColor: "{colors.io-wa}"
    textColor: "{colors.n-inv}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "40px"
  button-whatsapp-hover:
    backgroundColor: "{colors.io-wa-h}"
    textColor: "{colors.n-inv}"
  field:
    backgroundColor: "{colors.n-sf}"
    textColor: "{colors.n-tx}"
    rounded: "{rounded.controle}"
    padding: "8px 12px"
    height: "40px"
  field-disabled:
    backgroundColor: "{colors.n-sf3}"
    textColor: "{colors.n-tx3}"
  card:
    backgroundColor: "{colors.n-sf}"
    textColor: "{colors.n-tx}"
    rounded: "{rounded.cartao}"
    padding: "24px"
  card-invertido:
    backgroundColor: "{colors.io-navy-900}"
    textColor: "{colors.n-inv}"
    rounded: "{rounded.cartao}"
    padding: "20px"
  ficha-numero:
    backgroundColor: "{colors.n-sf}"
    textColor: "{colors.io-tinta}"
    rounded: "{rounded.cartao}"
    padding: "12px 14px"
  chip:
    backgroundColor: "{colors.n-sf}"
    textColor: "{colors.n-tx2}"
    rounded: "{rounded.pilula}"
    padding: "6px 14px"
    height: "36px"
  chip-ativo:
    backgroundColor: "{colors.io-tinta}"
    textColor: "{colors.n-inv}"
  etiqueta:
    backgroundColor: "{colors.n-sf3}"
    textColor: "{colors.n-tx2}"
    rounded: "{rounded.pilula}"
    padding: "2px 8px"
  aba:
    textColor: "{colors.n-tx2}"
    padding: "10px 16px"
    height: "44px"
  aba-ativa:
    textColor: "{colors.io-tinta}"
  nav-item:
    textColor: "{colors.n-inv2}"
    rounded: "{rounded.controle}"
    padding: "10px 12px"
    height: "44px"
  nav-item-ativo:
    backgroundColor: "{colors.io-amarelo}"
    textColor: "{colors.io-tinta}"
  toast:
    backgroundColor: "{colors.io-navy-900}"
    textColor: "{colors.n-inv}"
    rounded: "{rounded.pilula}"
    padding: "12px 20px"
---

# Design System: Gerador Irmãos na Obra

Este documento registra o visual novo do `/gerador` como ele foi construído em `dashboard/public/gerador/ui/`. Ele vale só para as telas internas com a classe `html.io2` ligada. Os títulos de seção ficam em inglês porque são o contrato de leitura do formato. Os nomes das chaves de cor do cabeçalho são os nomes dos tokens do código sem os dois hifens (`io-amarelo` é `--io-amarelo`).

## Overview

**Creative North Star: "A Ferramenta de Obra"**

O Gerador é a bancada do consultor de venda: clara, direta e igual em toda tela. A casca marinho segura a navegação, a área de trabalho é clara para ser lida no escritório e no celular sob sol, e o amarelo de obra aparece só onde a pessoa está e no que ela deve fazer em seguida. A única licença expressiva é a trena: toda medida de progresso é desenhada como fita amarela com marcas de 10%.

A densidade é de produto, não de vitrine. Uma família de letra, números tabulares, cartões brancos de borda fina com sombra quase imperceptível e controles com altura fixa. O celular é uso de primeira classe: navegação inferior alcançável com o polegar, campos de 16 px e alvos de 44 px. A reforma tirou do caminho o painel escuro de vidro com degradê e a pilha de cartões iguais de ícone, título e texto, e o código hoje desfaz ativamente os restos dele (desfoque, degradê de cabeçalho, rótulo em maiúscula, cartão dentro de cartão).

**Key Characteristics:**
- Casca única em toda tela: trilho lateral marinho, barra superior, faixa de abas e, no celular, navegação inferior.
- Amarelo sempre cheio, com texto em tinta. Azul para link, foco e dado.
- Cor só quando é estado. Cor de série só em gráfico e legenda.
- Uma família (Inter, servida de casa), pesos de 400 a 700, piso de 12 px.
- A trena como única assinatura.
- Tudo atrás da chave `html.io2`, dentro de `@media screen`, sem tocar em papel nem em documento de cliente.

## Colors

Marinho e amarelo tirados do logo, sobre neutros frios puxados do marinho. O amarelo é raro e sempre cheio.

### Primary
- **Marinho da casca** (`io-navy-900`): trilho lateral, barra superior no celular, navegação inferior, folha "Mais", cartão invertido, toast.
- **Marinho fundo** (`io-navy-950`): moldura da grade da Agenda e base dos véus de modal (`rgba(6, 26, 56, .55)`).
- **Marinho claro** (`io-navy-800`): hover de filtro ativo.
- **Tinta** (`io-tinta`): todo texto sobre amarelo, título de tela, título de cartão, número de ficha e filtro selecionado (preenchimento com texto branco).
- **Amarelo de obra** (`io-amarelo`): item ativo da navegação, botão principal, sublinhado de 3 px da aba ativa, contador da aba ativa e a fita da trena. Hover e pressionado em `io-amarelo-forte`. Fundo suave `io-amarelo-sf` no quadrinho do ícone do indicador.

### Secondary
- **Azul de ação** (`io-azul`): link, anel de foco, botão forte, cursor de texto, `accent-color` e dado em gráfico. Hover do botão forte em `io-azul-h`. Fundo de seleção e de informação em `io-azul-sf`.

### Tertiary
- **Estado**: certo `io-ok` sobre `io-ok-sf`, erro `io-er` sobre `io-er-sf`, aviso `io-av` sobre `io-av-sf`. Informação (`--io-info`) aponta para o azul de ação. Sobre marinho, o verde de estado é `io-ok-inv`. Hover do botão de perigo em `io-er-h`.
- **WhatsApp** (`io-wa`, hover `io-wa-h`): só em botão e link de WhatsApp, com texto branco.
- **Séries**: solar `s-solar` e eletroposto `s-eletro` (mesmo valor do azul de ação, com token próprio). Entram em linha de gráfico, legenda, ponto do filtro de produto e ponto do produto na agenda do Início.

### Neutral
- **Área de trabalho** (`n-bg`), **cartão** (`n-sf`), **faixa interna e cabeçalho de tabela** (`n-sf2`), **hover e controle preenchido** (`n-sf3`).
- **Borda fina** (`n-bd`) em cartão e divisor. **Borda de controle** (`n-bd2`) em botão secundário e chip. **Contorno de campo** (`io-borda-campo`, 3,41:1 sobre branco) em todo `input`, `select` e `textarea`, na busca de telas e na lista dela.
- **Texto** (`n-tx`), **secundário** (`n-tx2`), **apagado** (`n-tx3`, ainda acima de 4,5:1 sobre branco).
- **Texto sobre marinho**: `n-inv` e `n-inv2`.

### Named Rules
**Regra do Amarelo Cheio.** Amarelo é sempre preenchimento com texto `io-tinta`, ou barra de 3 px ou mais. Nunca texto nem linha fina sobre fundo claro. Sobre marinho ele pode ser texto de link (cartão invertido, desfazer do toast) e anel de foco.

**Regra de Onde Estou.** Amarelo marca lugar e ação principal: item ativo da navegação, aba ativa, o botão principal do bloco. Seleção de filtro não é lugar: chip e segmento ativos são `io-tinta` com texto branco.

**Regra da Cor de Estado.** Número, selo e fundo só ganham verde, vermelho ou âmbar quando dizem um estado. Indicador com valor zero perde a cor e fica neutro (`data-io2-zero`, posto por `ui/io2-telas.js`).

**Regra da Cor de Série.** Laranja de solar e azul de eletroposto diferenciam produto em gráfico e legenda. Não são cor de marca nem de estado e não pintam botão, selo ou título.

**Regra do Dado do Dono.** Cor de status que vem do dado (selo e botões de status do CRM, quente, morno e frio, etiquetas de origem, cartões da Agenda) não é remapeada para token. Só ganha ajuste de texto quando reprova contraste.

## Typography

**Display Font:** Inter variável (com `system-ui`, `-apple-system`, `Segoe UI`, Roboto, sans-serif)
**Body Font:** a mesma
**Label/Mono Font:** não há

**Character:** Uma família só, servida de `ui/fontes/inter-variavel.woff2` com o nome `Inter IO2` para não redefinir a `Inter` do visual antigo. A hierarquia vem de tamanho e peso, nunca de caixa alta nem de espaçamento entre letras.

### Hierarchy
- **Display** (700, 32 px, 1.05, tabular): número do indicador do Início e do cartão invertido da calculadora. No celular 28 px. Valor em dinheiro desce para 26 e 22 px para caber numa linha.
- **Número de ficha** (700, 22 a 24 px, tabular): fichas do CRM (22), Histórico (22, 18 no celular), Quem ligar (24), painel de resultado do Simulador (22) e etapas do cartão invertido (24).
- **Headline** (700, 18 px, 22 px): título da tela na barra superior (16 px no celular), título de modal (600), título do período no Início.
- **Title** (600, 16 px, 1.35): título de cartão e de seção, em `io-tinta`. No Início o título de cartão é 700 em `n-tx`.
- **Body** (400, 14 px, 1.5): texto corrido e célula de tabela. Controle usa 14 px com peso 500 (campo) ou 600 (botão, aba). 15 px aparece só no nome da marca do trilho e no botão principal grande.
- **Label** (500, 13 px, 1.35): rótulo de campo acima do campo, chip, rótulo de ficha, aba de segundo nível. Cor `n-tx2`.
- **Caption** (500, 12 px, 1.3): legenda, contexto da barra superior, cabeçalho de tabela (600), etiqueta (600), texto da navegação inferior.

### Named Rules
**Regra do Piso de 12.** Nenhum texto de tela abaixo de 12 px. As folhas sobem para 12 px todo tamanho menor herdado do app antigo, inclusive os escritos em `style=`.

**Regra da Caixa Normal.** Rótulo, cabeçalho de tabela e etiqueta ficam em caixa normal, com `letter-spacing: 0`. A camada de componentes desfaz o `text-transform: uppercase` do app antigo nas telas do `index.html`. Nos subapps a limpeza ainda é parcial: no computador sobram rótulos em caixa alta com espaçamento em Prospecção e Agentes.

**Regra do Número Tabular.** Todo número que compara ou soma usa `font-variant-numeric: tabular-nums`: indicador, ficha, tabela, campo numérico e de telefone.

**Regra dos Quatro Pesos.** 400, 500, 600 e 700. Os pesos 800 e 900 do app antigo não existem na camada nova.

## Layout

A casca é montada por `ui/casca.js` e desenhada em `ui/io2.css`. O `body` é que recua, porque as telas são filhas diretas dele. Nada é embrulhado em wrapper.

**Computador (861 px ou mais).** Trilho lateral fixo de 240 px (`--sb-w`) com 9 destinos e, no rodapé, Atualizar e Sair. Barra superior branca de 56 px (`--top-h`) com título, linha de contexto, busca de telas e usuário. Abaixo dela, a faixa de abas da seção. O conteúdo começa a 24 px da barra e das laterais.

**Celular (até 860 px).** O trilho some. Barra superior marinho de 52 px (`--top-h-m`) mais a zona segura. Navegação inferior fixa de 64 px (`--bot-h`) mais a zona segura, com Início, Solar, Eletroposto, CRM e Mais. "Mais" abre uma folha marinho vinda de baixo com os outros destinos e a busca. Conteúdo em coluna única com 12 px de margem lateral, no app e nos subapps, e o primeiro conteúdo 12 px abaixo da barra.

**Ponto de troca.** Um só para a casca: 860 px. Quebras secundárias de conteúdo: 640 px (tabelas viram linhas de duas faixas, fichas em 2 colunas), 861 a 1279 px (cartões em 2 colunas, indicadores em 2 por linha), 1280 px (Início em grade de 12 colunas com `subgrid`), 1400 px (filtros dos cadastros numa linha), 1440 px (5 ou 6 indicadores numa fileira).

**Medida.** Espaço em múltiplos de 4: 4, 8, 12, 16, 20, 24 e 32 px. Convivem com a grade os valores 2, 6, 10 e 14 px em recheio de controle, chip, etiqueta e ficha. Altura de controle 40 px no computador (`--ctl-h`) e 44 px no celular (`--ctl-h-m`). Botão principal grande de formulário com 48 px. Chip de filtro com 36 px no computador e 44 px no celular. Alvo de toque mínimo de 44 px no celular.

**Camadas.** A casca ocupa de 880 a 950, o detalhe do CRM 955. Acima ficam sempre as sobreposições do app (960, 1000, 1200, 9000) e o toast (9999). Nada da casca passa de 955.

**Início.** Segue a composição de referência do dono: fileira de indicadores, grade de cartões brancos e um cartão invertido em marinho, com largura máxima de 1320 px e vão de 16 px (12 px no celular). A ação principal fica em amarelo no alto à direita.

**Simulador no celular.** Os três números principais ficam numa faixa fixa branca logo acima da navegação inferior enquanto o consultor preenche, todos em tinta. O `body` ganha o recuo de baixo para o fim da página e o foco não ficarem por baixo dela.

**Tabela e quadro.** No celular a página nunca rola de lado: o contêiner da tabela e o quadro do CRM rolam dentro de si, com colunas do quadro em 88% da largura e encaixe.

### Named Rules
**Regra da Casca Única.** Toda tela, inclusive os subapps, mostra o mesmo trilho, a mesma barra superior e a mesma navegação inferior. Cabeçalho próprio de tela, botão "Voltar" e botão flutuante são escondidos por CSS, nunca removidos do DOM.

**Regra da Parede Recolhida.** Bloco longo de explicação acima de uma ferramenta nasce fechado atrás de um botão "Como funciona" de 44 px. O bloco nunca sai do DOM.

## Elevation & Depth

Sistema quase plano. A profundidade vem de borda fina de 1 px mais uma sombra de duas camadas muito leve, e de troca de tom entre `n-bg`, `n-sf` e `n-sf2`. Sem vidro e sem desfoque: a camada nova zera `backdrop-filter` em tudo que herdou do app antigo.

### Shadow Vocabulary
- **Repouso** (`box-shadow: 0 1px 2px rgba(10, 36, 80, .06), 0 4px 12px rgba(10, 36, 80, .05)`): cartão, token `--sombra`.
- **Hover de indicador** (`0 1px 2px rgba(10, 36, 80, .08), 0 6px 16px rgba(29, 78, 216, .10)`): junto com a borda azul.
- **Flutuante** (`0 8px 24px rgba(10, 36, 80, .14)`): lista da busca de telas.
- **Cartão invertido** (`0 6px 18px rgba(6, 26, 56, .28)`): o cartão marinho do Início.
- **Modal** (`0 16px 48px rgba(10, 36, 80, .28)`): caixa de modal e detalhe do CRM.
- **Toast** (`0 8px 24px rgba(6, 26, 56, .35)`).
- **Faixa fixa** (`0 -4px 12px rgba(10, 36, 80, .10)`): faixa do Simulador e barra de ação da Prospecção no celular.

### Named Rules
**Regra da Borda Antes da Sombra.** Todo cartão tem borda `n-bd`. A sombra é reforço, nunca a única separação. Ficha de número e faixa interna não têm sombra.

**Regra do Cartão Único.** Cartão dentro de cartão vira faixa neutra: fundo `n-sf2`, sem borda e sem sombra, raio 10 px.

## Shapes

Cantos arredondados contidos, com três raios nomeados: cartão 12 px (`--r-cartao`), controle 10 px (`--r-controle`) e pílula 999 px (`--r-pilula`). Dois raios de apoio: 8 px para peça pequena dentro de controle (aba, opção de lista, ação miúda, esqueleto) e 16 px para modal e folha inferior (20 px na folha "Mais"). A trena usa 4 a 6 px. Borda sempre de 1 px. O logo é selo em imagem (`dashboard/public/gerador/logo.png`) sobre quadrinho branco de raio 10 px no trilho.

Ícone é sempre traço único em caixa de 24, pontas arredondadas, cor por `currentColor`, pintado por máscara. Espessura 1,75 na casca e no conjunto de 53 desenhos de `ui/io2-icones.css`. Chevron usa 2. Tamanhos: 20 px no trilho, 22 px na navegação inferior e na folha, 18 px na busca, `1em` dentro de texto.

## Components

Controles firmes e sem enfeite: mesma altura, mesmo raio e mesmo foco em toda tela. A camada de componentes (`ui/io2-componentes.css`) não cria classes novas: ela dá um desenho só às famílias de classe que o app já tinha.

### Buttons
- **Shape:** raio de controle (10 px), altura mínima de 40 px (44 px no celular), recheio de 8 por 16 px, texto 14 px peso 600.
- **Primary:** amarelo cheio com texto em tinta e borda da mesma cor. Um por bloco. Em formulário de documento a versão grande tem 48 px, 15 px e raio 12 px.
- **Secondary:** branco com borda `n-bd2` e texto `n-tx`. Hover em `n-sf3`.
- **Forte:** azul de ação com texto branco. Para a ação de ligar e de editar.
- **Perigo:** vermelho de erro com texto branco.
- **WhatsApp:** verde `io-wa` com texto branco. Só para abrir conversa.
- **Hover / Focus:** transição de 150 ms em fundo, borda e cor. Pressionado desce 1 px. Foco com anel de 2 px `io-azul` e 2 px de afastamento. Desabilitado em `n-sf3` com texto `n-tx3`, sem opacidade. Carregando esconde o texto e gira um anel de 16 px.

### Chips
- **Style:** pílula branca com borda `n-bd2`, texto `n-tx2` de 13 px peso 500, 36 px de altura (44 px e 14 px no celular).
- **State:** selecionado em `io-tinta` com texto branco e peso 600. Hover em `n-sf3`.
- **Controle segmentado (Início):** trilho `n-sf3` de raio 10 px com 4 px de recheio. Opção ativa em `io-tinta` com texto branco e raio 8 px.
- **Etiqueta:** pílula de 12 px peso 600, recheio de 2 por 8 px. Neutra em `n-sf3`. De estado, com o par cor e fundo suave.

### Cards / Containers
- **Corner Style:** 12 px.
- **Background:** `n-sf` sobre a área de trabalho `n-bg`.
- **Shadow Strategy:** sombra de repouso mais borda fina (ver Elevation).
- **Border:** 1 px `n-bd`.
- **Internal Padding:** 24 px (16 px no celular). Cartão do Início com 20 px.
- **Estado no cartão:** aparece pela pílula de estado. Linha de lista que não tem elemento de estado usa a borda inteira de 1 px na cor de estado. Nunca faixa colorida grossa em um lado só.
- **Título:** 16 px peso 600 em `io-tinta`, sem sublinhado nem marcador.
- **Cartão invertido:** fundo `io-navy-900`, texto `n-inv` e `n-inv2`, link em amarelo, foco em amarelo. No máximo um por tela, para o resumo que ancora o olhar. Existe no Início (obras) e na calculadora (preço sugerido).
- **Estado vazio:** faixa `n-sf2` com borda tracejada `n-bd2`, ícone de 40 px e texto `n-tx2`. **Erro:** texto `io-er` sobre `io-er-sf` com borda, sempre com saída. **Carregando:** esqueleto em `n-sf3`.

### Inputs / Fields
- **Style:** fundo branco, borda de 1 px `io-borda-campo`, raio 10 px, altura mínima de 40 px, texto 14 px peso 500. Rótulo de 13 px peso 500 em `n-tx2` acima do campo. Select com seta de traço própria.
- **Focus:** borda `io-azul` mais anel de 2 px `io-azul` com 2 px de afastamento.
- **Error / Disabled:** erro com borda `io-er` (e anel vermelho no foco). Desabilitado em `n-sf3`. Somente leitura em `n-sf2` com borda tracejada.
- **Celular:** 44 px de altura e texto de 16 px, para o navegador não dar zoom ao focar. Caixa de marcar com 24 px.

### Navigation
- **Trilho lateral:** itens de 44 px, ícone de 20 px e texto de 14 px peso 500 em `n-inv2`. Hover com véu branco de 8%. Ativo em pílula amarela com texto tinta peso 600. Foco com anel amarelo (branco quando o item já é amarelo).
- **Barra superior:** título de 18 px peso 700 em `io-tinta` e linha de contexto de 12 px. No celular, fundo marinho e texto invertido.
- **Busca de telas:** pílula de 40 px na barra superior, com os atalhos `/` e Ctrl+K. A lista abre abaixo em cartão flutuante, com opções de 44 px. A opção selecionada tem fundo `n-sf3`, texto tinta e peso 600. No celular ela mora dentro da folha "Mais", com campo de 48 px e 16 px.
- **Faixa de abas:** linha de base de 1 px `n-bd`. Aba de 44 px, 14 px peso 600 em `n-tx2`. Ativa em `io-tinta` peso 700 com sublinhado amarelo de 3 px. Rola de lado quando não cabe. Segundo nível com 40 px e 13 px (44 px no celular). Contador em pílula neutra, amarelo na aba ativa.
- **Navegação inferior:** cinco destinos, ícone de 22 px dentro de pílula de 56 por 28 px, texto de 12 px. Ativo com a pílula amarela e ícone tinta.
- **Folha "Mais":** marinho, raio 20 px em cima, itens de 52 px e 16 px, ativo em amarelo. Sobe em 200 ms.

### Tabela
- Cabeçalho em `n-sf2` com texto de 12 px peso 600 em `n-tx2`. Célula de 14 px com 10 por 12 px de recheio e divisor `n-bd`. Hover de linha em `n-sf3`. Coluna de número alinhada à direita e tabular. A tabela densa dos Cadastros no computador desce para 13 px, com select na largura do conteúdo.

### Modal e toast
- **Modal:** véu marinho a 55%, caixa branca de raio 16 px e 24 px de recheio, ações à direita separadas por linha. No celular vira folha inferior com botões empilhados na largura toda.
- **Toast:** pílula marinho com texto invertido, que não intercepta toque e fica acima da navegação inferior no celular.

### A trena (assinatura)
Toda barra de progresso, de teto e de funil é desenhada como fita de obra: trilho `n-sf3`, fita `io-amarelo` e marcas de 1 px em tinta a cada 10%, com uma opacidade só (`--io-trena-marca`, 0,5) e 8 a 12 px de altura.
- **Onde entra:** barras de progresso da Automação, dos Avisos e das Redes. No Início, a barra do funil (desenhada em SVG por `ui/io2-telas.js`), o avanço por consultor na tabela do time e a proporção de obras concluídas no cartão invertido. Nos subapps, o teto diário da Prospecção e o teto dos Agentes.
- **Estado na fita:** nos tetos, a fita troca o amarelo por `io-av` e `io-er` quando o limite se aproxima ou estoura.
- **Onde não entra:** gráfico de linha e de barra (Histórico e Início usam azul, tinta e cor de série), esqueleto de carregamento, indicador de carregando, divisor e qualquer enfeite.

### Ficha de número
Ficha dentro de tela (CRM, Quem ligar, Histórico): caixa de raio 12 px com borda `n-bd` e sem sombra, número em `io-tinta` peso 700 tabular em cima e rótulo de 13 px peso 500 em `n-tx2` embaixo, em caixa normal e centrado. Cor no número só quando é estado, e zero fica neutro.
- **Painel de resultado do Simulador:** não é ficha de número. Rótulo e valor ficam na ordem de leitura (rótulo em cima), sobre faixa `n-sf2`. Custo e lucro em tinta. Só o VPL, que o app pinta pelo sinal, usa cor de estado. A faixa fixa do celular segue a mesma regra.
- **Indicador do Início:** peça própria. Cartão com sombra, quadrinho de 44 px em `io-amarelo-sf` com ícone tinta, número de 32 px, rótulo de 13 px peso 600 e uma linha de explicação em `n-tx3`. Hover com borda azul.

### Movimento
Só de estado. Transição de 150 ms `ease` em cor, fundo e borda. Folha inferior sobe 24 px em 200 ms com `cubic-bezier(.16, 1, .3, 1)` e o véu aparece em 200 ms. Esqueleto pulsa em 1,4 s. Todo `@keyframes` começa por `io2-`. Com `prefers-reduced-motion: reduce`, animações e transições caem para 0,01 ms, o esqueleto fica parado e só o indicador de carregando continua.

### Acessibilidade
- Foco visível por teclado em todo interativo: anel de 2 px `io-azul` com 2 px de afastamento. Sobre marinho o anel é amarelo. Dentro da faixa de abas o anel é por dentro.
- Texto com 4,5:1 ou mais. `n-tx3` é o tom mais claro permitido para texto sobre branco.
- Zoom liberado: `ui/chave.js` troca a `meta viewport` para `width=device-width, initial-scale=1, viewport-fit=cover` quando o visual novo liga.
- Campo com 16 px e alvo de 44 px no celular. Zonas seguras por `env(safe-area-inset-*)`.
- Remendos em tempo de execução, sempre marcados com `data-io2-*` para poderem ser desfeitos: rótulo solto ligado ao campo, `inputmode="decimal"` em campo numérico, teclado em uma lista fechada de clicáveis, nome acessível em botão que só tem símbolo.

## Do's and Don'ts

### Do:
- **Faça** a cor entrar por token (`--io-*`, `--n-*`, `--s-*` de `ui/io2.css`). Tela nova ou alterada tem que funcionar nos dois visuais enquanto a chave `html.io2` existir.
- **Faça** toda regra do visual novo sob `html.io2` e dentro de `@media screen`. O prefixo com `:not(#_)` repetido é o que vence o CSS antigo: 2 na casca e nas folhas de cor, 3 em componentes e telas, 5 no acabamento.
- **Faça** o amarelo cheio com texto `io-tinta`, uma ação principal por bloco.
- **Faça** controle com 40 px no computador e 44 px no celular, campo com 16 px no celular.
- **Faça** ícone de traço com `currentColor`. Emoji em texto de tela é trocado por `ui/io2-icones.js` a partir de uma lista fechada, e nunca em mensagem, histórico, campo ou documento.
- **Faça** número com `tabular-nums` e rótulo em caixa normal.
- **Faça** a trena para toda medida de progresso, teto e funil.
- **Faça** as folhas geradas pela fonte: `ui/io2-componentes.css` vem de `dashboard/scripts/gerador-io2-componentes.src.css`, `ui/io2-acabamento.css` vem de `dashboard/scripts/gerador-io2-acabamento.src.css` e as `ui/io2-cores-*.css` vêm de `dashboard/scripts/gerador-io2-cores.mjs` com as exceções em `gerador-io2-cores.regras.json`. Edite a fonte e regenere.
- **Faça** o bump do `vNN` em `dashboard/public/gerador/sw.js` em todo commit que toca `ui/*`. O service worker entrega esses arquivos do cache primeiro.
- **Faça** esconder por CSS o que a casca substitui. Nenhum id, função de navegação, parâmetro de URL ou deep link muda.

### Don't:
- **Não** escreva cor à mão pensando em fundo escuro. Vira texto claro sobre branco, sem erro nenhum.
- **Não** trate as folhas `ui/io2-cores-*.css` como sistema. Elas são ponte: mapeiam as cores do tema escuro antigo para o claro e somem quando o app antigo sumir.
- **Não** toque nos cartões nem na grade da Agenda. Fundo, texto, borda, sombra e opacidade deles são regra do dono e ficam fora do sistema. A grade é uma ilha escura de propósito, reaplicada valor por valor em `ui/io2-agenda.css`. Só a moldura em volta segue os tokens.
- **Não** leve este sistema para o que vira papel ou PDF nem para os documentos de cliente (`proposta.html`, `premium-deck.*`, `apresentacao.html`, as seções de proposta e de orçamento dentro do `index.html`). Eles têm desenho próprio e a marca NEXUS não é tocada.
- **Não** use amarelo como texto ou linha fina sobre fundo claro.
- **Não** use cor de série fora de gráfico e legenda, nem cor de estado como enfeite.
- **Não** use vidro, desfoque, degradê decorativo em superfície ou em texto, nem cartão dentro de cartão. Degradê existe só como técnica: as marcas da trena e o brilho do esqueleto.
- **Não** use texto abaixo de 12 px, pesos 800 e 900, nem rótulo em caixa alta com espaçamento aberto entre letras. O único ajuste de espaçamento do sistema é o aperto de -0,01em no número grande do indicador.
- **Não** use a trena como enfeite, divisor ou gráfico.
- **Não** ligue o visual novo por parâmetro de URL. A chave é `localStorage['gerador-visual']`, lida por `ui/chave.js`, e o padrão ainda é o visual antigo.
