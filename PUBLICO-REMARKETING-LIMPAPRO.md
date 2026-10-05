# Público de remarketing do LimpaPro — criativo "R$47 / 5 módulos"

Conta: **Ekent - Pré Paga** (`545732112868250`) — é onde as 3 CBOs do LimpaPro rodam hoje.
Levantado em 07/08/2026.

---

## Resposta curta

**Quem viu 50% ou mais dos vídeos do LimpaPro nos últimos 90 dias, menos quem já comprou.**

Pool estimado: **8 a 10 mil pessoas** (12.377 visualizações de 50% em 90 dias, descontando
repetição). Dá pra rodar sozinho, sem misturar com público frio.

---

## O que NÃO dá pra usar (e por quê)

| Público | Situação |
|---|---|
| Visitantes do site 180d | **20** = vazio. O pixel não pegou o tráfego |
| Iniciou checkout 180d | **20** = vazio |
| Compradores 180d (pixel) | **20** = vazio |
| PAGEVIEW / vistantes de site | **20** = vazio |
| Abandono de carrinho | 12 e-mails que nunca compraram. A Meta pede ~100 casados pra ativar |

Todos os públicos de site do LimpaPro estão no piso de 20 da Meta, ou seja, **não existem**.
Isso bate com o que já se sabia: o pixel enxergava só uma fração das visitas — a verdade do
funil está no Supabase, não no pixel.

**Consequência prática:** "quase comprou" não é alcançável pela Meta. Quem clicou no checkout
está gravado como sessão no banco, sem e-mail nem telefone. O substituto honesto para
"quase comprou" é **profundidade de vídeo** — quem assistiu metade ou mais.

---

## Como montar (Gerenciador de Anúncios)

### 1. Criar o público

Públicos → Criar → Público personalizado → **Vídeo**

- Envolvimento: **Pessoas que assistiram a pelo menos 50% do seu vídeo**
- Ele pergunta a **Página / conta do Instagram** antes de mostrar os vídeos. Escolher a
  mesma que os anúncios do LimpaPro usam — se a lista vier vazia, é porque a Página está errada
- Escolher vídeos → marcar os 25 da tabela abaixo
- Reter por: **90 dias**
- Nome: `LimpaPro — Viu 50%+ dos vídeos (90d)`

### 2. Os 25 vídeos do LimpaPro

O seletor mostra **título e miniatura**, não ID. O atalho é a busca dele:

1. Buscar **"Só Hoje"** → marcar os 20 vídeos com data abaixo
2. Buscar **"⭐"** → marcar só os 5 das datas abaixo (outros produtos também usam estrela
   no título, conferir a data antes de marcar)

| Título no seletor | Subido em | ID |
|---|---|---|
| ⭐⭐⭐⭐⭐ 4.9/5 | 15/06 | 2431535490682939 |
| ⭐⭐⭐⭐⭐ 4.87/5 | 15/06 | 992567167034987 |
| ⭐⭐⭐⭐⭐ (4.85/5) | 23/06 | 1020162703830227 |
| ⭐⭐⭐⭐⭐ 4.9/5 | 25/06 | 992055780278238 |
| ⭐⭐⭐⭐⭐ (5/5) | 06/08 | 891389556963627 |
| Só Hoje por R$47 | 04/07 | 1040693758369302 |
| Só Hoje por R$47 | 04/07 | 995996966660784 |
| Só Hoje Por R$47,00 | 09/07 | 1701610124406094 |
| Só Hoje Por R$47,00 | 09/07 | 1577261230415433 |
| Só Hoje Por R$47,00 | 09/07 | 27648447201441198 |
| Só Hoje por R$47 | 11/07 | 3100068880182682 |
| Só Hoje por R$47 | 11/07 | 2618988841880425 |
| Só Hoje por R$47 | 15/07 | 3282090118792148 |
| Só Hoje por R$47 | 15/07 | 4555365931364790 |
| Só Hoje por R$47 | 22/07 | 1575150140793882 |
| Só Hoje por R$47 | 22/07 | 906082845329740 |
| Só Hoje por R$47 | 23/07 | 1544265643862102 |
| Só Hoje por R$47 | 23/07 | 1040436611898778 |
| Só Hoje por R$47 | 23/07 | 2067471207307285 |
| Só Hoje por R$47 | 23/07 | 1049958260824704 |
| Só Hoje por R$47 | 23/07 | 1055593693606321 |
| Só Hoje por R$47 | 25/07 | 1520853146457554 |
| Só Hoje por R$47 | 31/07 | 2608592812952100 |
| Só Hoje por R$47 | 31/07 | 1347811564127302 |
| Só Hoje por R$47 | 01/08 | 1017367581305476 |

Vários dividem título e data (cinco no dia 23/07). Não tem problema: **todos os 25 são
LimpaPro**, é só marcar todos os que aparecerem nessas datas com esses títulos.

Esses são **só** os vídeos das campanhas LimpaPro. Não usar "todos os vídeos da página":
a página mistura solar, eletroposto e Irmãos na Obra, e o público vira lixo.

### 3. O conjunto de anúncios

- **Incluir:** `LimpaPro — Viu 50%+ dos vídeos (90d)`
- **Excluir:** `LimpaPro — Compradores do banco (com valor)` (id `120255581083900602`)
  — já está em dia, só 1 comprador entrou depois que ela foi criada. A Meta casa uns 70 a 90
  dos 113 e-mails, então um ou outro comprador ainda pode ver o anúncio — é normal, não é bug
- **Sem interesse, sem idade, sem geo estreito.** O público já é a segmentação
- Objetivo: Vendas / otimizar por Compra
- Orçamento: **R$ 20 a 25 por dia**. Mais que isso satura 10 mil pessoas em poucos dias e
  a frequência estoura

### 4. Se a entrega ficar travada

Adicionar no mesmo conjunto o público **`Instagram em 30D`** (4.000–4.700 pessoas) — é a
única forma de alcançar quem viu os criativos de **imagem** (`limpaproimg*`), que não geram
público de vídeo. Aviso: esse público mistura gente que interagiu com conteúdo de solar e
eletroposto, então só entra se faltar entrega.

---

## Antes de subir: 3 problemas no criativo

**1. R$ 47 com os 3 bônus — isso não existe.** Na página, R$ 47 é o básico e os 3 bônus
(Scripts de WhatsApp, Tabela de Precificação, Certificado) são do **R$ 97**. Foi exatamente
o erro corrigido em 07/08. Esse público é o que mais leu a página — é quem vai notar.
→ Trocar o preço para R$ 97 **ou** tirar a faixa de bônus.

**2. "+ DE 2.000 ALUNOS".** O banco tem **113 membros**.

**3. "7 DIAS DE GARANTIA".** A página anuncia 15 dias desde 07/08.

---

## Checar antes de ligar

A conta é pré-paga e foi ela que secou em julho por teto de gastos, matando a oferta em
silêncio. Conferir saldo e limite de gastos antes de subir.
