# O container muda a pergunta
### Modelo de negócio para o estoque importado · Irmãos na Obra · 17/ago/2026

> **A pergunta que vocês fizeram:** com um container de carregadores chegando, qual o melhor
> modelo — venda direta, franquia, outro?
>
> **A resposta curta, em três linhas:**
> 1. **Não é franquia.** Franquia vende formato, não estoque — é o modelo mais lento de todos
>    para esvaziar um container, e hoje vocês não têm como escrever uma COF honesta. Mês 12+.
> 2. **Não é venda direta pura.** Caixa avulsa é commodity, some da sua base e arma concorrente.
> 3. **É venda com a plataforma acoplada, em três trilhas simultâneas.** A regra nova da casa:
>    **o carregador nunca sai sozinho.** Cada unidade que deixa o estoque tem que sair como
>    *ponto ativo na plataforma*, não como equipamento.
>
> **⚠️ = premissa minha, não número de vocês.** Tabela completa no fim.
> **🔒 Documento interno.** Ele mostra margem bruta por unidade e o preço de consignação — que é
> exatamente o que o investidor vai negociar. Para a mesa dele vão **as Partes 5, 6 e a tabela de
> sensibilidade**, sem as colunas de margem.
> **Base:** `ECOSSISTEMA-ELETROPOSTO.md` (9 degraus, 3 travas), `ARQUITETURA-CONTRATOS-ELETROPOSTO.md`
> (6 instrumentos), simulador da LP `/io/eletroposto` (CONFIGS + premissas financeiras).

---

## PARTE 0 — A pergunta certa não é "qual modelo". É "quantas unidades por mês".

Todo o `ECOSSISTEMA-ELETROPOSTO.md` foi escrito com um gargalo em mente: **hora de sócio**.
O container troca o gargalo. Agora existe capital de terceiro parado numa prateleira, e a
régua de qualquer decisão passa a ser:

```
unidades que este modelo esvazia por mês  ×  pontos ativos que ele gera
```

Por que isso reorganiza tudo: vocês fecham **⚠️ ~12 turnkeys/ano** (premissa da Parte 4 do
ecossistema, nunca confirmada). Um container de 20+ unidades **é dois anos de obra**. Se o
container sair só pela porta do turnkey, o dinheiro do investidor fica preso 24 meses, com
custo de oportunidade de ⚠️ ~R$ 100 mil/ano (14% a.a. sobre ⚠️ R$ 725 mil) — e o investidor não
volta na segunda rodada.

A régua de throughput já elimina metade das opções sem precisar de análise de mercado.
E ela conversa com a Lei 2 do ecossistema — *"meça pontos ativos, não faturamento da
plataforma, nos primeiros 18 meses"*. O container é, por acidente, **o caminho mais barato
que vocês já tiveram para os 20–40 pontos ativos que a bandeira do Degrau 9 exige.**

---

## PARTE 1 — Três portões antes de fechar o pedido

Nada aqui é opinião. São três verificações baratas, e **cada uma pode invalidar um trilho inteiro
do plano.** Fazer depois do container no porto é caro.

### Portão 1 — A ficha técnica. Esse é o que trava o plano todo.

Se as unidades não falarem **OCPP aberto**, o Degrau 7 (plataforma) **não acopla neste container**
— e sem plataforma acoplada, sobra venda de caixa, que é justamente o modelo que este documento
descarta. Metade dos fabricantes chineses baratos entrega o carregador **preso à nuvem deles**,
com taxa por conector. Isso mata a recorrência e mata a bandeira.

Lista para mandar ao fornecedor **antes do pedido** (copie e cole):

| Item | Exigência | Por que |
|---|---|---|
| Protocolo | **OCPP 1.6J** (WebSocket/JSON) ou 2.0.1, **sem lock de backend, sem taxa por conector** | Sem isso não existe Degrau 7 |
| Comandos | RemoteStart/StopTransaction, MeterValues, Reset, FirmwareUpdate | É o que o app cobra |
| Conector | **CCS2 dual-gun** — **não GB/T** | GB/T não atende carro brasileiro |
| Entrada | **380 V trifásico / 60 Hz** | Estoque doméstico chinês costuma ser 50 Hz |
| Saída | 200–1000 V DC | 400 V (BYD/Dolphin) **e** 800 V (novos) |
| Medição | Medidor com certificado de ensaio | Você cobra por kWh; sem medidor auditável, cobrança é frágil |
| Identificação | RFID ISO 14443 + partida por app | Condomínio e frota cobram por usuário |
| Ambiente | IP54 mín., operação até 50 °C, proteção de surto | Poste em pátio, sol do Triângulo |
| Ensaios | Laudos **IEC 61851-23/-24** e IEC 61000 (EMC) em PDF | Base do futuro selo e do parecer de acesso |
| Garantia | 24–36 meses **com peças**, por escrito, com prazo de resposta | Sem isso a garantia é sua |
| Documentação | Manual, diagrama unifilar e datasheet em PT ou EN | A concessionária pede na Fase 2 |

### Portão 2 — Quem importa, e em qual regime

