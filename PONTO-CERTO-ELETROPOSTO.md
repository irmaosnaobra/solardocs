# O ponto certo — como olhar um local e dizer sim ou não
### Manual de escolha e vistoria de ponto · Irmãos na Obra · 30/ago/2026

> **Por que este capítulo existe.** A tese do dono: *"a dor desse cliente não é dinheiro. É entrar
> no mercado, ter o ponto correto, e saber como estruturar esse contrato e o fechamento."* Os
> números do funil dizem o mesmo com outras palavras — investidor converte **5,4%** das reuniões em
> proposta, quem tem negócio próprio com fluxo na porta converte **16,8%**, e dar um ponto ao
> investidor não salva o perfil (**6%**). Na base há **122 pessoas com capital declarado e nenhum
> local**, contra **um** dono de ponto cadastrado. O gargalo do negócio inteiro é ponto.
>
> **O que este documento é:** o critério. Ele ensina a olhar um local, na ordem em que a coisa é
> decidida na vida real, e sair de lá com um sim, um não, ou uma conta a pedir. Termina em duas
> ferramentas fechadas: uma **ficha de vistoria** para levar no celular e um **placar** que fecha a
> nota do local.
>
> **De onde veio cada número:**
> - Configurações, preços, capacidade e teto de carros/dia: `CONFIGS` do simulador em
>   `dashboard/public/io/eletroposto/index.html`
> - Régua de recarga (20 kWh), janela de 12 h, tabela de carros e potência DC aceita: mesmo arquivo
> - Faixas de ligação, disjuntor, consumo, vagas e movimento: formulário de
>   `/io/eletroposto/parceria` — **reaproveitadas de propósito**, para o dado de campo cair na mesma
>   forma do cadastro
> - Corte de ponto próprio (29/08/2026): `SEM_LOCAL` e `SEM_CONTROLE` do `pontuar()` da LP
> - Quem paga o quê quando a rede exige obra: Cláusulas 2.1.I, 7.1, 7.3 e 7.4 do
>   `CONTRATO-ELETROPOSTO.md`
>
> **⚠️ = decisão minha, não do Thiago.** Toda marca dessas é um número que eu arbitrei para o texto
> fechar, e que muda o resultado. Tabela completa e fechada no fim — uma linha por ⚠️.
>
> **PONTO PARA O ADVOGADO** marca onde a regra jurídica ou regulatória decide e eu não tenho
> certeza de que ela se aplica assim. Nenhum desses vira promessa a cliente antes de confirmação.

---

## 0. A ordem — e por que ela é essa

A ordem certa não é a ordem do interesse. É **custo de descobrir × poder de matar**: começa pelo que
custa nada e mata tudo, termina pelo que exige ir até lá.

| # | O que se olha | Custo de descobrir | Poder de matar |
|---|---|---|---|
| 0 | **O local é seu?** | 1 pergunta | Mata tudo |
| 1 | **Energia** | A conta de luz + 1 foto do disjuntor | Mata, ou põe preço |
| 2 | **Concessionária da região** | A conta diz qual é; a NDU é pública | Põe preço e **calendário** |
| 3 | **Fluxo e permanência** | 3 contagens de 20 min | Decide o faturamento |
| 4 | **Visibilidade e acesso** | Visita | Decide quanto do fluxo vira cliente |
| 5 | **Vaga e manobra** | Mesma visita | Mata (sem vaga dedicada não há ponto) |
| 6 | **Segurança e horário** | Mesma visita + 1 pergunta | Corta o teto de carros/dia |

Os passos 0, 1 e 2 se resolvem **sem sair de casa**. Só se gasta sola de sapato depois deles. É essa
inversão que faz a diferença para quem tem capital e nenhum local: dá para descartar dez endereços
por WhatsApp antes de visitar o primeiro.

---

## 1. PASSO 0 — O local é seu?

**Esta é a pergunta que vem antes de todas as outras, e ela já está em produção.** Desde 29/08/2026 a
LP corta da agenda quem não tem o ponto sob controle. A régua tem dois lados:

**Estágio do ponto** (`SEM_LOCAL`) — só passa *"já tenho o ponto definido"*. Caem:
*não tenho ideia de onde instalar*, *tenho um local em vista mas ainda não conversei*, e — desde
29/08 — *tenho um local em negociação com o proprietário*.

**Relação com o imóvel** (`SEM_CONTROLE`) — passam **proprietário, quem administra, quem representa
o proprietário e o inquilino**. Cai *"ainda não é meu — pretendo alugar ou comprar"*.

> **Por quê:** conversa não é ponto. Sem endereço definitivo não há o que estudar, dimensionar,
> orçar nem protocolar. E a Cláusula 4.1.II do contrato turnkey exige que o CONTRATANTE **comprove
> legitimidade sobre o imóvel** — sendo locado, com **anuência escrita do proprietário**. Quem não
> passa aqui não é um mau cliente: é um cliente de outro produto. Ele vai para
> `/io/eletroposto/parceria` e para o cadastro de pontos.

**Para o investidor sem local, esta seção inverte:** ele não responde a pergunta, ele **vai atrás da
resposta**. O que ele precisa levar do dono do imóvel, por escrito, antes de gastar um dia com o
local, é isto:

- [ ] Quem é o proprietário de fato (matrícula ou IPTU no nome)
- [ ] Se o imóvel está alugado — e, se estiver, se o locador autoriza obra fixa no pátio
- [ ] Se há condomínio, shopping, administradora ou órgão público no meio
- [ ] Se o proprietário aceita **arrendar a vaga** e sob qual forma de remuneração

> A última linha é o instrumento ⑥ da `ARQUITETURA-CONTRATOS-ELETROPOSTO.md` — o Contrato de
> Arrendamento / Corretagem do ponto, que ainda não foi escrito. O desenho já decidido lá é
> **percentual sobre o faturamento do ponto**, e o simulador usa **10%** nessa hipótese. Enquanto
> esse contrato não existir, o investidor está negociando no fio da palavra.

---

## 2. PASSO 1 — Energia

É aqui que os projetos morrem, e é a informação que quase ninguém traz. Ela é **gratuita de obter**:
está impressa na conta de luz e gravada no disjuntor.

