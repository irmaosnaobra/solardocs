# Intersolar 25–27/08/2026 — o que foi feito com a agenda

Ordem do Thiago (25/08): os três dias de feira, novos só sexta e segunda, quem já
estava marcado é avisado e orientado a remarcar + seguir o Instagram.

---

## 1. A agenda fechou para NOVOS — 25, 26 e 27/08

Fechada só para **Thiago e Diego**. **Nilce e Giovanna continuam atendendo
normalmente** nos três dias (ligação de 15 min, conta baixa): elas não vão à feira
e fechar a agenda delas jogaria fora três dias de lead do Meta. Se for para fechar
a delas também, é uma linha de código — me avise.

Fechado em seis lugares, para não sobrar porta aberta:

| Porta | O que acontece agora |
|---|---|
| LP do eletroposto (`/io/eletroposto`) | vitrine pula direto para **sexta 28** |
| LP do solar (`/io/solar`) | grade dos sócios vazia nos 3 dias; a da Nilce/Giovanna intacta |
| Robô que remarca no WhatsApp | não oferece mais nenhum horário desses dias |
| POST das duas LPs | recusa a gravação (409) — cobre a aba que ficou aberta com a grade velha |
| Card de lead do Meta / prospecção | bloqueio em `agenda_bloqueios` (25/08 00:00 → 28/08 00:00, motivo "Intersolar") |
| Régua de avisos do eletroposto | não manda confirmação, bom dia, 1h nem 5min para reunião desses dias |

Também estão desligados **para esses três dias**: o vermelho automático das 13h, o
"não atendido automático" e a reagenda automática. Sem isso o robô marcaria de
ausente o cliente por uma falta que é nossa — e a copy dele diz "você não
conseguiu entrar na apresentação".

**Passada a feira:** esvaziar `DIAS_FECHADOS` em
`api/src/services/agenda/agendaFechada.ts` (e a mesma lista `AGENDA_FECHADA` nas
duas LPs) devolve tudo ao normal.

---

## 2. Os 25 já agendados — aviso + 3 horários

Cada pessoa recebe UMA mensagem: o motivo (a feira, data cravada 25–27/08), três
horários do **mesmo consultor**, "responde o número que eu remarco" e o convite do
Instagram `@irmaosnaobra__`. Quem responde "2" é remarcado pelo robô que já existe.

A ficha **não é mexida** até a pessoa escolher: continua `agendado`, no horário
velho, sem status inventado. Não remarquei de ofício de propósito — sexta e segunda
são justamente os dias reservados para os novos, e um robô empurrando 25
remarcações encheria os dois.

Kill-switch: `INTERSOLAR_FEIRA_OFF=1`. Prévia: `GET /cron/intersolar-feira?dry=1`.

### A fila (ordem de envio: quem já foi furado primeiro)