O carregador rápido entra na **NCM 8504.40.90**: II 14%, IPI ~5%, PIS-imp 2,1%, COFINS-imp 9,65%,
ICMS 17–22% no desembaraço. Rodando a cascata (ICMS por dentro, mais AFRMM, Siscomex, despachante,
armazenagem), o **custo de aquisição fica em ~1,67× o CIF**.

Para quem **não** está no Simples, ICMS e PIS/COFINS de importação **entram como crédito**, e o
custo de aquisição cai para **~1,25× o CIF**. Por unidade de 80 kW, tomando os R$ 33.000 de vocês
como o custo já creditado:

| Quem é o importador | Custo de aquisição do 80 kW | Na venda a R$ 54.900 |
|---|---|---|
| **Lucro Presumido/Real** (credita ICMS + PIS/COFINS) | **R$ 33.000** ✔️ | ICMS/PIS/COFINS só sobre o valor agregado |
| **Simples** (nada creditável) | ⚠️ **R$ 44.100** | + ~10% de alíquota única sobre a receita bruta |

> **A diferença de ⚠️ R$ 11.100 por unidade é 43% do spread inteiro de R$ 26 mil.** Num container
> de 16 DC, ⚠️ ~R$ 178 mil — só na aquisição, antes do imposto de saída. O crédito não volta em
> dinheiro: ele abate o imposto da revenda. Em uma frase: **no regime normal o tributo é pedágio
> sobre o valor agregado; no Simples é custo travado na prateleira.** ⚠️ A conta fechada —
> tributo total por unidade, da importação até a venda, nos dois regimes — é do contador
> (pergunta 4 da Parte 10), e o resultado depende de para quem vocês vendem: comprador B2B credita
> o ICMS destacado e não sente; pessoa física sente.

**Recomendação:** o importador de registro é o **CNPJ do investidor** (ou uma importadora por conta
e ordem), **nunca o CNPJ da IO no Simples**. Dois motivos, e eu prefiro ser honesto sobre o peso
de cada um:

1. **Os ⚠️ R$ 11 mil por unidade acima.** É o argumento que decide, e ele vale desde a primeira unidade.
2. **O teto do Simples — que não estoura hoje, mas encosta.** Teto de receita bruta de **R$ 4,8 mi**,
   com **sublimite de R$ 3,6 mi para ICMS/ISS**. Somando turnkey (⚠️ R$ 1,74 mi/ano) com o resto da
   esteira (⚠️ R$ 830 mil) e a Trilha 2 (⚠️ R$ 255 mil/ano), dá ⚠️ ~R$ 2,8 mi — **cabe, com folga
   menor do que parece.** O ponto verdadeiro é outro: **revenda de equipamento é a pior forma de
   gastar teto do Simples.** Ela entra como receita bruta cheia com margem de 29%, enquanto o
   turnkey entra com 40%. Cada real de teto queimado numa caixa rende menos que numa obra — e se o
   sublimite estourar, **a obra inteira reprecifica**, não só a caixa.

O desenho limpo, então: **equipamento faturado pela importadora** (ICMS, com crédito) e **serviço
faturado pela IO** (ISS, Simples intacto).

⚠️ **Confirmar com contador antes do pedido** — e checar o calendário da reforma: 2026 é ano-teste
de CBS/IBS, e em 2027 a CBS substitui PIS/COFINS com crédito integral. A tendência é o erro de
"importar no Simples" ficar **mais** caro, não menos.

### Portão 3 — Peças e certificação

**Peças no mesmo container.** Reserve **8–12% do valor** em: módulos de potência (o que mais queima),
contatores DC, **cabos + pistolas CCS2** (desgaste e vandalismo), placa de controle, display,
ventiladores/filtros, DPS. Sem isso, cada falha de campo vira **importação de 90 dias** — que
destrói o payback do cliente, derruba a recorrência da plataforma e chega em vocês, porque
**a ART é do engenheiro da IO**. É a Trava 3 do ecossistema pelo avesso: no turnkey a
responsabilidade técnica é sua, então a peça de reposição também é.

**INMETRO — a janela está aberta e vai fechar.** Hoje **não há certificação obrigatória** para
carregador de veículo elétrico: a Portaria Inmetro 148/2022 dispensa, e a norma seguida é a
ABNT NBR IEC 61851. A comissão do Regulamento Técnico Metrológico **começou a trabalhar em abril
de 2026**, e fabricantes já certificam por conta própria (WEG, Intelbras, E-Wolf, Livoltek).

Leitura estratégica em duas frases: **importar agora é legal e o selo ainda não é barreira**;
**um estoque sem laudos IEC vira estoque encalhado no dia em que a obrigatoriedade sair.**
Por isso a exigência dos laudos no Portão 1 não é burocracia — é liquidez do container. E por
isso a **velocidade de giro** (Parte 4) vale mais que o preço da unidade.

---

## PARTE 2 — A conta do container

> **Atualizado com número de vocês (17/ago):** o **80 kW chega ao Brasil a R$ 33.000**, e o
> **menor preço visto no mercado brasileiro é R$ 59.000**. Esses dois números substituem minhas
> premissas e mudam o plano em dois lugares — o preço da Trilha 2 (Parte 4) e a ordem de prioridade
> das trilhas (Parte 4-bis). Toda a Parte 6 foi recalculada em cima deles.

