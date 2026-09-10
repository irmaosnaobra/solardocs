# Worker de Prospecção

Dois programas. Zero dependência — não roda `npm install`, não baixa navegador.
Node 22+ (você tem 24).

---

## 1. Subir o Chrome dedicado

Feche o Chrome normal. Abra um separado, só pra automação:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.chrome-prospeccao"
```

**Nessa janela**, faça login no WhatsApp Web (ou no Instagram). Uma vez só — a
sessão fica salva nesse perfil e sobrevive a reinício.

Perfil separado resolve três coisas de uma vez: o worker nunca vê suas abas, seu
Chrome de sempre continua livre, e o Chrome 136+ recusa porta de debug no perfil
padrão de qualquer jeito.

Confira que subiu:

```powershell
curl http://127.0.0.1:9222/json/version
```

> A porta 9222 dá controle total sobre a sessão logada nesse perfil. Mantenha em
> `127.0.0.1`, nunca `0.0.0.0`, e não rode em máquina compartilhada.

---

## 2. Ensaio primeiro. Sempre.

```powershell
cd $env:USERPROFILE\Desktop\CLAUDE\worker-prospeccao
node worker.mjs --dry
```

Percorre a fila inteira e imprime a mensagem exata que sairia pra cada empresa —
**sem tocar em ninguém**. É aqui que você lê 10 mensagens e decide se a abertura
está boa antes de mandar pra 200 pessoas.

Fora da janela de horário ele para e avisa. Pra ensaiar de madrugada:

```powershell
$env:HORA_INI=0; $env:HORA_FIM=24; node worker.mjs --dry
```

## 3. Enviar de verdade

```powershell
$env:CONSULTOR="Thiago"
node worker.mjs --canal=whatsapp
```

O `--canal=instagram` existe e funciona, mas veja a seção do @ abaixo.

## 4. Responder quem respondeu

```powershell
node worker.mjs --dry --modo=responder      # lê as conversas, mostra a resposta, não manda
node worker.mjs --modo=responder            # responde de verdade
```

Percorre quem está esperando retorno, lê a conversa direto do WhatsApp Web e,
**só se a última mensagem for do lead**, manda pra IA decidir. Conversa onde nós
falamos por último não custa nada — ela nem chama a IA.

A IA devolve: a intenção, o desfecho pro CRM, as bolhas a mandar, se é hora do
link e se precisa de humano. O worker digita bolha por bolha, com pausa entre
elas, e grava o toque.

### O que ela nunca faz

| Situação | O que acontece |
|---|---|
| Pediu pra parar | resposta curta pedindo desculpa, **contato bloqueado**, sem link |
| Pergunta que as alegações não cobrem | diz que vai confirmar e **escala pra humano** |
| Pedem garantia de venda ou devolução | recusa prometer, escala, repete só o que é provado |
| Link cedo demais | não manda — só quando a pessoa pede preço ou pede pra ver |

O que ela pode afirmar sai de `prospeccao_alegacoes`, as mesmas da tela. O que
está bloqueado lá entra no prompt como lista do que não pode dizer nem
parafraseado — e o link é removido do texto por código, não por confiança.

Desligar só a IA (sem derrubar os outros agentes): `PROSPECCAO_IA_OFF=true`.

### Custo

Uma resposta custa alguns centavos (`claude-opus-5`, effort baixo). Cem respostas
por dia é ordem de **poucos reais/dia** — não é zero. Se o crédito da Anthropic
acabar, a cabeça devolve 503 e o worker **pula o contato** em vez de mandar
qualquer coisa.

---

## As três travas

O worker **não decide nada sozinho**. Ele relê as travas do banco a cada envio:

| Trava | Onde mora | O que faz |
|---|---|---|
| Quem receber | view `prospeccao_fila_worker` | já aplica bloqueado, lista ativa, não-tocado-hoje |
| Quantos por dia | view `prospeccao_teto_hoje` | teto adaptativo — sobe com a saúde, ver Cadência |
| Quando parar | view `prospeccao_saude` | opt-out acima de 8% trava a fila inteira |

Se você registrar "não perturbar" na tela enquanto o worker roda, ele para na
próxima mensagem. Mexer nos números aqui no arquivo não adianta — a fonte é o
banco.

### Cadência

O teto **não é um número escolhido** — ele sobe com a saúde medida. Por consultor:

| Situação | Fator | Teto (semana 4+) |
|---|---|---|
| Menos de 30 contatos tocados em 14 dias | 25% | **25/dia** |
| Opt-out abaixo de 2% | 100% | **100/dia** |
| Opt-out entre 2% e 4% | 50% | 50/dia |
| Opt-out entre 4% e 8% | 25% | 25/dia |
| Opt-out 8% ou mais | 0 | **fila travada** |

A base cresce 25 por semana até 100. Com os 4 consultores da casa, saudável e na
semana 4, isso é **400 mensagens/dia** — e varre a fila de 1.141 em 3 dias.

Ninguém precisa lembrar de subir: quem prova que não incomoda ganha volume
sozinho, e quem incomoda perde sozinho.

### Espaçamento — por que a janela longa é mais segura

Janela padrão: **07:00 às 23:59**.

O worker **não usa intervalo fixo**. Ele divide o tempo que sobra da janela pelo
que sobra do teto:

```
espera = (segundos restantes na janela) ÷ (mensagens restantes)  ± 25%
```

100 mensagens em 17 horas viram uma a cada ~10 minutos, sozinhas. As mesmas 100
das 9h às 18h seriam uma a cada 5 minutos — o dobro da densidade.

**O que derruba linha é densidade, não total.** Por isso a janela longa ajuda em
vez de atrapalhar: ela é o denominador da conta. Mandou cedo, o worker anda
devagar; entrou tarde, ele acelera até o piso de 60s.

Piso e teto do espaçamento (`MIN_SEG=60`, `MAX_SEG=900`) existem só pra evitar
rajada de um lado e worker dormindo do outro.

### O que a sua base diz sobre horário

Dos 305 toques registrados:

| Hora | Toques | Positivos | Pediram pra parar |
|---|---|---|---|
| **10h** | 79 | **21 (27%)** | 5 (6%) |
| 14h | 49 | 1 (2%) | 6 (12%) |
| 15h | 72 | 4 (6%) | 3 (4%) |
| **17h** | 13 | 0 | **4 (31%)** |
| 21h | 11 | 0 | 0 |

Amostra pequena, mas a direção é clara: **manhã converte, fim de tarde irrita.**
De 22h em diante não há um único toque registrado — nenhuma evidência, nem boa
nem ruim. A janela aberta é segura pela densidade; se o resultado das 22h vier
ruim, o dado vai aparecer no radar antes de virar problema.

## Operação 100% Instagram

### 1. Registre a conta nova na rampa

Conta de Instagram recém-criada mandando DM frio é o jeito mais rápido de perder
a conta. A rampa protege isso sozinha — **se você registrar a conta como um
consultor novo**:

```sql
insert into prospeccao_rampa (consultor, iniciou_em, obs)
values ('IG Prospeccao', current_date, 'conta de Instagram criada para prospeccao');
```

Depois rode o worker com `$env:CONSULTOR="IG Prospeccao"`. O teto vira:

| Semana | Conta nova (sem histórico) | Se o opt-out ficar abaixo de 2% |
|---|---|---|
| 1 | **6/dia** | 25/dia |
| 2 | 12/dia | 50/dia |
| 3 | 18/dia | 75/dia |
| 4+ | 25/dia | **100/dia** |

Os 6 do primeiro dia não são cautela minha — é a mesma ordem de grandeza que o
`PROMPT.md` do buscandomilhao usa (5/dia na semana 1). Conta que sobrevive à
primeira semana ganha volume sozinha.

**Aqueça a conta antes.** Antes do primeiro DM: foto, bio, alguns posts, seguir
perfis do setor, alguns dias de uso normal. Perfil vazio que só manda DM é o
padrão que o Instagram procura.

### 2. Consiga o @ das empresas

São três scripts, do mais barato ao mais caro. Rode nessa ordem.

| Script | Parte de | Custa |
|---|---|---|
| `colher-instagram.mjs` | empresa da base → lê o site dela | nada, sem Chrome |
| `buscar-instagram.mjs` | empresa da base → procura na lupa do IG | 1 busca por empresa |
| `descobrir-instagram.mjs` | **nada** → acha empresas que você nunca viu | 3 buscas por cidade |

#### Descobrir empresas novas

```powershell
node descobrir-instagram.mjs --dry --uf=PA          # ensaio, um estado
node descobrir-instagram.mjs --uf=PA --cidades=40   # grava
node descobrir-instagram.mjs --cidades=50           # Brasil, em rodadas
```

Varre `energia solar <cidade>`, `energia fotovoltaica <cidade>` e `solar <cidade>`
município por município — a lista de municípios vem do IBGE na hora, sem arquivo
local (144 no Pará, 5.570 no Brasil).

**O filtro é o que separa isso de uma lista de lixo.** Recusa curso, treinamento,
distribuidora, fábrica, aquecedor solar de piscina, consórcio, portal de notícias
e **perfil verificado** — verificado é marca grande (Canadian Solar), não
integradora local. Testado com 6 casos, 6 corretos.

Grava empresa, @, cidade e UF. **Sem telefone** — é uma empresa que existe no
Instagram e só. Dedup por @: rodar de novo não duplica.

Ritmo: 5 a 11 segundos entre buscas, para sozinho após 5 erros seguidos. Uma
rodada de 40 cidades são 120 buscas, ~15 minutos.

#### Achar o @ de quem já está na base

Este é o gargalo real da operação 100% Instagram:

| Origem do @ | Quantas |
|---|---|
| Colhido do site (`colher-instagram.mjs`) | **112** |
| Sem @ ainda | **358** |

Para as empresas que vieram do Maps e ainda não têm @:

```powershell
node buscar-instagram.mjs --dry     # mostra o que casaria, não grava
node buscar-instagram.mjs           # grava
```

Procura a empresa pelo nome + cidade e só aceita o perfil que compartilhe uma
palavra **distintiva** com o nome dela. "Solar", "Energia", "Fotovoltaica" não
contam — senão *Solar Brasil* casaria com *@solarpiracanjuba* e a DM iria pro
perfil errado, que é pior que não mandar.

Teto de 150 por rodada, 4 a 9 segundos entre buscas, e para sozinho depois de 5
erros seguidos. Rode várias vezes ao longo dos dias — continua de onde parou.

## Instagram vs WhatsApp — o número que decide

| | WhatsApp | Instagram |
|---|---|---|
| Alcança | **1.141** empresas | **101** |
| Onde está o endereço | telefone do Maps, sempre veio | @ colhido do site da empresa |

O Google Maps devolve telefone e site, **nunca o @**. O handle só existe pra quem
tem site com link do Instagram nele. Dos 470 alvos classificados:

- **101** têm @ (é o teto do canal hoje)
- 141 têm site e o site não linka Instagram
- 155 não têm site nenhum
- 73 tinham site fora do ar — **retentei, os 89 seguem inacessíveis**

Ou seja: por Instagram você fala com **8,8%** da base. Por WhatsApp, com todos.
Os dois modos funcionam nos dois canais (`--canal=instagram`), então dá pra rodar
os 101 do Instagram e o resto por WhatsApp — não é escolha excludente.

### Como o worker sabe quem falou, no Instagram

O WhatsApp Web marca `.message-in` / `.message-out`. **O Instagram não tem
equivalente** — a classe é gerada e muda sozinha.

O que não muda é o layout: mensagem nossa encosta na direita, dele na esquerda.
Então o lado é decidido por **geometria** — mede o centro de cada linha contra o
centro do container. É a única coisa que o Instagram não pode trocar sem virar
outro produto.

## O @ do Instagram

**Não existe @ na base.** O Google Maps devolve telefone e site, nunca o handle.
Por isso o `--canal=instagram` começa sem alvo nenhum.

Pra colher, de graça e sem Apify (a conta está travada por fatura em aberto):

```powershell
node colher-instagram.mjs
```

Abre o site de cada empresa e procura o link do Instagram. Rendeu **32%** no
teste (16 de 50). Guarda três estados: handle encontrado, `''` (site respondeu e
não tem Instagram — não tenta de novo) e `null` (site fora do ar — dá pra tentar
amanhã).

Ele ignora bandeira e fabricante (`@ipiranga`, `@shell`, `@growatt`), e handle
que aparece em mais de uma empresa é limpo automaticamente: é a marca ou a
agência que fez os dois sites, não o negócio.

---

## Acompanhar

**https://solardoc.app/gerador/radar/** — atualiza a cada 20 segundos.

Toques por hora, funil, disjuntor com a marca dos 8%, teto por consultor, feed
ao vivo e a conta de custo por lead. O radar é **somente leitura**: não existe
botão ali que dispare mensagem, de propósito.

---

## Quando der errado

| Sintoma | O que é |
|---|---|
| `NÃO CONSEGUI FALAR COM O CHROME` | o Chrome não subiu com `--remote-debugging-port=9222` |
| `caixa de mensagem não abriu` | número sem WhatsApp, ou a sessão do Web caiu |
| `botão de mensagem não encontrado` | perfil privado, ou o Instagram mudou o layout |
| `5 falhas seguidas — parando` | proteção: algo mudou na página ou a sessão morreu |
| `DISJUNTOR ARMADO` | opt-out passou de 8%. Troque a abertura antes de voltar |
| `todo script está bloqueado` | a trava de alegação. Prove a afirmação ou reescreva |

Falha **nunca** vira toque gravado. Mensagem que não saiu não tira a pessoa da
fila — senão ela sumiria sem nunca ter sido falada.