| Quando era | Cliente | WhatsApp | Consultor | Temp. |
|---|---|---|---|---|
| 25/08 08:00 | Edelvan Campos | 34 99221-8151 | Thiago | frio |
| 25/08 08:15 | Rivinan | 64 99984-7654 | Thiago | — |
| 25/08 13:00 | Essen Pinheiro | 95 99138-8356 | Diego | morno |
| 25/08 14:00 | José Henrique | 11 96401-9777 | Diego | morno |
| 25/08 15:00 | Vanderley Lysyk | 19 98119-4628 | Diego | morno |
| 25/08 15:00 | Donizete Gomes | 19 98982-0377 | Thiago | morno |
| 25/08 15:15 | Silvano | 38 99100-1381 | Diego | **quente** |
| 25/08 16:00 | Booner costa | 63 99134-2352 | Thiago | morno |
| 25/08 17:00 | Pablo Ponciano da Silva | 31 99506-8532 | Thiago | morno |
| 25/08 17:00 | Eurebi dos Santos | 12 98257-5216 | Diego | **quente** |
| 26/08 13:00 | Roland Loewen | 41 98897-4609 | Diego | morno |
| 26/08 13:00 | Ezequiel | 61 98623-7429 | Thiago | morno |
| 26/08 14:00 | Gerson Andrade Filho | 71 99987-1483 | Diego | **quente** |
| 26/08 15:00 | Bruno taglieri | 11 97343-4037 | Thiago | **quente** |
| 26/08 15:00 | Emerson Amancio | 94 99195-7713 | Diego | morno |
| 26/08 15:30 | Lead Instagram (solar) | 34 98851-9954 | Thiago | morno |
| 26/08 16:00 | Alan Rener Tavares | 65 98408-6483 | Thiago | **quente** |
| 26/08 16:00 | Matheus Castilho | 34 99645-0865 | Diego | **quente** |
| 26/08 16:30 | Thiago Bueno | 62 99625-9967 | Thiago | morno |
| 26/08 17:00 | Ronaldo | 31 98557-0710 | Diego | **quente** |
| 26/08 17:00 | Iranan Lopes dos Santos | 87 99680-0700 | Thiago | frio |
| 26/08 18:00 | Mauricio | 73 99131-3833 | Thiago | morno |
| 26/08 18:00 | Samuel Mendes | 38 99171-9652 | Diego | **quente** |
| 27/08 14:00 | Reginaldo Mauricio | 31 99983-2856 | Thiago | **quente** |
| 27/08 18:00 | Geanio Almeida | 88 98184-2702 | Thiago | **quente** |

10 quentes, 12 mornos, 2 frios, 1 sem nota. Um é ficha de **solar** (Lead
Instagram): recebe a mesma mensagem sem lista de horários, porque a grade de
vistoria é outra — quem combina o dia é o consultor.

---

## 3. O gargalo: a linha de WhatsApp está cheia

Medido às 16h50 de 25/08: **51 envios nas últimas 24h** (teto do dia = 40, sendo 30
para mensagem fria) e **7 na última hora** (teto = 6). Com a linha nesse estado
**nada sai** — nem esses avisos, nem a campanha da feira para os 69 clientes.

O que já foi feito por conta:

- os avisos da feira passaram a contar como **transacional** (é mensagem sobre a
  reunião que a própria pessoa marcou), então têm prioridade sobre campanha fria;
- a régua de avisos parou de gastar 5–7 mensagens/hora com "falta 1 hora para sua
  reunião" de reuniões desses três dias, que não vão acontecer. Só isso já devolve
  quase todo o teto por hora.

**Decisão que é sua:** mesmo assim, com 51 na janela de 24h, a fila só começa a
escoar quando ela drenar — hoje sai pouca coisa, e as 25 mensagens levam mais de um
dia nesse ritmo. As saídas:

1. **Subir o teto do dia por 2 dias** — `LINHA_MAX_DIA` de 40 para 60 na Vercel
   (projeto solardocs-api). É o caminho mais rápido e o conteúdo é o de menor risco
   de denúncia que existe: aviso de reunião para quem marcou com a gente.
2. **Pausar a campanha dos 69 clientes** — `INTERSOLAR_OFF=1` até a fila de avisos
   escoar. Ela consome o mesmo orçamento.
3. **Avisar na mão os mais urgentes** — a tabela acima está em ordem; os de hoje 17h
   e os de amanhã à tarde são os que não podem esperar.

As três podem ser combinadas. Se nada for feito, o robô continua tentando e a fila
escoa sozinha ao longo de quarta e quinta — tarde demais para boa parte dela.

---

## 4. Onde os remarcados cabem

Sexta 28 e segunda 31 estão **inteiramente livres**: 13 horários para cada
consultor, 26 no total. As 25 remarcações cabem — mas encheriam exatamente os dois
dias reservados para os novos. Na prática nem todos remarcam, e quem escolhe pelo
menu tende a espalhar; se lotar, o robô oferece terça 01/09 em diante.