### 2.1 Quanto o carregador puxa

A corrente da entrada não é opinião, é conta:

```
I  =  P  ÷  (√3 × V × η)
```

Com **380 V trifásico** e rendimento de 0,95:

| Configuração | Potência | Corrente aproximada em 380 V | Em 220 V trifásico |
|---|---|---|---|
| 60 kW · 2 bicos | 60 kW | **~96 A** | ~166 A |
| 80 kW · 2 bicos *(a recomendada na LP)* | 80 kW | **~128 A** | ~221 A |
| 120 kW · 2 bicos | 120 kW | **~192 A** | ~332 A |
| 160 kW · 2 bicos | 160 kW | **~256 A** | ~443 A |

Duas leituras que decidem sozinhas:

**A tensão dobra a conta.** O mesmo carregador de 80 kW pede ~128 A numa rede de 380 V e ~221 A numa
de 220 V. A tensão de fornecimento em baixa tensão é da distribuidora e da região — está na conta.
Perguntar "é trifásica?" sem perguntar "em que tensão?" deixa metade da resposta em cima da mesa.

**Nenhuma dessas correntes cabe num padrão residencial.** A faixa mais alta que o formulário de
parceria oferece hoje é *"acima de 100 A"* — e ela **não distingue** um padrão de 100 A (que não
aguenta o 80 kW) de um de 200 A (que aguenta). Para o lead que se auto-declara, a faixa serve. Para
a vistoria, não: por isso a ficha do capítulo 9 quebra essa faixa em três. É a **única** diferença
proposital entre as duas réguas.

> ⚠️ O rendimento de 0,95 é premissa minha para a ordem de grandeza. **A corrente real de entrada
> está na ficha técnica do modelo** (fator de potência e rendimento variam por fabricante) e é ela
> que o projeto usa. Confirmar com o fornecedor do carregador antes de qualquer promessa de "cabe no
> seu padrão".

### 2.2 A régua dos 75 kW — e o que ela faz com a escolha da configuração

Existe no Brasil uma régua clássica: **unidade consumidora com carga instalada acima de 75 kW é
atendida em tensão primária** — média tensão, Grupo A, com transformador e medição próprios. Passe a
régua na tabela de configurações:

| Configuração | Só o carregador | Fica abaixo de 75 kW? |
|---|---|---|
| 60 kW | 60 kW | **Sim** |
| 80 kW | 80 kW | Não |
| 120 kW | 120 kW | Não |
| 160 kW | 160 kW | Não |

**A configuração que a LP recomenda "para a maioria dos pontos" estoura a régua sozinha**, antes de
somar qualquer carga que o imóvel já tenha. E a carga é **cumulativa**: um mercado com 40 kW
instalados mais um carregador de 60 kW já são 100 kW — o 60 kW também estoura, nesse ponto.

**PONTO PARA O ADVOGADO** — a régua dos 75 kW é a que se usa no mercado, mas *como cada
distribuidora conta a carga instalada de um carregador DC* (placa nominal, demanda declarada, com ou
sem fator de simultaneidade) está na **NDU/NT dela**, não em regra geral. Risco de errar aqui: dizer
"seu ponto continua em baixa tensão" e o parecer voltar exigindo subestação — que é o item 2.1.I do
contrato, fora do escopo e por conta do cliente.

#### A consequência comercial, que é maior do que parece

A diferença de preço entre as duas primeiras configurações é de **R$ 2.922** (R$ 144.595 − R$
141.673) — **2%**. E o simulador da própria casa mostra o seguinte, com as premissas dele (revenda
R$ 2,35/kWh, custo R$ 0,70/kWh, 20 kWh por recarga, ativação R$ 1,20):

| Cenário | Faturamento/mês | Lucro/mês | Payback |
|---|---|---|---|
| 80 kW · 10 carros/dia *(o padrão da LP)* | R$ 14.460 | R$ 6.933 | 2,3 anos |
| **60 kW · 10 carros/dia** | R$ 14.460 | **R$ 6.935** | **2,2 anos** |
| 60 kW · 8 carros/dia *(a base do 60 kW)* | R$ 11.568 | R$ 5.465 | 2,7 anos |

Leia a linha do meio devagar. **Abaixo de 20 carros por dia, o 60 kW fatura exatamente o mesmo que o
80 kW** — porque o faturamento do simulador é carros × 20 kWh, e não depende da potência. O 60 kW
paga até um pouco mais rápido, por custar R$ 2.922 menos.

O que a potência a mais compra, então, não é faturamento: é **teto** (20 → 30 carros/dia) e
**simultaneidade** (item 4.2). Se o 80 kW empurrar o ponto para média tensão e o 60 kW não, a conta
inverte de vez:

> Nas mesmas premissas, o 80 kW só continua pagando mais rápido que o 60 kW enquanto a entrada de
> energia que ele exige custar **menos de ~R$ 35,8 mil** a mais que a do 60 kW. *(É o valor que
> empata os paybacks: R$ 180.397 de lucro acumulado do 80 kW em 2,7 anos, menos os R$ 144.595 do
> equipamento.)*

**Ou seja: quem escolhe a configuração é a entrada de energia, não o preço da máquina.** Numa
vistoria, essa é a informação que vale mais dinheiro.

> ⚠️ **Ressalva honesta:** o simulador não modela fila. Um ponto que faria 25 carros/dia num 80 kW
> perde carros num 60 kW (teto 20) e o simulador não mostra essa perda. A comparação acima vale para
> pontos cujo fluxo estimado fica **dentro do teto do 60 kW**. Acima disso a conta muda e ela é do
> Estudo de Viabilidade, não deste capítulo.

### 2.3 O que sobra do padrão — que não é o número do disjuntor

O disjuntor geral diz o **teto**. Não diz o que sobra. O que interessa é:

```
carga disponível  =  capacidade do padrão  −  o que o estabelecimento já usa no pico
```

Um posto de combustível com 200 A de padrão e bombas, compressor e câmara fria rodando não tem 200 A
livres às 18h. O que a vistoria coleta:

