# Pedidos dos clientes — SolarDoc

Tudo que saiu da pesquisa com os clientes mais contínuos (18 a 24/08/2026), com prioridade,
dificuldade e a evidência de cada um. Fonte: `conversa_wa()` no solardoc-pro, tabulação em
[PESQUISA-CLIENTES-SOLARDOC.md](PESQUISA-CLIENTES-SOLARDOC.md).

**Quem respondeu:** Melque, GSI, American Energy, Ronailson, Lucas Paulino, Alessandro, Juliano,
Max, Vicente, Antônio Henrique, Eduardo Boso, Carlos Vinícius (VS Solar), Gedalih. **13 pessoas.**

Dificuldade: **trivial** = uma linha · **baixa** = uma tarde · **média** = alguns dias ·
**alta** = projeto próprio.

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