**Premissa que sobrou:** o 120 kW e o AC seguem estimados na proporção do FOB (⚠️), porque vocês
me deram só o 80 kW.

| Item | Qtd | Custo/un | Custo total |
|---|---|---|---|
| DC 80 kW dual-gun CCS2 | 12 | **R$ 33.000** ✔️ | R$ 396.000 |
| DC 120 kW dual-gun CCS2 | 4 | ⚠️ R$ 48.000 | R$ 192.000 |
| AC 22 kW OCPP (wallbox) | 40 | ⚠️ R$ 1.925 | R$ 77.000 |
| Peças de reposição (~9%) | — | — | ⚠️ R$ 60.000 |
| | | **Total** | **⚠️ ≈ R$ 725.000** |

> **Os dois números precisam de etiqueta antes de virarem base de preço:**
> **(a)** o R$ 33.000 é custo **com** crédito de ICMS/PIS/COFINS (regime normal) ou **sem** (Simples)?
> A diferença é ⚠️ R$ 11 mil por unidade — 43% do spread. **(b)** os R$ 59.000 são **preço de venda
> no mercado** (o que um cliente paga), **custo de outro importador**, ou **uma proposta que
> apareceu num cliente específico**? Se for preço de venda, o R$ 54.900 da Parte 4 está certo.
> **Se for custo ou atacado de outro importador, o mercado paga bem mais e o R$ 54.900 joga metade
> do spread fora.** Perguntas 8 e 9 da Parte 10 — as duas mais baratas de responder e as que mais
> mexem no plano.

**A composição é a decisão mais alavancada do pedido — mais que o preço da unidade.** Ela define
quais modelos vocês *podem* rodar depois:

- **O DC paga a margem.** É o que sustenta turnkey e venda de alto ticket.
- **O AC compra a rede.** 40 wallboxes a ⚠️ R$ 1.925 custam R$ 77 mil — **4% do container** — e
  valem **40 pontos ativos**. Condomínio e frota cobram por usuário via OCPP, então cada um entra
  na plataforma. Isso sozinho leva vocês do estágio 1 ao **estágio 2 do Degrau 7** (20–30 pontos =
  renegociar comissão com o fornecedor). Caveat honesto: ponto de condomínio **não** vale o mesmo
  que ponto público de DC — ele não traz base de motorista, mas conta no volume que dá poder de
  negociação e paga assinatura todo mês.

> **O AC precisa de canal próprio, e ele não existe hoje.** 40 wallboxes são **40 vendas B2B
> pequenas**, não uma venda grande — motion completamente diferente de vender um DC para
> integrador, e para um comprador que não está na sua base (síndico e gestor de frota, não
> investidor de eletroposto). Sem canal nomeado, os **40 pontos que carregam 71% do ganho
> estratégico do container** ficam no papel. Os três canais que servem, em ordem de esforço:
> **(a) administradoras de condomínio** do Triângulo — uma administradora tem 30–80 prédios e é
> uma conversa, não trinta; **(b) instaladores solares e elétricos locais como revenda** — eles
> já sobem em prédio e já vendem para síndico; **(c) frota** (locadora, distribuidora, prefeitura).
> Enquanto nenhum dos três estiver testado, **conte 16 pontos ativos, não 56** — o AC é upside,
> não linha de base.

**O número que o container finalmente responde:** a **pergunta 1 da Parte 7** do ecossistema
("qual a margem real do turnkey de 80 kW?") estava travada há 18 dias. Agora metade dela está
resolvida com número real: **o equipamento do 80 kW custa R$ 33.000 dentro de um turnkey de
R$ 144.595 — 23% do ticket.** Os outros R$ 111.595 são obra + margem. Falta só o custo de obra
(padrão de entrada, trafo, civil, cabeamento, proteção, projeto, ART, comissionamento) — **esse
número vocês têm.** Com ele fechado, o crédito de upgrade (instrumento ⑤ da arquitetura de
contratos) sai do papel na mesma semana.

---

## PARTE 3 — Os cinco modelos na régua de throughput

| Modelo | Un/mês | Pontos ativos | Capital de volta | Risco | Veredito |
|---|---|---|---|---|---|
| **A. Venda avulsa (balcão)** | **alto** (3–5) | **zero** | rápido | garantia + arma concorrente | Só **com plataforma acoplada** |
| **B. Franquia** | **o pior** (0,3) | médio | lento | COF, INPI, jurídico | **Mês 12+** |
| **C. Turnkey com pronta-entrega** | baixo (1) | alto | 24 meses | nenhum novo | Sim, mas **não esvazia** |
| **D. Comodato / rede própria (CPO)** | médio (0,5) | **o melhor** | 14–56 meses | **ocupação** | Sim, **em dose** |
| **E. Ponto Autorizado (licença + supply)** | **alto** (3–4) | **alto** | rápido | jurídico leve | **Sim — mas margem fina (R$ 16 mil/un)** |