| O que se mede | Onde está | Por que importa |
|---|---|---|
| Tipo de ligação e tensão | Conta de luz, 1ª página | Define a corrente (item 2.1) |
| Disjuntor geral, em amperes | Número gravado no disjuntor, dentro da caixa do relógio | É o teto físico do padrão |
| Consumo mensal em kWh | Conta de luz | Aproxima o quanto do padrão já está em uso |
| Demanda contratada em kW | Conta de luz **só se for Grupo A** | Se existe, o ponto já está em MT — meio caminho andado |
| Existe geração solar no local? | Conta (compensação) ou o inversor no local | Muda a conta de energia e pode já ter trazido reforço de padrão |

> A última linha é o casamento que a casa já conhece: **a geração é o combustível**. Ponto que já tem
> solar instalado costuma ter padrão reforçado e conta baixa — dois problemas resolvidos de graça. É
> a pergunta mais barata da ficha e ninguém faz.

### 2.4 A distância até a vaga

Entre o padrão e a vaga do carregador existe vala e cabo. Cabo de 128 A não é cabo de tomada, e a
vala atravessa o pátio de alguém.

Eletricamente a distância aguenta mais do que o bolso: a queda de tensão só aperta em percursos
longos, e quem fecha esse cálculo é o projeto. **Comercialmente**, a distância vira metro de vala,
metro de cabo, corte e recomposição de piso — e é um item que não aparece no preço de tabela.

| Distância padrão → vaga | Leitura | ⚠️ |
|---|---|---|
| até 30 m | Não muda a conversa | ⚠️ |
| 30 a 80 m | Entra no orçamento e ainda fecha | ⚠️ |
| 80 a 150 m | Pesa; pede reavaliação da posição da vaga | ⚠️ |
| acima de 150 m | Quase sempre compensa levar a **entrada** para perto do carregador, em vez do cabo até ele | ⚠️ |

> ⚠️ **Estas quatro faixas são minhas.** Nenhum arquivo da casa tem número de distância. O que elas
> mudam: a faixa é o que decide se a vistoria já anota "cabe no padrão da obra" ou "abre item
> separado no Anexo I". Se o Thiago cravar outras, é trocar a tabela e a ficha — o resto do capítulo
> não muda.

### 2.5 O que custa aumentar carga

**Não existe número da casa para isto, e a LP diz o mesmo com todas as letras:** *"Adequação do
padrão de entrada e eventual transformador dedicado são orçados após a visita técnica."* O que se
sabe com certeza é **quem paga** e **em que ordem**:

| Forma de resolver | Quem executa | Quem paga | Onde está escrito |
|---|---|---|---|
| Trocar disjuntor / caixa / ramal de entrada | A obra da IO | Está no escopo **se estiver no Anexo I** | Cl. 1.3.I |
| Transformador dedicado + nicho | A obra da IO | **Orçado após a visita** — item separado | LP, letra miúda do simulador |
| Reforço, extensão de rede, entrada em MT, subestação | **A distribuidora** | **CONTRATANTE**, notificado com orçamento antes de qualquer execução | Cl. 2.1.I e Cl. 7.3 |

E o desfecho quando não tem jeito: **parecer definitivamente negado por inviabilidade técnica do
local, ou custo de reforço recusado por escrito pelo cliente — o contrato se resolve** (Cl. 7.4),
devolvendo os valores com retenção do custo comprovado de projeto, ART e protocolo. É a saída
prevista, e é por isso que descobrir energia **antes** vale tanto: depois de assinado, a descoberta
custa a ART e o projeto.

> ⚠️ A alternativa da Cl. 7.5 — converter a retenção em **crédito** para outro local em até 12 meses
> — está aberta desde a v1 do contrato. Para o público investidor ela é forte: transforma um "não"
> técnico em "vamos achar outro ponto". Para o caixa, é mais caro de honrar. É decisão do dono, e
> ela muda a conversa desta seção inteira.

### 2.6 O buraco: o simulador não tem demanda contratada

Isto é uma constatação de arquivo, não uma opinião. As despesas fixas do simulador são
`assinat: 0`, `fixos: 300` (software e 4G) e o seguro de 1% ao ano sobre o investimento. **Não há
linha de demanda contratada.**

Se o ponto for para média tensão — o que as configurações de 80 kW para cima empurram —, ele entra
no Grupo A e passa a pagar um valor **fixo mensal por kW de demanda contratada**, chovendo ou
fazendo sol, com ou sem carro no bico. Ir para MT custa dinheiro **duas vezes**: uma na obra de
entrada, e outra todo mês. **A segunda não está na conta que o cliente vê na LP.**

> ⚠️ **Decisão do dono:** o Estudo de Viabilidade passa a trazer a linha de demanda contratada
> quando o ponto for Grupo A? Se sim, o payback de todo cenário em MT sobe — e a vantagem do 60 kW
> em baixa tensão (item 2.2) fica ainda maior do que a tabela mostra.

---

## 3. PASSO 2 — A concessionária da região

A distribuidora não escolhe se o projeto acontece. Ela escolhe **quanto custa e quando**.

**O que se resolve sem sair de casa:**

1. **Qual é a distribuidora** — está impressa na conta de luz, ao lado da unidade consumidora.
2. **A NDU / norma de fornecimento dela** — é pública. É esse documento, e não uma regra geral, que
   responde: até que carga se atende em BT, o que exige MT, como se mede, o que é padrão de entrada
   aceito e o que é participação financeira do consumidor.
3. **A tensão de fornecimento da região** — muda a corrente pela metade ou pelo dobro (item 2.1).

**O que a concessionária custa em calendário, e não em dinheiro:** o contrato já reconhece que o
prazo de análise entre o protocolo e a decisão sobre o parecer **não corre contra a IO** (Cl. 6.2.I)
e que uma suspensão acima de **180 dias** dá a qualquer das partes o direito de resolver o contrato
(Cl. 6.4). Traduzindo para a vistoria: **um ponto tecnicamente bom numa região onde a distribuidora
demora seis meses é um ponto que trava caixa.** Isso pertence à ficha.

E a divisão de responsabilidade, que é o que protege a IO na hora da conversa difícil: a CONTRATADA
responde pela **elaboração técnica correta e pelo protocolo tempestivo**; a **decisão** é ato de
terceiro e não é obrigação de resultado (Cl. 7.1). Se a exigência vier por erro de projeto ou
dimensionamento da IO, a reapresentação é **sem custo** ao cliente (Cl. 7.2).

