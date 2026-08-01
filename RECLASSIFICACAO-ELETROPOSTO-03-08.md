# Reclassificação da agenda de Eletroposto — 03/08/2026 em diante

Fonte: `agendamentos` (Supabase gerador-propostas), `created_by = 'lp_eletroposto'`,
`quando >= 03/08/2026`. **27 reuniões.** Nenhum lead de eletroposto entrou por outra origem.

**Executado em 01/08/2026: 14 reuniões canceladas, 7h de agenda liberadas.**
**As mensagens de realinhamento NÃO foram enviadas** — ver "Pendência crítica".

## Régua aplicada

Ajustes seus de 01/08 sobre o briefing original:

- **Atendemos o Brasil inteiro.** O eixo de raio/distância foi removido da análise — não é
  critério de qualificação e não aparece mais em nenhuma lista.
- **Sem local = NOTA 1**, sobrepondo a pontuação total. Uma reunião sem endereço não tem
  objeto: não há o que orçar, estudar ou dimensionar.

Demais eixos conforme o briefing: PONTO 0–3, CAPITAL 0–3, PERFIL/FLUXO 0–3, DECISOR = 1
(campo inexistente no cadastro antigo).

---

## Resultado

| | Antes | Depois |
|---|---|---|
| 🟢 NOTA 3 | — | **2** (7%) |
| 🟡 NOTA 2 | — | **11** (41%) |
| 🔴 NOTA 1 — canceladas | — | **14** (52%) |
| Reuniões na semana | 27 | **13** |

**Agenda liberada: 14 slots × 30 min = 7h de calendário — ~21h de sócio** (prep + reunião +
follow-up a 1,5h por reunião, régua do próprio ECOSSISTEMA).

**Pipeline NOTA 3: 2 × R$ 160.000 = R$ 320.000** · margem bruta 2 × R$ 60.000 = R$ 120.000.