**Por que a franquia sai (e sai por escrito, não por hedge):** a Lei 13.966/2019 exige **COF
entregue 10 dias antes da assinatura**, com balanços dos dois últimos exercícios, lista de todos
os franqueados, pendências judiciais e investimento total declarado. Isso pressupõe **unidades
próprias operando com números auditáveis** — que é exatamente a **pergunta 5 da Parte 7**, ainda
sem resposta ("quantos eletropostos já entregues e rodando?"). Somando: franquia é o modelo mais
lento a esvaziar estoque **e** o que exige a papelada mais pesada. Ela volta ao mapa no **mês 12+**,
quando a Trilha 3 tiver dado 4–8 pontos próprios operando — e aí a COF é verdadeira em vez de
otimista. **A Trilha 2 abaixo é a ponte.**

**Por que a venda avulsa sai na forma pura:** ela viola a Lei 2 do ecossistema. Caixa vendida é
cliente que você nunca vê de novo, e é o concorrente da esquina armado por você. Ela volta —
mas **condicionada**, na Trilha 2.

---

## PARTE 4 — O modelo recomendado: o carregador nunca sai sozinho

**Uma regra, três trilhas, uma frase:** nenhuma unidade deixa o estoque sem **contrato de
plataforma de 24 meses** assinado. O preço do equipamento é **condicionado** a essa adesão, com
**claw-back proporcional** se o cliente sair antes — que é exatamente o desenho já aprovado na
`ARQUITETURA-CONTRATOS-ELETROPOSTO.md` ("preço condicionado, não venda casada", art. 39, I do CDC).
Isso não é exclusividade imposta; é desconto com contrapartida, e sobrevive à leitura de advogado.

E **estoque é prêmio, não motivo de desconto.** Pronta-entrega em **15 dias** contra **90–120 dias**
de importação sob pedido é a diferença entre o cliente fechar hoje e "pesquisar". Cobre por isso.

### Trilha 1 — Turnkey com pronta-entrega · dentro do Triângulo · 6 unidades

Nada muda no produto: R$ 144.595 no 80 kW, as 8 fases, tabela da apresentação comercial.
O que muda é a margem — o equipamento agora custa ⚠️ R$ 37.800 em vez de preço de fornecedor
nacional — e o **argumento de fechamento**: "a estação está no nosso galpão".

### Trilha 2 — Ponto Autorizado IO · fora do Triângulo · 6 DC + 40 AC

O trilho novo, e o que esvazia o container. **É o Degrau 5 (Supply) crescido e reprecificado.**

**O teto é R$ 59.000 — não é o custo que define o preço aqui, é o piso do concorrente.**
Com custo de R$ 33.000 e o menor preço de mercado a R$ 59.000, **todo o spread do canal são
R$ 26.000 por unidade** — antes do imposto de saída. Isso enterra qualquer preço de tabela
construído de baixo pra cima.

| | Custo | Preço IO | Bruto | Depois do imposto de saída ⚠️ |
|---|---|---|---|---|
| DC 80 kW | R$ 33.000 | **R$ 54.900** | R$ 21.900 | ~R$ 16.000 |
| DC 120 kW | ⚠️ R$ 48.000 | **R$ 74.900** | R$ 26.900 | ~R$ 20.000 |
| AC 22 kW | ⚠️ R$ 1.925 | **R$ 3.490** | R$ 1.565 | ~R$ 1.200 |

Entregue junto, e é o que justifica o preço: **pronta-entrega em 15 dias**, comissionamento remoto
assistido, cadastro na plataforma e **peça de reposição em estoque no Brasil**.

**Por que R$ 54.900 e não R$ 59.000 na mesa:** o carregador de vocês é sem marca e sem histórico
de assistência no país. Empatar com o piso vendendo menos reputação perde a venda; ficar R$ 4 mil
abaixo dá ao comprador uma razão numérica para escolher e ainda deixa R$ 16 mil líquidos por
unidade. **Não vá abaixo disso.** Guerra de preço contra um importador maior é a única briga que
vocês perdem por definição — e o dinheiro desta trilha não está na caixa, está nos 24 meses de
plataforma que saem grudados nela.

**Correção importante no ecossistema:** o Degrau 5 está escrito como **"custo + 12%"**. Aquele
número foi calibrado para *intermediação* — vocês repassavam um pedido e não corriam risco nenhum.
**Com estoque próprio, o risco mudou de mão:** capital, câmbio, obsolescência, garantia e a peça
de reposição são seus. Custo + 12% no 80 kW daria R$ 3.960 de margem por unidade para carregar
tudo isso — e o mercado paga R$ 26 mil de spread. **Preço de estoque é preço de mercado, não
custo mais taxa.**

**As três coisas que este contrato NÃO pode ter** (⚠️ confirmar com advogado — é o que separa
licença de franquia disfarçada, que dispararia a COF obrigatória da Lei 13.966/2019):

- ❌ **exclusividade de território** — não prometa a cidade a ninguém
- ❌ **royalty sobre a obra do parceiro** — vocês cobram plataforma (serviço) e equipamento (produto), nada sobre o faturamento de obra dele
- ❌ **imposição de método e uso da marca IO na fachada** — "Ponto Autorizado" é selo de plataforma, não bandeira