**PONTO PARA O ADVOGADO** — há prazo regulatório para a distribuidora responder ao pedido de acesso,
e ele é o que permitiria cobrar. Eu não tenho certeza do número de dias nem de qual faixa de carga
ele cobre. Risco de errar: prometer prazo ao cliente que a IO não pode exigir da distribuidora.

> **Nota de casa:** a `ARQUITETURA-CONTRATOS-ELETROPOSTO.md` registra que a **CEMIG** publicou uma
> minuta de cooperação específica para eletropostos, e é ela que serve de esqueleto do contrato de
> arrendamento (instrumento ⑥). Vale conferir se a distribuidora da região do ponto tem instrumento
> equivalente — quando tem, o caminho é mais curto.

---

## 4. PASSO 3 — Fluxo e permanência

**Recarga é tempo, não é abastecer.** Um tanque enche em 4 minutos e o motorista fica ao lado da
bomba. Uma recarga de 20 kWh leva de 15 a 40 minutos e o motorista **vai embora do carro**. Isso
inverte o que faz um ponto bom: não basta passar carro na frente, tem que haver **onde o motorista
ficar** naquela janela.

### 4.1 A conta da rotatividade — de onde sai o teto de carros/dia

O simulador conta assim, e a régua é dele: **20 kWh por recarga**, deliberadamente conservadora (uma
carga de 20% a 80% nos carros da lista entrega de 16 a 50 kWh, e o mais vendido do país entrega 22,8
kWh). Divide-se pela potência, e no pior caso — **os dois bicos ocupados** — cada carro recebe
metade. A janela de movimento considerada é de **12 horas**.

| Configuração | 1 bico ocupado | 2 bicos ocupados | Capacidade calculada | Teto anunciado |
|---|---|---|---|---|
| 60 kW · 2 bicos | 20 min | 40 min | 36 carros/dia | **20** |
| 80 kW · 2 bicos | 15 min | 30 min | 48 carros/dia | **30** |
| 120 kW · 2 bicos | 10 min | 20 min | 72 carros/dia | **40** |
| 160 kW · 2 bicos | 7,5 min | 15 min | 96 carros/dia | **50** |

O teto anunciado é **sempre menor** que a capacidade calculada, de propósito. Capacidade não é
previsão de movimento — quem estima quantos carros param no ponto é quem conhece o ponto.

### 4.2 O teto do carro — 94% da frota da lista não usa potência acima de 70 kW

A tabela de veículos da LP traz os dez elétricos mais vendidos, com a potência máxima que cada um
**aceita** em corrente contínua. Somando os volumes:

| Faixa de potência DC aceita | Modelos | Volume | % da lista |
|---|---|---|---|
| Até 70 kW | Dolphin Mini (40), Dolphin (60), EX2 (70), Spark EUV (50), Yuan Pro (60), Ora 03 (64) | 76.866 | **94,4%** |
| 100 kW ou mais | EX5 (100), Captiva EV (120), EX30 (150), Aion V (180) | 4.586 | 5,6% |

**Quando o carro é o gargalo, potência a mais não encurta nada.** O Dolphin Mini — 35.680 unidades,
o mais vendido da lista — aceita 40 kW e leva **36 minutos** de 20% a 80% num carregador de 80 kW.
No de 160 kW leva os mesmos 36 minutos.

Então potência acima de 80 kW **não compra velocidade**: compra **simultaneidade**. Num 80 kW com os
dois bicos ocupados, cada carro recebe 40 kW e um Dolphin (que aceita 60) é freado. Num 160 kW com
os dois ocupados, cada um recebe 80 kW e ninguém do top 6 é freado. Isso só vale dinheiro num ponto
que realmente enche os dois bicos ao mesmo tempo — o que **volta a ser uma pergunta sobre o fluxo do
local**, não sobre a máquina.

### 4.3 A janela de permanência — o critério que o perfil esconde

A permanência natural do local tem que **casar** com a janela de recarga. Curta demais e o motorista
não espera; longa demais e o bico fica preso sem faturar mais por isso.

| Permanência natural | Exemplos | Leitura |
|---|---|---|
| Menos de 15 min | Farmácia, padaria, lotérica | **Curta demais.** O motorista não para |
| 20 a 60 min | Posto com conveniência, mercado, atacado, restaurante rápido, estacionamento rotativo | **A janela certa.** O carro carrega enquanto a pessoa faz o que veio fazer |
| 60 a 120 min | Academia, restaurante de almoço, shopping | Bico preso. Fatura uma recarga onde caberiam duas |
| Pernoite | Hotel, condomínio | **Recarga rápida é o produto errado.** Quem dorme ali não precisa de DC |

> **Cuidado com os pesos da LP.** O `PESO_PERFIL` dá 3 pontos a hotel e 2 a academia. Ele está certo
> no que mede — **quem compra o eletroposto** —, e hotel é um comprador melhor que academia. Mas ele
> **não mede se o ponto presta**: para recarga rápida DC, pernoite é a permanência errada. Estas são
> duas réguas diferentes, e confundir as duas é o erro que este capítulo existe para não deixar
> acontecer. Ver o capítulo 11.

### 4.4 Como contar — porque "movimento bom" não é medida

A ficha exige **número**, não adjetivo. O método:

- **Três janelas de 20 minutos**, em horários diferentes do mesmo dia útil: manhã (7h–9h), meio da
  tarde (14h–16h) e fim de tarde (17h–19h).
- **Mais uma janela de 20 minutos no sábado**, no horário de pico do local.
- Conta-se o que interessa ao tipo de ponto:
  - Ponto de **rota / avenida**: veículos que **passam** no sentido de acesso ao local
  - Ponto de **movimento próprio** (mercado, posto, estacionamento): veículos que **entram** no
    estabelecimento
- Registra-se o número bruto e o horário. Nada de estimativa.