Metade desse pipeline é contingente: Irineu tem capital declarado de verdade ("Recurso
próprio + financiamento"), mas **Adonei** é 9 pts só porque interpretei a faixa "R$ 140–260
mil" como 2. Se ele responder *"ainda não consultei o banco"*, cai para 8 → NOTA 2, e o
pipeline vira R$ 160.000.

### A agenda final (após a remanejada de 01/08)

Decisão do Thiago: os 13 que ficaram vão todos para **seg/ter/qua à tarde**, divididos
igualmente entre os dois. E a **tarde voltou para a grade da LP** (`FAIXAS` com `[13,17]`,
commit `4d14813`) — sem isso, horário que vagava à tarde não voltava para venda, porque a
LP só anunciava manhã desde 30/07.

| Dia | Thiago | Diego |
|---|---|---|
| **03/08 seg** | Hudson 13:00 · **Rafael 14:00** · Guilherme 14:30 | **Denilson 13:30** · Eliel 15:00 |
| **04/08 ter** | João Carlos 13:00 · Fabio 15:30 | Wlisses 15:00 |
| **05/08 qua** | Ewerton 13:00 · **Adonei 15:00** 🟢 | **Irineu 13:30** 🟢 · Edgar 14:00 · Paulo 16:00 |

**7 Thiago × 6 Diego**, um NOTA 3 para cada, sem colisão de horário.

**Dois clientes mudaram de horário e precisam ser avisados:**
- **Denilson** — ter 18:30 → **seg 03/08 13:30**
- **Rafael Da Col** — qui 13:00 → **seg 03/08 14:00** (3 dias antes do combinado — o mais urgente)

Segunda ficou com 5 reuniões seguidas (13:00–15:00) e a semana equilibrou em **5 / 3 / 5**.
Texto dos dois avisos pronto em [MSG-ELETROPOSTO-GRUPO-02-08.md](MSG-ELETROPOSTO-GRUPO-02-08.md).

### Disponibilidade para vender

Com a tarde de volta: **14 slots/dia × 3 dias = 42 por semana** (era 18).

| Dia | Manhã livre | Tarde livre | Total |
|---|---|---|---|
| 03/08 seg | 6 de 6 | 5 de 8 | **11** |
| 04/08 ter | 6 de 6 | 4 de 8 | **10** |
| 05/08 qua | 6 de 6 | 2 de 8 | **8** |

### Sobre "remover os leads da agenda"

As 14 fichas **já estavam fora da agenda** — não foi preciso apagar nada:

- **Na LP:** a query de ocupados filtra `status not.in.(cancelado,sem_interesse)`. Testado
  contra a API pública: retorna `[]` para os 14. Nunca bloquearam slot nenhum.
- **No CRM:** `cancelado` está dentro de `CRM_STATUS_PERDIDO`, então não contam como
  reunião futura (`agFuturo`) e caem na coluna Perdido.

O que travava a tarde não eram eles — era a grade não vender tarde. As fichas seguem com a
tag `🔴 NOTA 1 — NUTRIÇÃO` para remarketing, como o briefing pediu. Para apagar de vez:
`delete from agendamentos where id in (622,624,629,630,631,635,637,638,644,645,647,652,654,656);`

---

## 🟢 NOTA 3 — prioridade máxima (2)

Estudo de viabilidade completo antes da call. Meta: proposta assinada ou visita técnica paga.

| Nome | Cidade | Data/hora | Resp. | PONTO/CAP/PERFIL/DEC | Total |
|---|---|---|---|---|---|
| **Irineu de Almeida Bastos** | Boquira-BA | 05/08 qua 13:30 | Diego | 3/3/3/1 | **10** |
| **Adonei Aguiat** | Guaraí-TO | 05/08 qua 15:00 | Diego | 3/2/3/1 | **9** |

Irineu é dono de posto de combustível com ponto definido e recurso próprio + financiamento.
É o lead mais completo da base inteira.

## 🟡 NOTA 2 — manter, mudar o objetivo (11)

Reunião de **definição de ponto**, não de orçamento. Oferecer Programa Ponto Zero
(R$ 2.000, abatível na obra em 12 meses). **Não apresentar preço de equipamento.**

| Nome | Cidade | Data/hora | Resp. | PONTO/CAP/PERFIL/DEC | Total | Flags |
|---|---|---|---|---|---|---|
| João Carlos Nunes da Cruz | Mascote-BA | 04/08 ter 13:00 | Thiago | 3/1/3/1 | **8** | 📍 · ~cap |
| Fabio lucas | João Pessoa-PB | 04/08 ter 15:30 | Diego | 3/1/3/1 | **8** | 📍 · ~cap |
| **Denilson F Teixeira** | Arcos-MG | 04/08 ter 18:30 | Diego | 3/2/2/1 | **8** | **BR-354** · ~cap |
| Paulo Andrade | Itaporanga-SP | 05/08 qua 16:00 | Diego | 3/1/3/1 | **8** | 📍 · ~cap |
| Wlisses | Serrinha-BA | 04/08 ter 15:00 | Diego | 3/2/1/1 | **7** | ~cap |
| Ewerton Barcelos | Vitória-ES | 05/08 qua 13:00 | Thiago | 3/1/2/1 | **7** | 📍 · ~cap |
| Edgar Paulo Rodrigues silva | Recife-PE | 05/08 qua 14:00 | Diego | 3/1/2/1 | **7** | 📍 |
| Hudson Lourenço | Cariacica-ES | 03/08 seg 13:00 | Thiago | 3/1/1/1 | **6** | 📍 · ~cap |
| Eliel Júlio Soares da Silva | Petrolina-PE | 03/08 seg 15:00 | Diego | 3/2/0/1 | **6** | ~cap |
| Guilherme | Campos dos Goytacazes-RJ | 03/08 seg 14:30 | Diego | 3/1/0/1 | **5** | 📍 · ~cap |
| Rafael Da Col | Campinas-SP | 06/08 qui 13:00 | Diego | 3/1/0/1 | **5** | 📍 · ~cap |

`~cap` = nota de capital aproximada (ver Limitações).

**Denilson F Teixeira é o melhor lead do quadro depois dos dois NOTA 3.** Ponto declarado
na **BR-354 Km 116** — rodovia federal —, orçamento de R$ 140–260 mil. Só não é NOTA 3
porque perfil "Investidor" vale 0 e o decisor é presumido: **se responder "recurso próprio"
e "eu decido", vai a 10 pts.** Trate como prioridade desde já.

## 🔴 NOTA 1 — canceladas (14)

Todas por regra de corte: **sem local definido**. Status no CRM = `cancelado`,
tag `🔴 NOTA 1 — NUTRIÇÃO` gravada na observação, nada apagado.

| # | Nome | Data/hora liberada | Resp. | WhatsApp | Pts brutos |
|---|---|---|---|---|---|
| 629 | Wladimir Figueiredo | 03/08 seg 13:30 | Thiago | `5511999458808` | 3 |
| 637 | Silney Rocha Santos | 03/08 seg 14:00 | Thiago | `5579996910404` | 2 |
| 635 | Lucio Delgado Xavier | 03/08 seg 15:30 | Thiago | `5515991847000` | 2 |
| 638 | Rogério | 03/08 seg 16:00 | Diego | `5534998872288` | 3 |
| 647 | Marco Aurelio | 03/08 seg 16:30 | Thiago | `5511976468660` | 2 |
| 644 | Alex Martins de Oliveira | 04/08 ter 13:30 | Thiago | `5531991440706` | 5 |
| 630 | Cicero | 04/08 ter 14:00 | Diego | `5586981096098` | 5 |
| 645 | AGUIMON alves teixeira | 04/08 ter 14:30 | Diego | `5569999839904` | 3 |
| 624 | Juliana | 04/08 ter 16:00 | Thiago | `5562996900297` | 1 |
| 622 | Antonio Augusto Diniz Veras | 04/08 ter 16:30 | Thiago | `5584999722006` | 1 |
| 656 | **Bruno Acorroni** | 05/08 qua 11:00 | Diego | `5531974000295` | 5 |
| 652 | Reginaldo magosso | 05/08 qua 14:30 | Thiago | `5565996069074` | 5 |
| 654 | Diego Guirra | 05/08 qua 15:30 | Thiago | `5571991871726` | 2 |
| 631 | Marcelo Correia | 05/08 qua 16:30 | Thiago | `5585997845633` | 2 |

**Reverter qualquer um:** `update agendamentos set status='agendado' where id = <id>`.

---

## Mensagem de realinhamento — domingo 02/08, a partir das 9h

Texto pronto, em bolhas, com remetente e dia conferidos lead a lead:
**[MSG-ELETROPOSTO-GRUPO-02-08.md](MSG-ELETROPOSTO-GRUPO-02-08.md)**

Grupo posicionado como **network e oportunidades** — onde quem tem local encontra quem tem
capital. Entrada gratuita.

Envio manual: o Z-Api está sem autenticação, então não há como disparar daqui. Ordem de
prioridade: os 5 de **segunda** primeiro (Wladimir, Silney, Lucio, Rogério, Marco Aurelio),
depois os 5 de terça, depois os 4 de quarta. Enviando domingo 9h, os de segunda recebem com
~24h de antecedência da reunião que foi liberada.

---

## Ações que continuam abertas

**1. As 3 perguntas — para os 13 mantidos.** Fecham as lacunas do cadastro antigo e
reprocessam a nota.

> Oi [nome]! Aqui é o [Thiago/Diego], da Irmãos na Obra. Antes da nossa conversa de [dia],
> me ajuda com 3 coisas rápidas pra eu já levar o estudo certo?
>
> 1. Quem participa da reunião além de você? Tem sócio ou cônjuge que decide junto?
> 2. O local que você tem em vista já tem entrada de energia trifásica?
> 3. Você já chegou a consultar banco ou financiamento?

A **pergunta 3 é a mais valiosa da lista** — vale R$ 160.000 de pipeline (Adonei) e pode
promover vários dos 14 leads presos na faixa "R$ 85–140 mil".

**2. Reposicionamento de consultoria — nenhum pendente.** O único lead que marcou
"Consultoria Completa" era o Bruno Acorroni, que caiu na regra de corte. Se você reativar
ele, a mensagem de reposicionamento do briefing precisa ir junto.

---

## A. 📍 Pontos disponíveis (estoque para casar com investidor) — 8

Ponto definido (3 pts) e capital 0–1. Todos **mantidos na agenda** como NOTA 2.

| Nome | Cidade | Data/hora | Pts |
|---|---|---|---|
| João Carlos Nunes da Cruz | Mascote-BA | 04/08 ter 13:00 | 8 |
| Fabio lucas | João Pessoa-PB | 04/08 ter 15:30 | 8 |
| Paulo Andrade | Itaporanga-SP | 05/08 qua 16:00 | 8 |
| Ewerton Barcelos | Vitória-ES | 05/08 qua 13:00 | 7 |
| Edgar Paulo Rodrigues silva | Recife-PE | 05/08 qua 14:00 | 7 |
| Hudson Lourenço | Cariacica-ES | 03/08 seg 13:00 | 6 |
| Guilherme | Campos dos Goytacazes-RJ | 03/08 seg 14:30 | 5 |
| Rafael Da Col | Campinas-SP | 06/08 qui 13:00 | 5 |

## B. 💰 Investidores sem ponto — 1, e ele vai pro grupo

| Nome | Cidade | Data/hora | Capital | Destino |
|---|---|---|---|---|
| Bruno Acorroni | Santa Luzia-MG | 05/08 qua 11:00 | **Recurso próprio (3)** | 🔴 cancelado → **grupo** |

**Decisão do Thiago (01/08): Bruno vai pro grupo.** Ele é o único lead da agenda com capital
próprio declarado e sem local — o outro lado do casamento com os 8 📍 da lista A. No grupo
de network ele encontra ponto; na agenda ele consumiria 1,5h de sócio sem ter o que orçar.

A mensagem dele leva **uma bolha diferente** das outras 13, que explicita esse encaixe —
ver [MSG-ELETROPOSTO-GRUPO-02-08.md](MSG-ELETROPOSTO-GRUPO-02-08.md).

## C. Fora de raio — descontinuada

Atendemos o Brasil inteiro. Critério removido.
