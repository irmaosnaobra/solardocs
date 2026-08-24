# Pedidos dos clientes — SolarDoc

Tudo que saiu da pesquisa com os clientes mais contínuos (18 a 24/08/2026), com prioridade,
dificuldade e a evidência de cada um. Fonte: `conversa_wa()` no solardoc-pro, tabulação em
[PESQUISA-CLIENTES-SOLARDOC.md](PESQUISA-CLIENTES-SOLARDOC.md).

**Quem respondeu:** Melque, GSI, American Energy, Ronailson, Lucas Paulino, Alessandro, Juliano,
Max, Vicente, Antônio Henrique, Eduardo Boso, Carlos Vinícius (VS Solar), Gedalih. **13 pessoas.**

Dificuldade: **trivial** = uma linha · **baixa** = uma tarde · **média** = alguns dias ·
**alta** = projeto próprio.

---

## A tabela

| # | Pedido | Quem pediu | Pessoas | Prior. | Dificuldade | Situação |
|---|---|---|:---:|:---:|:---:|---|
| 1 | Cliente pagante escreve e ninguém responde | Carlos Vinícius, Antônio Henrique, Eduardo Boso | **3** | **P0** | média | aberto — `whatsappAgentService.ts:691` |
| 2 | "Documentos Salvos" não leva aos documentos | Carlos Vinícius, American Energy | **2** | **P0** | **trivial** | aberto — `Sidebar.tsx:134` |
| 3 | Preço por item dentro da proposta | Melque, Max, Antônio Henrique | **3** | **P1** | alta | aberto — espera decisão de plano |
| 4 | Quantidade de baterias (campo não existe) | GSI | 1 | P2 | baixa | **FEITO** 24/08 · `3714c41` |
| 5 | Geração estimada no contrato | GSI | 1 | P2 | baixa | **FEITO** 24/08 · `50a0412` |
| 6 | Capa na proposta | Eduardo Boso | 1 | P3 | média | **FEITO** 24/08 · `cde6ad0` |
| 7 | Salvar localização do cliente com as fotos | Gedalih | 1 | P3 | média | **FEITO** 24/08 · `59b5abe` |
| 8 | Logo maior na proposta com gráfico | American Energy | 1 | P3 | **trivial** | aberto |
| 9 | Kanban de projetos com anexo | Melque | 1 | P3 | alta | aberto |
| 10 | Monitoramento de usinas barato | American Energy | 1 | P3 | fora de escopo | aberto |
| 11 | Abertura da pesquisa virou mentira | — (nossa casa) | — | P4 | **trivial** | aberto |

**Entregues em 24/08/2026: 4, 5, 6 e 7** — detalhe de cada um no fim do arquivo.

**Se for fazer um só agora:** o **2**. É uma linha e cala reclamação de dois clientes.
**O que trava sozinho:** o **3** não começa sem você decidir se a Precificação volta pro `pro`.
**O que não é bug:** o **2** é navegação, o **4** é campo que nunca existiu. Nenhum dos dois é
defeito de renderização — mandar alguém caçar erro no template é jogar tempo fora.

---

## P0 — está custando venda agora

### 1. Cliente pagante manda mensagem e ninguém responde
**Dificuldade: média.** Evidência mais cara da pesquisa inteira:

> **Carlos Vinícius (VS Solar), 21/08 19h28:** *"Estou fazendo uma venda agora, só que não consigo
> achar o arquivo da vistoria que fiz p cliente, onde encontro esse arquivo?"*

**Três dias sem uma palavra de volta.** No meio de uma venda. Ele ainda assim respondeu a pesquisa
elogiando, três minutos depois.

Não é o robô quebrado — é o oposto. Quem tem o telefone só em `company.whatsapp` (e não em
`users.whatsapp`) é **calado de propósito** desde a correção de 18/08, pra não levar pitch de venda
sendo assinante. Só que o atendimento (`whatsappAgentService.ts:691`) procura o dono da conta **só**
por `users.whatsapp`: não acha, e também não fala. Protegido do pitch, órfão de resposta.

Já aconteceu com **3 clientes**: Carlos Vinícius, Antônio Henrique e Eduardo Boso.