> ⚠️ **A contagem não vira carros/dia sozinha.** Transformar "passam 400 carros/hora" em "vão parar
> X elétricos por dia" exige uma taxa de conversão que **não existe em arquivo nenhum da casa** — e
> os números de mercado da LP (167.026 plug-in no 1º semestre de 2026, 17,6% dos carros novos
> vendidos na 1ª quinzena de julho) são de **venda de veículo novo**, não de frota circulando numa
> rua. Usar um como o outro seria mentir com número verdadeiro. A ficha registra o bruto; quem
> converte é o Estudo de Viabilidade, na reunião. **Decisão do dono:** cravar essa taxa, ou manter a
> conversão caso a caso no estudo.

---

## 5. PASSO 4 — Visibilidade e acesso

O motorista elétrico chega ao ponto pelo aplicativo — mas decide entrar pelo que vê. E o que ele
mais evita é **manobra**.

| O que se mede | Corte objetivo | Por quê |
|---|---|---|
| **Visibilidade da via** | O carregador (ou a sinalização dele) é visível a pelo menos 50 m, em quantos sentidos de tráfego? | Ponto que só aparece depois da entrada perde a decisão. Em via de mão dupla, ser visto nos dois sentidos dobra o alcance |
| **Entrada direta** | Dá para entrar sem retorno, sem conversão à esquerda em via movimentada e sem cruzar canteiro? | Retorno de 800 m mata um ponto tecnicamente perfeito. É o item que mais some da vistoria e mais aparece depois |
| **Iluminação da fachada e da entrada** | A entrada é reconhecível à noite? | Metade da janela de 12 h é depois das 18 h |
| **Sinalização permitida** | Pode-se instalar totem, placa ou pintura de solo? Precisa de autorização de condomínio, shopping ou prefeitura? | O ponto invisível depende só do app; o sinalizado captura quem passa |
| **Concorrência no raio** | Quantos pontos públicos existem no raio de 5 km, e de que potência? | Não é veto — é o que decide se o ponto compete por preço ou por conveniência |

> Alvará, licença municipal e aprovação de corpo de bombeiros **não estão no escopo do turnkey**
> (Cl. 2.1.II). Se a sinalização ou a cobertura exigirem licença, ela é do cliente. Anotar na
> vistoria evita a discussão na obra.

---

## 6. PASSO 5 — Vaga e manobra

Todas as configurações da linha têm **2 bicos**. Um carregador de 2 bicos sem 2 vagas é um
carregador de 1 bico com o dobro do preço.

| O que se mede | Corte objetivo | Por quê |
|---|---|---|
| **Vagas dedicáveis** | 2 vagas que possam ficar **exclusivas** do carregador | Sem exclusividade, o carro comum estaciona ali e o ponto para. É trava, não desconto |
| **Distância bico ↔ vaga** | O cabo alcança a tomada dos dois lados do carro, sem esticar? | A tomada fica à frente, atrás, à esquerda ou à direita dependendo do modelo. Vaga apertada obriga o motorista a entrar de ré |
| **Manobra de entrada e saída** | Um SUV entra e sai sem manobra em três tempos? | Manobra difícil derruba a recompra do mesmo motorista |
| **Piso** | Concreto/asfalto firme, com escoamento? | A base e a ancoragem do equipamento são obra (Cl. 1.3.III); pavimentação **não é** (Cl. 2.1.III) |
| **Proteção física** | Cabe balizador, meio-fio ou defensa entre a vaga e o equipamento? | Um toque de para-choque no gabinete não é garantia (Cl. 11.5 exclui acidente) |
| **Cobertura** | Existe, ou é orçamento à parte? | Canópia e cobertura estão **fora do escopo** (Cl. 2.1.III) |
| **Acessibilidade** | A vaga e o percurso atendem exigência de acessibilidade? | Depende do tipo de estabelecimento — **PONTO PARA O ADVOGADO** |

**PONTO PARA O ADVOGADO** — se um eletroposto aberto ao público tem exigência própria de vaga
acessível, e de quem é a obrigação (do imóvel ou da estação), é regra que varia por município e por
tipo de edificação. Risco de errar: entregar a obra e receber exigência do município depois do
comissionamento.

> ⚠️ **Decisão do dono:** o mínimo é 2 vagas dedicadas, ou a IO aceita fechar um ponto com 1 vaga
> exclusiva e 1 compartilhada? O que isso muda: com 1 vaga, o teto de carros/dia da configuração cai
> pela metade — e todo payback do simulador é calculado sobre os 2 bicos.

---

## 7. PASSO 6 — Segurança e horário de funcionamento

### 7.1 O horário é um teto de faturamento

Isto sai da matemática da própria casa. A capacidade anunciada de cada configuração pressupõe uma
**janela de 12 horas**. Refazendo a conta com janelas menores, o teto anunciado deixa de se
sustentar por volta das **8 horas de acesso público diário** — abaixo disso, o gargalo do ponto
passa a ser o portão, não a máquina.

| Horas de acesso público | Leitura |
|---|---|
| 24 h | Captura a rota noturna. Exige iluminação e câmera |
| 12 h ou mais | É a premissa do simulador. Sustenta o teto anunciado |
| 8 a 12 h | Sustenta o teto, mas perde o fim da tarde e a noite |
| Menos de 8 h | **O portão vira o gargalo.** O teto da configuração não se sustenta |

A pergunta da ficha não é "que horas o local abre?". É **"que horas o carregador fica acessível a
quem não é cliente do local?"** — que é diferente, e é a que vale.

### 7.2 Segurança

| O que se mede | Corte objetivo | Por quê |
|---|---|---|
| **Iluminação sobre a vaga** | A vaga é utilizável à noite sem lanterna de celular? | Sem luz, o ponto perde metade da janela |
| **Câmera cobrindo o equipamento** | Existe, e a imagem cobre o gabinete e o cabo? | Furto e vandalismo **não têm cobertura de garantia** (Cl. 11.5) |
| **Presença humana no entorno** | Há alguém no local durante o horário de acesso? | Não precisa de funcionário para operar (a operação roda pelo app), mas ponto ermo à noite muda o risco |
| **Seguro do ativo** | O cliente vai contratar? | É **de contratação recomendada e por conta do CONTRATANTE** (Cl. 15.3), não está no preço — e o simulador já desconta 1% a.a. do investimento como custo fixo |
| **Histórico de furto na região** | Já houve furto de cabo, fiação ou equipamento no entorno? | Cabo de recarga é cobre. Pergunta desconfortável, feita uma vez, evita a segunda |