Mantidas essas três negativas, é relação de **fornecimento + SaaS**. Rompida qualquer uma, é franquia
de fato — com COF, balanço e INPI atrás. E as exclusões da Trava 3 continuam valendo por escrito:
**sem ART da IO, sem representação na concessionária, sem garantia de obra.** Garantia é de fábrica.

### Trilha 3 — Rede própria em ponto de terceiro (comodato) · 4 unidades

O ativo fica do investidor, instalado em ponto de terceiro (posto, mercado, hotel), a IO opera,
receita repartida. **É a semente do Degrau 9** — e é o melhor ROI por unidade do container, porque
o ponto paga o equipamento a **custo landed**, não a preço de tabela.

Investimento por ponto: **R$ 33.000** (equip.) + ⚠️ R$ 45.000 (obra a custo) = **R$ 78.000**.
Rodando as premissas do simulador (revenda R$ 2,35/kWh · custo R$ 0,70 · ativação R$ 1,20 ·
gateway 14% · imposto 6% · 20 kWh/recarga · arrendamento 10%):

| Carros/dia | Faturamento/mês | Lucro/mês | Payback | Lucro/ano |
|---|---|---|---|---|
| 3 (pessimista) | R$ 4.338 | R$ 1.399 | **56 meses** | R$ 16.788 |
| 5 (realista hoje) | R$ 7.230 | R$ 2.583 | **30 meses** | R$ 30.996 |
| 10 (cenário do estudo) | R$ 14.460 | R$ 5.544 | **14 meses** | R$ 66.528 |

**Compare a coluna da direita com os R$ 16 mil líquidos da venda de caixa.** A partir de
5 carros/dia, o mesmo carregador rende **em um ano** o que a venda rende **uma vez** — e continua
rendendo. A 3 carros/dia, vender é melhor. **É a ocupação do ponto que decide, e é por isso que a
próxima seção existe.**

**Leia a linha de 3 carros/dia antes de decidir.** Fora de rodovia, no Brasil de 2026, ocupação
abaixo de 5 carros/dia é comum — e a 3 carros/dia o ponto vira ativo de 5 anos. Por isso a Trilha 3
leva **4 unidades e não 12**: ela é a que constrói o ativo estratégico e a prova social, e é
também a única que concentra **risco de ocupação** no investidor. Dose pequena, pontos escolhidos
a dedo (fluxo verificado, não estimado), e expande só depois do primeiro trimestre de dados reais.

### PARTE 4-bis — A ordem de prioridade de cada unidade (a regra que substitui o split fixo)

Com o custo real de R$ 33.000 e o teto de mercado de R$ 59.000, o valor de uma mesma unidade
varia **6×** conforme a porta pela qual ela sai. Não é detalhe de execução — é a decisão econômica
central do container:

| Ordem | Destino da unidade | O que ela vira | Limite |
|---|---|---|---|
| 1º | **Turnkey** dentro do raio | R$ 33 mil viram R$ 144.595 de receita e ⚠️ ~R$ 58 mil de margem pós-imposto | **capacidade de obra** (⚠️ 12/ano) |
| 2º | **Ponto próprio** com ≥5 carros/dia verificados | R$ 31 mil/ano, para sempre, + ativo + prova social | **pontos bons**, não capital |
| 3º | **Ponto Autorizado** (caixa + plataforma 24 m) | ~R$ 16 mil líquidos + assinatura | mercado, e é a válvula de liquidez |
| ❌ | **Caixa avulsa sem plataforma** | ~R$ 16 mil e um concorrente armado | nunca |

**A regra de alocação, e ela vale mais que qualquer split que eu escreva:**

> Enche a capacidade de obra primeiro. Depois, todo ponto com **fluxo verificado** ≥ 5 carros/dia
> vira ponto próprio. O que sobrar vai para venda. **Migre da Trilha 2 para a 3 quando aparecer
> ponto bom — nunca o contrário**, porque vender é irreversível e operar não é.

E ela tem uma consequência desconfortável que muda o **tamanho do pedido**, não só a ordem de
venda. Se o turnkey absorve ⚠️ 6 unidades em 12 meses e os pontos próprios absorvem 4, **as outras
6 unidades de DC dependem inteiramente de a Trilha 2 existir** — e essas 6 prendem ⚠️ R$ 198 mil
do investidor para devolver ⚠️ ~R$ 96 mil em margem. É retorno **próximo do custo de oportunidade**
que a Parte 0 cita, e muito abaixo do que a mesma unidade rende em obra ou num ponto de
5 carros/dia.

> **Portanto: o pedido base é de 10 DC, não 16.** As 6 unidades extras entram **só se a pré-venda
> converter** — sinal pago de 3 compradores. Mesmo teste da Parte 8, default invertido: em vez de
> pedir 16 e rezar, pede 10 e sobe se o mercado responder. Estoque que não gira é o único erro
> deste plano que não tem conserto.

### O split, em uma linha