**Conserto:** casar o telefone por **8 últimos dígitos** contra `users.whatsapp` **e**
`company.whatsapp`. Não é `.eq()` — `company.whatsapp` é texto livre, tem `11-93962-2890` na base.
Tratar todo `company.whatsapp` como dono da conta já foi recusado em 18/08 (calaria 78 conversas),
então o casamento tem que ser por dígito, no banco.

### 2. "Documentos Salvos" não leva aos documentos salvos
**Dificuldade: trivial (uma linha).** **Dois clientes bateram na mesma parede**, e eu tinha
classificado como dois pedidos diferentes:

> **Carlos Vinícius:** *"não consigo achar o arquivo da vistoria"*
> **American Energy:** *"não consigo acessar a nuvem para baixar a proposta já gerada"*

A tela existe e funciona: é `/historico`, e ela lista Vistoria CheckList, propostas, contratos, com
busca. **Só que nenhum link do app aponta pra ela.** O item do menu é *"Documentos Salvos"* →
`/conta/documentos`, que é a **página de venda do recurso** — o texto que promete "todos os
documentos salvos na nuvem", com um botão *"Acessar minha nuvem"*. O arquivo está a **dois cliques,
atrás de uma página de propaganda** que o assinante não precisava ver.

**Conserto:** apontar o item do menu direto pra `/historico`
([Sidebar.tsx:134](dashboard/src/components/Sidebar/Sidebar.tsx#L134)). Se quiser manter a página de
venda, que ela apareça só pra quem é `free`.

---

## P1 — o pedido nº 1, pedido por 3 pessoas com 3 nomes

### 3. O preço dos itens dentro da proposta
**Dificuldade: alta.**

| Quem | Como pediu |
|---|---|
| Melque | *"colocar o preço individual das placas, inversor e estrutura"* |
| Max (GreenMax) | *"poder montar os kit, já deixar montado, pra não ter que fazer tudo novamente"* |
| Antônio Henrique | *"a integração da precificação com o gerador de proposta"* |

É o mesmo pedido: **o preço por item mora dentro da proposta, e o conjunto fica salvo pra reusar.**
Nenhum dos três pediu documento novo.

**A decisão que vem antes do código:** a Precificação **já existe** e virou exclusiva do anual em
17/08. O Antônio é `pro` — o pedido mais repetido da base é ligar uma ferramenta que quem pede não
consegue abrir. Ou ela reaparece pro `pro` (mesmo capada), ou vira o argumento do upgrade:
*"você pediu; está no anual"*. **Sem essa decisão, o resto não começa.**

---

## P2 — buracos no documento

### 4. Quantidade de baterias não existe em lugar nenhum
**Dificuldade: baixa.** A GSI reportou como "não aparece no PDF". Conferido: **não é bug de
renderização, o campo nunca existiu.** `parseBateria()` lê marca, capacidade, potência, ciclos e
garantia — quantidade não. E os formulários (`PropostaSolarForm`, `ContratoSolarForm`) também não
têm onde digitar. Só a proposta Off-Grid tem `qtd_baterias`.

**Conserto:** campo novo ponta a ponta — 2 formulários, `parseBateria`, e os pontos que montam a
linha de equipamentos.

### 5. Geração estimada no contrato
**Dificuldade: baixa.** GSI: o contrato não traz a geração estimada do sistema. O número já é
calculado na proposta; é levar pro template do contrato.

---

## P3 — pedido de uma pessoa só (ainda)

### 6. Capa na proposta — **dificuldade: média**
Eduardo Boso: *"falta uma capa na proposta"*. Não existe nada de capa nos templates hoje.

### 7. Salvar a localização do cliente junto com as fotos — **dificuldade: média**
Gedalih, por áudio, e o caso é concreto:

> *"Fiz uma proposta pra um cliente e ele me mandou a localização, aí não sei o que aconteceu no
> celular, acabei perdendo a localização. **É na roça.** Salvando as localizações junto com as
> fotos, facilita muito a vida pra gente."*

O mesmo cara elogia justamente a parte de fotos (*"salvar a foto, deixar tudo bonitinho, tudo
certinho"*) — o pedido é o passo seguinte do que já funciona. Vistoria em zona rural sem
coordenada é retrabalho de deslocamento, não de digitação.

### 8. Logo maior na proposta com gráfico — **dificuldade: trivial**
American Energy: *"a logo da nossa empresa deveria aparecer maior"*. É CSS no template.

### 9. Kanban de projetos por etapa, com anexo — **dificuldade: alta**
Melque. É um segundo produto dentro do produto (gestão de obra). O `/crm` já existe e pode ser a
base, mas "cada projeto na sua etapa com arquivos anexados" não é uma tela, é um módulo.

### 10. Monitoramento de usinas barato pra quem tem poucas — **dificuldade: fora de escopo**
American Energy. Não é software de documento: é integração com inversor (Growatt, Sungrow...) e
mensalidade de terceiro. Entra como ideia de produto, não como pedido de melhoria.

---

## P4 — nossa casa

### 11. A abertura da pesquisa está virando mentira — **dificuldade: trivial**
O `cimigno` recebeu *"você é um dos que mais usam a plataforma — **5 propostas** para 4 clientes"*.
`TOP_N` é 20, mas 22+ já receberam: a lista é re-rankeada a cada tick e quem esfria abre vaga. Com 5
propostas, o elogio da abertura é falso e o cliente sabe. Subir a régua ou trocar a frase antes da
próxima leva.

---

## O que a lista NÃO tem

Ninguém pediu documento novo. Ninguém falou de aparência, layout ou "proposta bonita" — exceto a
logo maior, que é sobre a marca **dele** aparecer. O eixo de todos os pedidos é **controle dos
números e não perder arquivo**, que é o mesmo que os dados de uso já diziam em
`solardoc-valor-e-a-proposta`.

E o mais barato da lista (item 2, uma linha no menu) resolve reclamação de dois clientes.

---

## O que foi entregue em 24/08/2026

**4 · Quantidade de baterias** (`3714c41`) — campo novo ponta a ponta: formulário da
proposta, formulário do contrato e template. Sai como `2× BYD`, no mesmo idioma que o
inversor já usava. Vazio ou 1 renderiza igual ao que já saía. Duas travas ficaram no
código: quantidade **sem marca** não acende a linha da bateria (senão um número digitado
por engano vira bateria fantasma), e capacidade/potência ganham **"cada"** acima de 1
unidade — essas duas somam, e um banco leria "10,24 kWh" como o banco inteiro.

**5 · Geração estimada no contrato** (`50a0412`) — nos dois modelos. Sempre com a palavra
**"estimada"** e a ressalva de que a produção real varia com clima, sombreamento,
temperatura e sujidade, e **não é garantia de geração mínima**. O pedido era mostrar o
número, não assinar embaixo dele: contrato que promete kWh cravado é processo no primeiro
mês nublado. Campo vazio some com a linha E com a ressalva.

**6 · Capa na proposta** (`cde6ad0`) — entrou como **modelo 3, "Moderno com capa"**, e não
como mudança do Moderno: quem já manda o modelo 2 continua mandando o mesmo PDF byte por
byte (conferido no render). Não é um segundo template — o 3 chama o mesmo corpo com a
folha de rosto ligada, então mudar o Moderno arruma os dois. A capa leva logo, nome do
cliente, os três números e o rodapé com data, código e validade; na impressão vira uma
folha A4 inteira.

**7 · Localização da vistoria** (`59b5abe`) — o caso do Gedalih desenhou a solução: o
caminho principal **não é o GPS**, é **colar** o que o cliente mandou no WhatsApp, porque
ele não está no sítio quando a mensagem chega. O campo aceita coordenada, link do Maps,
link curto do goo.gl ou só um apelido do ponto; o que dá pra ler vira lat/lng, o que não
dá fica guardado como link e continua abrindo. **Nada é recusado em silêncio.** A
localização aparece no relatório público, junto das fotos — que é o link que vai pro
WhatsApp. 10 testes travam o parser, inclusive o que **não** pode virar coordenada
(preço colado por engano, "15, 30" de módulo e inversor). Coluna `localizacao jsonb`
aplicada no solardoc-pro e conferida no `information_schema`.