---

## 8. O que desqualifica um ponto na hora

Há dois tipos de "não", e confundi-los custa caro. Um mata de graça. O outro mata **só se o cliente
recusar o preço** — e o preço é a distribuidora que dá, não a IO.

### 8.1 TRAVAS — matam de graça, e não passam da primeira página

| # | Trava | Onde ela já está escrita |
|---|---|---|
| 1 | O local **não é do cliente nem está sob controle dele** ("ainda não é meu") | `SEM_CONTROLE`, régua de 29/08 |
| 2 | O ponto está em **negociação, em vista, ou não existe** | `SEM_LOCAL`, régua de 29/08 |
| 3 | **Imóvel locado sem anuência escrita** do proprietário para obra fixa | Cl. 4.1.II |
| 4 | **Não existe vaga que possa ser dedicada** ao carregador | Item 6 |
| 5 | **Não existe rede trifásica atendendo o endereço** (rede monofásica rural, por exemplo) | Item 2.1 |
| 6 | **Parecer de acesso definitivamente negado** por inviabilidade técnica do local | Cl. 7.4 — o contrato se resolve |
| 7 | Condomínio, shopping ou órgão público **sem autorização formal** da administração | Cl. 4.1.II |

Trava é trava: não soma pontos com nada. Um local com fluxo de rodovia, vaga sobrando e visibilidade
perfeita **que não é do cliente** é um cadastro de parceria, não uma reunião.

### 8.2 PREÇO — matam só se o cliente recusar o custo

| # | O que aparece | Quem paga | Onde |
|---|---|---|---|
| 1 | Reforço, extensão de rede, transformador da distribuidora, entrada em MT, subestação | **CONTRATANTE**, notificado com orçamento **antes** de qualquer execução | Cl. 2.1.I e 7.3 |
| 2 | Adequação do padrão de entrada / transformador dedicado + nicho | Orçado após a visita técnica; item próprio | LP + Anexo I |
| 3 | Vala e cabo longos entre padrão e vaga | Item do orçamento | Item 2.4 |
| 4 | Terraplenagem, pavimentação, cobertura, canópia, iluminação de pátio | **Fora do escopo** | Cl. 2.1.III |
| 5 | Licenças, alvarás, taxas municipais, bombeiros | **Fora do escopo** | Cl. 2.1.II |
| 6 | Câmeras, vigilância, controle de acesso | **Fora do escopo** | Cl. 2.1.IV |
| 7 | Demanda contratada mensal, se o ponto for para Grupo A | Cliente, todo mês — **e não está no simulador** | Item 2.6 ⚠️ |

**A regra de conversa:** trava se diz na hora, sem rodeio. Preço **nunca** se chuta. Diz-se
exatamente o que o contrato diz — *é item que se orça depois da visita, corre por conta do cliente e
ele é notificado com o orçamento antes de qualquer execução*. Chutar aqui é a forma mais rápida de
perder um cliente que já assinou.

---

## 9. FICHA DE VISTORIA DO PONTO

Lista fechada. Vai no celular. Nenhum campo é de texto livre a não ser onde está dito.
**"Não sei" não é resposta aceita nesta ficha** — na LP é, porque quem responde é o lead; aqui quem
responde é quem foi até lá.

### Identificação
- [ ] Data e hora da vistoria: ____________  ·  Quem vistoriou: ____________
- [ ] Endereço completo (rua, número, bairro, cidade/UF): ____________
- [ ] Nome e telefone de quem abriu o local: ____________

### Bloco 0 — Antes de sair de casa *(se qualquer um travar, não vá)*
- [ ] **O local é seu?** ☐ Sou o proprietário ☐ Administro o local ☐ Represento o proprietário ☐ Sou inquilino ☐ **Ainda não é meu → TRAVA**
- [ ] Sendo inquilino: **anuência escrita do proprietário para obra fixa?** ☐ Tenho ☐ Consigo ☐ **Não → TRAVA**
- [ ] Há condomínio / shopping / administradora / órgão público envolvido? ☐ Não ☐ Sim, com autorização ☐ **Sim, sem autorização → TRAVA**
- [ ] **Distribuidora:** ____________  ·  **Unidade consumidora nº** ____________
- [ ] Conta de luz em mãos? ☐ Sim ☐ Não *(sem ela a vistoria fica pela metade)*

### Bloco 1 — Energia
- [ ] **Tipo de ligação:** ☐ Trifásico (4 fios) ☐ Bifásico (3 fios) ☐ Monofásico (2 fios)
- [ ] **Tensão de fornecimento (na conta):** ☐ 380/220 V ☐ 220/127 V ☐ Outra: ______
- [ ] **Disjuntor geral — número gravado, em amperes:**
      ☐ até 40 A ☐ 40–63 A ☐ 63–100 A ☐ **100–150 A** ☐ **150–250 A** ☐ **acima de 250 A**
      *(as três primeiras faixas são idênticas às do cadastro de parceria; a antiga "acima de 100 A" foi quebrada em três porque ela não distinguia um padrão que aguenta o 80 kW de um que não aguenta — item 2.1)*
- [ ] **Consumo médio (kWh/mês, na conta):** ☐ até 500 ☐ 500–2.000 ☐ 2.000–10.000 ☐ acima de 10.000
- [ ] **A conta traz demanda contratada (kW)?** ☐ Não (Grupo B) ☐ Sim: ______ kW (Grupo A — já está em MT)
- [ ] **Carga instalada estimada do estabelecimento hoje:** ______ kW *(some com a do carregador — item 2.2)*
- [ ] **Há geração solar no local?** ☐ Não ☐ Sim, ______ kWp
- [ ] **Distância do padrão até a vaga pretendida:** ☐ até 30 m ☐ 30–80 m ☐ 80–150 m ☐ acima de 150 m
- [ ] **O percurso padrão → vaga atravessa:** ☐ terra/jardim ☐ piso a cortar ☐ área de circulação de veículos ☐ nada disso
- [ ] Existe rede trifásica atendendo o endereço? ☐ Sim ☐ **Não → TRAVA**