```
CONTAINER (16 DC + 40 AC)
   │
   ├─ 6 DC  → TURNKEY pronta-entrega (dentro do raio)      margem máxima, giro lento
   ├─ 6 DC  → PONTO AUTORIZADO (fora do raio)              giro rápido, margem boa
   ├─ 40 AC → PONTO AUTORIZADO (condomínio/frota)          40 pontos ativos por 4% do container
   └─ 4 DC  → REDE PRÓPRIA em comodato                     ativo + recorrência + vitrine
                                    │
                    16 PONTOS NA PLATAFORMA (linha de base)
                    + 40 se o canal de AC existir → estágio 2
```

**Extensão obrigatória da Trava 1:** caixa sai **para fora do Triângulo**. Dentro do raio, unidade
só vira **turnkey** ou **ponto operado pela IO** — nunca equipamento avulso. A headline de filtro
da LP (*"não vendemos carregador avulso"*) **fica onde está**; a Trilha 2 vive em página separada,
com público separado, como já manda o Guardrail 6. Vender uma caixa dentro do raio para o primeiro
que aparecer com dinheiro na mão é armar o disputante do ponto da esquina.

---

## PARTE 5 — Como o investidor entra, e como ele sai

O modelo comercial acima só funciona se a estrutura societária não obrigar a IO a comprar o
container. **Ela não deve comprar.**

| Peça | Desenho recomendado | Por que |
|---|---|---|
| **Importação** | CNPJ do investidor ou importadora por conta e ordem, **regime normal** | Portão 2: R$ 287 mil e o teto do Simples |
| **Trilhas 1 e 2** | **Consignação mercantil** — a IO só fatura ao vender, preço fixo por unidade | Zero capital da IO, zero estoque no balanço, upside do investidor preservado |
| **Trilha 3** | **Comodato do equipamento** + repartição de receita do ponto | O ativo continua do investidor; a IO entra com obra, operação e plataforma |
| **Remuneração do investidor** | Preço fixo por unidade consignada + % da receita dos pontos em comodato | Ele escolhe: giro (trading) ou renda (operação) |
| **Saída** | Recompra do estoque remanescente em 24 meses ⚠️ ou conversão em participação nos pontos | Sem cláusula de saída, o investidor não faz a 2ª rodada |

⚠️ **Duas coisas que eu decidi e vocês precisam confirmar:** o prazo de 24 meses da recompra e
se o investidor entra em **SPE própria** para os pontos da Trilha 3 (recomendo que sim — separa
o ativo de recarga do balanço da obra e deixa a bandeira do Degrau 9 nascer limpa).

**Nunca prometa retorno.** Guardrail 1 do ecossistema vale para o investidor também: todo número
deste documento é **simulação com premissas visíveis**, e é assim que ele vai para a mesa.

---

## PARTE 6 — Os 24 meses, e onde a conta quebra

⚠️ Cenário, não previsão. Volumes são premissa minha; a margem do turnkey depende do custo de obra
que vocês têm e eu não.

**Base da coluna de margem: depois do imposto de saída, antes de overhead, comissão de venda e
custo de lead.** Uma base só, para a tabela poder ir à mesa do investidor.

| Trilha | Un | Receita | Margem pós-imposto ⚠️ | Pontos ativos |
|---|---|---|---|---|
| 1 · Turnkey pronta-entrega | 6 | R$ 867.570 | ~R$ 347.000 | 6 |
| 2 · Ponto Autorizado DC (4×80 + 2×120) | 6 | R$ 369.400 | ~R$ 104.000 | 6 |
| 2 · Ponto Autorizado AC | 40 | R$ 139.600 | ~R$ 48.000 | 40 |
| 3 · Rede própria (18 meses médios a 5 carros/dia) | 4 | R$ 186.000 | R$ 186.000 + ativo | 4 |
| Plataforma (comissão) | — | ⚠️ R$ 30.000 | R$ 30.000 | — |
| | | **≈ R$ 1,59 mi** | **≈ R$ 715 mil** | **16 + 40** |

**Como ler o total, sem inflar:** ⚠️ R$ 715 mil de margem sobre ⚠️ R$ 725 mil de container em
24 meses — **o capital do container volta uma vez, em margem, em dois anos**, e ainda sobram
4 pontos operando como ativo. Não é lucro: overhead, comissão de venda e aquisição de lead saem
daí. E não confunda com a receita de R$ 1,59 mi — receita dividida por capital é um múltiplo que
não quer dizer nada.

Pontos ativos: **16 na linha de base**, e os 40 do AC só entram na conta depois que o canal da
Parte 2 for testado — é aí que a bandeira do Degrau 9 fica possível.

**O que os números reais mudaram nesta tabela — e vale ler:** a margem total praticamente não se
moveu (R$ 830 mil → R$ 715 mil), mas **de onde ela vem mudou muito.** O turnkey subiu de R$ 300 mil
para R$ 347 mil (equipamento mais barato do que eu supunha) e a venda de DC caiu de R$ 250 mil para
R$ 104 mil (teto de mercado a R$ 59 mil, que eu supunha ser R$ 90–140 mil). Em uma frase:
**o container vale mais como insumo de obra e de ponto próprio do que como mercadoria.** A Trilha 2
deixou de ser a segunda maior linha e passou a ser o que sempre deveria ter sido — **a válvula de
liquidez e a porta de entrada da plataforma**, não o motor.