### Bloco 2 — Fluxo e permanência
- [ ] **Tipo de movimento:** ☐ Rodovia / rota de passagem ☐ Avenida movimentada ☐ Rua comercial ☐ Movimento próprio (clientes do local) ☐ Movimento fraco hoje
- [ ] **Contagem 1** — dia útil, 7h–9h, 20 min: ______ veículos  ·  horário exato: ______
- [ ] **Contagem 2** — dia útil, 14h–16h, 20 min: ______ veículos  ·  horário exato: ______
- [ ] **Contagem 3** — dia útil, 17h–19h, 20 min: ______ veículos  ·  horário exato: ______
- [ ] **Contagem 4** — sábado, pico do local, 20 min: ______ veículos  ·  horário exato: ______
- [ ] O que se contou: ☐ veículos que **passam** ☐ veículos que **entram** no local
- [ ] **Permanência natural do cliente do local:** ☐ menos de 15 min ☐ 20–60 min ☐ 60–120 min ☐ pernoite
- [ ] **O que o motorista faz nos 30 minutos da recarga?** *(texto livre, uma linha — se a resposta for "nada", isso é o achado)*: ____________

### Bloco 3 — Visibilidade e acesso
- [ ] O ponto é visível da via a 50 m: ☐ nos dois sentidos ☐ em um sentido ☐ não é visível
- [ ] Entrada: ☐ direta ☐ exige conversão à esquerda em via movimentada ☐ exige retorno
- [ ] Entrada reconhecível à noite: ☐ sim ☐ não
- [ ] Pode instalar totem / placa / pintura de solo: ☐ sim ☐ depende de autorização ☐ não
- [ ] Pontos públicos de recarga no raio de 5 km: ______ *(quantos e de que potência)*

### Bloco 4 — Vaga e manobra
- [ ] **Vagas que podem ficar exclusivas do carregador:** ☐ 1–2 ☐ 3–5 ☐ 6–10 ☐ mais de 10 ☐ **nenhuma → TRAVA**
- [ ] Dá para dedicar **2 vagas** ao carregador? ☐ Sim ☐ Só 1 ☐ Não
- [ ] SUV entra e sai sem manobra em três tempos: ☐ sim ☐ não
- [ ] Piso: ☐ concreto/asfalto firme ☐ irregular ☐ terra
- [ ] Cabe balizador / meio-fio / defensa protegendo o gabinete: ☐ sim ☐ não
- [ ] Cobertura: ☐ existe ☐ não existe *(fora do escopo — Cl. 2.1.III)*

### Bloco 5 — Segurança e horário
- [ ] **Horas por dia em que o carregador fica acessível ao público:** ☐ 24 h ☐ 12 h ou mais ☐ 8–12 h ☐ menos de 8 h
- [ ] O acesso depende de portão trancado, cancela ou funcionário? ☐ Não ☐ Sim
- [ ] Iluminação sobre a vaga: ☐ boa ☐ fraca ☐ não existe
- [ ] Câmera cobrindo o equipamento: ☐ existe ☐ existe mas não cobre ☐ não existe
- [ ] Alguém no local durante o horário de acesso: ☐ sim ☐ não
- [ ] Já houve furto de cabo, fiação ou equipamento no entorno: ☐ não ☐ sim

### Bloco 6 — Fotos obrigatórias *(é o que dispensa a segunda visita)*
- [ ] Padrão de entrada / caixa do relógio, inteiro
- [ ] **Disjuntor geral com o número legível**
- [ ] Conta de luz, 1ª página
- [ ] A vaga pretendida, vista da rua
- [ ] A vaga pretendida, vista de dentro do local
- [ ] O percurso do padrão até a vaga
- [ ] A frente do local, dos dois sentidos da via
- [ ] Vista geral do pátio / manobra

### Bloco 7 — Fecho
- [ ] **Alguma TRAVA marcada?** ☐ Não ☐ Sim → **PONTO X**, e a vistoria acaba aqui
- [ ] Placar (capítulo 10): ______ / 30  →  ☐ PONTO A ☐ PONTO B ☐ PONTO C
- [ ] Configuração que o ponto comporta hoje, sem obra de entrada: ☐ 60 kW ☐ 80 kW ☐ 120 kW ☐ 160 kW ☐ nenhuma sem obra
- [ ] Itens que vão para orçamento à parte: ____________

---

## 10. PLACAR DO PONTO

Trinta pontos, cinco critérios, uma letra no fim. **Qualquer TRAVA do capítulo 8.1 zera o placar e o
ponto vira PONTO X** — não se soma, não se negocia.

### Energia — até 10 *(zero aqui é TRAVA)*

| Situação | pts |
|---|:---:|
| Trifásico com **carga disponível confirmada** para a configuração pretendida — ou já em Grupo A, com demanda contratada na conta | 10 |
| Trifásico, disjuntor **acima de 150 A**, sobra a confirmar no projeto | 8 |
| Trifásico, disjuntor **100–150 A** | 6 |
| Trifásico, disjuntor **63–100 A** | 4 |
| Trifásico até 63 A, ou bifásico | 2 |
| Monofásico, ou não há trifásico na via | **0 = TRAVA** |

**A distância conta dentro desta nota, não fora dela:** passando de 80 m entre padrão e vaga, desça
uma linha da tabela; acima de 150 m, desça duas. O teto continua sendo 10 e o piso, 2 — distância
encarece, não trava.

### Fluxo e permanência — até 8

| Situação | pts |
|---|:---:|
| Rota de passagem **com parada natural** (posto, conveniência) e permanência de 20–60 min | 8 |
| Movimento próprio alto e permanência de 20–60 min (mercado, atacado, estacionamento) | 6 |
| Avenida movimentada, **sem** parada natural | 4 |
| Rua comercial | 2 |
| Movimento fraco, **ou** permanência abaixo de 15 min, **ou** pernoite | 0 |

### Vaga e manobra — até 5

| Situação | pts |
|---|:---:|
| 2+ vagas exclusivas, entrada e saída sem manobra, piso firme | 5 |
| 2 vagas exclusivas, manobra apertada ou piso a corrigir | 3 |
| 1 vaga exclusiva | 2 |
| Nenhuma vaga pode ser exclusiva | **0 = TRAVA** |

### Visibilidade e acesso — até 4

| Situação | pts |
|---|:---:|
| Visível nos dois sentidos + entrada direta | 4 |
| Visível em um sentido + entrada direta | 3 |
| Não visível, mas entrada fácil e sinalização permitida | 2 |
| Exige retorno, conversão difícil, ou fundo de pátio sem sinalização possível | 0 |

### Segurança e horário — até 3

| Situação | pts |
|---|:---:|
| Acesso público de 12 h ou mais, iluminado, com câmera sobre a vaga | 3 |
| Acesso de 8–12 h, iluminado | 2 |
| Acesso de 8–12 h sem iluminação ou sem câmera | 1 |
| Menos de 8 h de acesso público | 0 |

### As faixas

| Placar | Letra | O que se faz |
|---|---|---|
| 24 a 30 | **PONTO A** | Fecha. Segue para visita técnica e orçamento |
| 16 a 23 | **PONTO B** | Fecha **condicionado ao orçamento da entrada de energia**. Não se promete preço antes do parecer |
| até 15 | **PONTO C** | Não fecha hoje. Vira registro no banco de pontos |
| qualquer trava | **PONTO X** | Sai da fila. Vira cadastro em `/io/eletroposto/parceria` |

> ⚠️ **Os pesos e os dois cortes (24 e 16) são meus.** Nenhum arquivo da casa tem placar de ponto —
> o único corte que existe em produção é o de lead. **O que eles mudam:** subir o corte de A aperta a
> fila e manda mais gente para o cadastro; descer enche a agenda de ponto que precisa de obra de
> entrada. A calibragem honesta só aparece depois de umas 15 vistorias reais — sugiro rodar assim e
> recalibrar com dado, não com opinião.

---

## 11. Como este placar conversa com a NOTA da LP — e por que ele não pode se chamar "nota"

A LP já pontua, já emite **NOTA 1 / 2 / 3**, e essa nota vai para a ficha, para o alerta de WhatsApp,
para o pixel e para a função `ep_motivos()` no banco. **Ela mede outra coisa.**

| | NOTA 1/2/3 *(em produção)* | PONTO A/B/C/X *(este capítulo)* |
|---|---|---|
| **Mede** | O **lead**: perfil, forma de investir, quem decide, rota | O **local**: energia, fluxo, vaga, visibilidade, segurança |
| **Quem responde** | O próprio lead, no formulário | Quem foi até lá |
| **Onde nasce** | `pontuar()` na LP | Ficha de vistoria |
| **Onde é gravado** | Campo `nota` da ficha | **Campo próprio — nunca o `nota`** |

**Os dois eixos são independentes, e é justamente aí que está a tese do dono.** Um investidor com
capital, decisor único e recurso próprio faz **9 pontos** na régua da LP — NOTA 3 — e pode estar
olhando um PONTO C. É essa combinação que produz os 5,4% de conversão: gente ótima para vender,
sobre local que não sustenta o projeto. E é por isso que ter o ponto não salva o perfil (6%): um
ponto qualquer não é um ponto certo.

> **Regra dura de implementação:** se este placar um dia entrar no sistema, ele vai em **campo
> próprio**. Nunca reaproveitar o `nota`, nunca emitir 1/2/3. O comentário do próprio código avisa:
> *"os dois lados precisam concordar, senão a página de destino fala de um bloqueio e a ficha
> registra outro."*

---

## 12. ⚠️ Decisões pendentes

Tabela **completa** — uma linha para cada ⚠️ deste arquivo. Cada uma diz o que muda no resultado.

| # | Onde | Decisão | O que muda |
|---|---|---|---|
| 1 | 2.1 | Corrente real de entrada de cada configuração, pela **ficha técnica do fornecedor** | Decide se um padrão de 150 A aguenta o 80 kW. Hoje é estimativa minha (η 0,95) |
| 2 | 2.4 | As quatro faixas de **distância padrão → vaga** (30 / 80 / 150 m) | Decide se a vala entra no preço de tabela ou vira item do Anexo I |
| 3 | 2.5 | **Cl. 7.4 ou 7.5:** parecer negado **retém o custo do projeto** ou vira **crédito** para outro local em 12 meses? | Para o público investidor, o crédito transforma um "não" técnico em "vamos achar outro ponto". Custa mais caro de honrar |
| 4 | 2.6 | O **Estudo de Viabilidade passa a trazer demanda contratada** quando o ponto for Grupo A? | Sobe o payback de todo cenário em MT e aumenta a vantagem do 60 kW em BT |
| 5 | 4.4 | Cravar uma **taxa de conversão** de fluxo contado → carros elétricos/dia, ou manter caso a caso no estudo | É o que transforma a contagem da ficha em número de faturamento. Sem ela, a ficha entrega bruto |
| 6 | 6 | **Mínimo de vagas dedicadas:** 2, ou aceita fechar com 1? | Com 1 vaga o teto de carros/dia cai pela metade, e todo o payback do simulador é calculado sobre 2 bicos |
| 7 | 10 | **Pesos e cortes do placar** (24 = A, 16 = B) | Corte alto aperta a fila e enche o cadastro de parceria; corte baixo enche a agenda de ponto que precisa de obra de entrada |

**PONTOS PARA O ADVOGADO deste capítulo** — três, e nenhum vira promessa a cliente antes de resposta:

1. **Item 2.2** — como cada distribuidora conta a carga instalada de um carregador DC para a régua
   dos 75 kW (NDU/NT dela). *Risco: dizer "continua em baixa tensão" e o parecer exigir subestação.*
2. **Item 3** — qual o prazo regulatório da distribuidora para responder ao pedido de acesso, e a que
   faixa de carga ele se aplica. *Risco: prometer prazo que a IO não pode exigir de terceiro.*
3. **Item 6** — exigência de vaga acessível em estação de recarga aberta ao público, e de quem é a
   obrigação. *Risco: exigência do município aparecer depois do comissionamento.*

---

> **Antes de virar material de cliente:** os capítulos 1 a 8 são critério técnico-comercial e podem
> ir para a equipe hoje. A ficha do capítulo 9 e o placar do capítulo 10 devem rodar **umas 15
> vistorias reais** antes de virarem régua oficial — os pesos são meus, e placar calibrado com
> opinião é placar que reprova ponto bom.