**Onde essa conta quebra — os três pontos de ruptura, em ordem de probabilidade:**

1. **A Trilha 2 não vende.** É o risco número um, porque é a trilha que carrega o giro e vocês
   nunca venderam equipamento nacionalmente. **Antídoto barato, e ele tem duas metades:**
   - **DC:** o canal já existe e está pago — a base de leads frios fora do Triângulo, no CRM, que
     hoje é descartada. Pré-venda com sinal para essa base.
   - **AC:** a base fria **não serve** (ela é investidor de eletroposto, não síndico). O teste é
     ligar para **3 administradoras de condomínio** e **2 instaladores locais** e oferecer revenda.

   **Se 3 pessoas pagarem sinal no DC, a Trilha 2 existe. Se nenhuma administradora quiser
   conversar, o AC vira upside e o container precisa de menos wallbox.** Os dois testes custam um
   disparo e cinco ligações — e o resultado tem que estar na mão **antes do pedido**, porque é ele
   que define a composição.
2. **Ocupação abaixo de 3 carros/dia na Trilha 3.** Antídoto: 4 unidades, não 12, e só ponto com
   fluxo verificado.
3. **Falha de campo sem peça.** Antídoto: Portão 3, peças no mesmo container.

---

## PARTE 7 — O que muda nos documentos que já existem

| Documento | Mudança | Gravidade |
|---|---|---|
| `ECOSSISTEMA-ELETROPOSTO.md` · Degrau 5 | **Custo + 12% → preço de mercado.** Cost-plus era para intermediação sem risco; com estoque próprio, o risco é seu | **alta** — reprecificação |
| `ECOSSISTEMA-ELETROPOSTO.md` · Trava 1 | Estender: caixa só fora do raio; dentro, só turnkey ou ponto operado pela IO | alta |
| `ECOSSISTEMA-ELETROPOSTO.md` · Parte 7, perg. 1 e 4 | Metade respondida: equipamento do 80 kW = ⚠️ R$ 37.800. Falta o custo de obra | média — destrava o crédito de upgrade |
| `ARQUITETURA-CONTRATOS` | **Dois instrumentos novos:** ⑦ Fornecimento de Equipamento (venda + garantia de fábrica + exclusão expressa de instalação e de responsabilidade técnica) e ⑧ Comodato de equipamento em ponto de terceiro | alta — hoje não existe papel |
| `ARQUITETURA-CONTRATOS` · ② Operação | Passa a ser **condição do preço** do equipamento, com claw-back. A pergunta 0 (o contrato do fornecedor da plataforma permite vender para ponto que não é obra de vocês?) **agora bloqueia 46 das 56 unidades**, não só o contrato de operação | **crítica** |
| LP `/io/eletroposto` | Nada. Headline de filtro fica. Trilha 2 é página nova, público novo | — |

> 🚧 **A leitura de 20 minutos que trava o plano inteiro.** A pergunta 3 da Parte 7 está aberta
> desde 30/jul: *o contrato com o fornecedor da plataforma permite vender para ponto que não foi
> obra de vocês?* Se a resposta for **não**, a Trilha 2 não pode acoplar plataforma — e sem
> plataforma acoplada ela é venda de caixa, que este documento descarta. **Leia o contrato do
> fornecedor antes de fechar o pedido do container**, não depois.

---

## PARTE 8 — Sequência de execução

**Antes do pedido (esta semana)**
1. Mandar a tabela do **Portão 1** ao fornecedor e exigir os laudos IEC em PDF. Sem OCPP aberto, não fecha.
2. **Portão 2** com o contador: importador em regime normal, nunca o Simples da IO.
3. Ler o **contrato do fornecedor da plataforma** (20 min) — a pergunta que bloqueia 46 unidades.
4. Fechar **peças de reposição no mesmo pedido** (8–12%).
5. **Os dois testes de canal, antes de definir a composição:** pré-venda com sinal na base fria
   (DC) e cinco ligações para administradoras/instaladores (AC). São eles que dizem quantos DC e
   quantos AC pedir — rodar depois do pedido é descobrir tarde.
6. Definir a **composição** (DC/AC) — é a decisão mais alavancada do pedido, e ela vem do item 5.

**Enquanto o container navega (30–45 dias)**
7. Página da Trilha 2 (separada da LP do turnkey) + checkout de sinal.
8. Minutas ⑦ e ⑧ com advogado, junto do contrato de consignação com o investidor.
9. Escolher os 4 pontos da Trilha 3 com **fluxo verificado**, não estimado.

**Container no pátio**
10. Comissionar 1 unidade AC e 1 DC no galpão e **provar o OCPP ponta a ponta** antes de qualquer entrega.
11. Trilha 1 e 2 começam no mesmo dia; Trilha 3 depois do primeiro comissionamento validado.

---

## PARTE 9 — Guardrails

1. **O carregador nunca sai sozinho.** Sem contrato de plataforma assinado, não sai do galpão.
2. **Caixa só fora do Triângulo.** Sem exceção, e sem estender esse direito a quem comprou Raio-X.
3. **Estoque é prêmio, não desconto.** Pronta-entrega em 15 dias se cobra, não se desconta.
4. **Nenhuma promessa de rendimento** — nem para cliente, nem para o investidor.
5. **Sem exclusividade territorial e sem royalty sobre obra de parceiro** — é o que separa licença de franquia disfarçada.
6. **Nenhuma unidade instalada sem peça de reposição em estoque** para aquele modelo.
7. **Nenhuma minuta vai a cliente ou investidor sem advogado.**

---

## PARTE 10 — ⚠️ O que preciso de vocês

| # | Pergunta | Trava o quê |
|---|---|---|
| 1 | **Ficha técnica real das unidades** (OCPP? CCS2? 60 Hz? backend aberto?) | Portão 1 — se falhar, o plano muda de modelo |
| 2 | **Fatura/FOB real, quantidades e composição do container** | Toda a Parte 2 e a Parte 6 |
| 3 | **Custo real da obra do 80 kW** (padrão, trafo, civil, projeto, ART) | Fecha a margem do turnkey e libera o crédito de upgrade |
| 4 | **Quem vai importar, e em qual regime** — e a conta do contador: **tributo total por unidade**, da importação até a venda, nos dois regimes | Portão 2 — o sublimite do Simples e o preço final da Trilha 2 |
| 4b | **Quantos turnkeys vocês fecham por ano, de verdade** (pergunta 2 da Parte 7, aberta desde 30/jul) | É a viga da Parte 0. Se forem 24/ano e não 12, o split 6/6+40/4 muda |
| 5 | **O contrato do fornecedor da plataforma permite ponto de terceiro?** | 46 das 56 unidades |
| 6 | **O investidor quer giro ou renda?** | Define o tamanho da Trilha 3 e a cláusula de saída |
| 7 | **Quantos eletropostos já entregues e rodando?** | Prova social da Trilha 2 e a COF do mês 12+ |
| 8 | **Os R$ 59 mil são que tipo de preço?** Preço de venda a cliente, custo de outro importador, ou proposta pontual? **E qual o preço de mercado do 120 kW?** | É a pergunta mais barata e a que mais mexe: se for atacado/custo, R$ 54.900 joga metade do spread fora. E R$ 74.900 no 120 kW é regra de três em cima de um único dado — 2 das 6 unidades da Trilha 2 são 120 |
| 8b | **O que é o carregador de R$ 59 mil?** Marca, garantia, assistência no Brasil, OCPP aberto ou preso | Se for marca com assistência, R$ 54.900 não basta; se for outro sem-marca importado, já ganha |
| 9 | **O R$ 33.000 é com ou sem crédito de ICMS/PIS/COFINS?** | ⚠️ R$ 11 mil por unidade = 43% do spread da Trilha 2 |

**Decisões que eu tomei e vocês podem derrubar:** a ordem de prioridade da Parte 4-bis
(obra → ponto próprio → venda) · os preços da Trilha 2 (R$ 54.900 / R$ 74.900 / R$ 3.490) ·
o piso de R$ 54.900, do qual eu não desceria · o corte de 5 carros/dia verificados para aprovar
ponto próprio · consignação em vez de compra · recompra em 24 meses · SPE separada para os pontos
da Trilha 3.

---

## Fontes

- INMETRO — [carregadores de VE estão dispensados de certificação obrigatória (Portaria 148/2022)](https://www.gov.br/inmetro/pt-br/acesso-a-informacao/perguntas-frequentes/avaliacao-da-conformidade/aparelhos-eletrodomesticos-e-similares/carregadores-de-veiculos-eletricos-estao-no-escopo-da-portaria-inmetro-ndeg-148-de-2022-carregadores-de-veiculos-eletricos-devem-ser-certificados)
- [Regulamentação em construção — comissão iniciada em abril/2026](https://evowatt.com.br/novas-regras-recarga-carro-eletrico/)
- Certificações voluntárias já obtidas: [WEG](https://www.weg.net/institutional/BR/en/news/products-and-solutions/weg-achieves-unprecedented-certification-for-electric-vehicle-charging-stations) · [Intelbras](https://canalve.com.br/carregadores-intelbras-recebem-certificacao-carros-eletricos/) · [E-Wolf](https://abve.org.br/e-wolf-conquista-certificacao-inmetro-para-toda-linha-de-carregadores-de-veiculos-eletricos/) · [Livoltek](https://diariodotransporte.com.br/2026/04/06/livoltek-obtem-certificacao-do-inmetro-para-carregadores-eletricos-e-reforca-presenca-no-brasil/)
- Carga tributária de importação (NCM 8504.40) — [Remessa Online](https://www.remessaonline.com.br/blog/importar-carregador-de-carro-eletrico/) · [Tradexa](https://www.tradexa.com.br/blog/importacao-veiculos-eletricos-brasil)
- Premissas financeiras e configurações: simulador da LP `/io/eletroposto` (`CONFIGS`, `params()`) e `ECOSSISTEMA-ELETROPOSTO.md`

*Documento vivo. Nenhum número marcado ⚠️ vai para investidor ou cliente sem ser substituído pelo real.*
