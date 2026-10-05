# O contrato perfeito não é um contrato — é uma arquitetura
### Desenho jurídico do ecossistema eletroposto · Irmãos na Obra · 13/ago/2026

> **O que este documento responde:** olhando o modelo de negócio inteiro
> (`ECOSSISTEMA-ELETROPOSTO.md`, 9 degraus), qual seria o contrato ideal.
>
> **A resposta curta:** o contrato que vocês precisam **não é o da obra**. O turnkey fecha
> uma venda e devolve a rede. O contrato que vale é o **que não termina** — e ele não existe.
>
> **⚠️ = decisão minha, não do Thiago.** Tabela completa no fim.
> **Nada aqui vai pra cliente sem passar por advogado.**

---

## ANTES DE TUDO: a pergunta que trava a arquitetura inteira

> **Pergunta 3 da Parte 7 do `ECOSSISTEMA-ELETROPOSTO.md`, aberta desde 30/jul:**
> *o contrato com o fornecedor da plataforma permite (a) vender para ponto que não foi obra
> de vocês e (b) white-label no futuro?*

🚧 **Enquanto isso não for respondido, o Contrato de Operação (o item 2 abaixo) não pode ser assinado**
— vocês estariam prometendo ao cliente algo que o seu próprio fornecedor talvez proíba.
É uma leitura de contrato que leva 20 minutos e destrava toda a arquitetura. Faça primeiro.

---

## O erro estrutural do contrato que eu te entreguei ontem

O `CONTRATO-ELETROPOSTO.md` está tecnicamente correto e **estrategicamente incompleto**. A cláusula 12.3 diz:

> *"A CONTRATADA não participa da receita da operação nem responde por seu resultado econômico."*

Para uma venda de obra isolada, é a redação certa — protege vocês do resultado do cliente.
Só que o `ECOSSISTEMA-ELETROPOSTO.md` estabelece a **Lei 2**:

> *"Todo caminho termina na plataforma. Curioso, aluno, concorrente ou cliente de obra — todos viram assinatura."*
> *"Meça pontos ativos, não faturamento da plataforma, durante os primeiros 18 meses."*

E a **Lei 2 hoje não existe em papel nenhum.** O cliente recebe a obra, assina o recebimento definitivo,
e sai juridicamente livre para trocar de plataforma no mês seguinte. Cada eletroposto entregue
é um ponto que **pode** ficar na sua base — nenhum é um ponto que **fica**.

Isso mata o Degrau 9. A bandeira precisa de 20 a 40 pontos ativos, e o único instrumento que
transforma "entreguei uma obra" em "tenho um ponto na rede" é um contrato de operação assinado.
Sem ele, o valor da IO é a margem de cada obra. Com ele, o valor é a rede — que é a diferença
entre empresa de projeto e empresa de R$ 100 milhões, nas suas próprias palavras.

**O contrato perfeito, então, é aquele que faz da obra o ingresso, e não o produto.**

---

## A arquitetura: um tronco e seis instrumentos

```
                    TRONCO COMUM (cláusulas idênticas em todos)
        LGPD · confidencialidade · sem vínculo · uso de imagem (opt-in) ·
        foro · comunicações · isenção de promessa de rendimento
                                  │
    ┌──────────────┬──────────────┼──────────────┬──────────────┐
    │              │              │              │              │
 ① ADESÃO      ② OPERAÇÃO     ③ TURNKEY      ④ ENTREGA      ⑤ CRÉDITO
    DIY         E PLATAFORMA    (obra)        BUSINESS       DE UPGRADE
 mentoria       ← O CONTRATO                    PLAN         (Lei 1)
 + supply         PERFEITO                   / RAIO-X
                                  │
                            ⑥ ARRENDAMENTO
                            (ponto de terceiro — Degrau 8-a)
```

**O tronco comum não é elegância — é operação.** Seis contratos com seis redações diferentes de LGPD
e foro é seis vezes a chance de erro e seis revisões de advogado. Um tronco escrito uma vez,
colado em todos, é uma revisão só e uma correção só quando a lei mudar.

---

## Ranking: o que dói mais se não existir

Ordenado por **risco × alavanca**, não por ordem de venda.

### ① Termo de Adesão dos produtos DIY (mentoria + supply) — **a maior exposição da casa**

**Hoje não existe papel nenhum.** As exclusões vivem na Trava 3 de um markdown de estratégia:

> *sem ART da IO · sem representação na concessionária · sem garantia de obra · sem responsabilidade técnica*

Enquanto isso é bullet point de estratégia, não protege ninguém. O cenário concreto:
a IO forma um integrador em Recife, ele instala um 80 kW sem seguir o que foi ensinado,
acontece um acidente elétrico — e o nome da Irmãos na Obra está no certificado do curso,
na lista de fornecedores homologados e na revisão do projeto dele (que é entrega do Degrau 4).

Não é risco teórico. **"Revisão de 1 projeto do aluno" é entrega contratada da mentoria** — é a
hipótese mais provável de alguém sustentar que houve responsabilidade técnica de fato.

O que o termo precisa carregar, em cláusula destacada e com aceite específico:
exclusão de responsabilidade técnica; ausência de ART; a revisão de projeto é **comentário
pedagógico, não aprovação técnica**; lista de fornecedores é indicação sem garantia; supply
tem garantia **de fábrica apenas**, nunca de instalação; e vedação de uso da marca IO pelo aluno.

> **Ordem de construção: este é o primeiro.** É o único da lista onde o prejuízo não é
> receita perdida — é responsabilidade civil.

### ② Contrato de Operação e Plataforma — **o contrato perfeito**

O que recorre, o que acumula pontos ativos e o que torna a bandeira possível.
Construído por inteiro em [CONTRATO-OPERACAO-PLATAFORMA.md](CONTRATO-OPERACAO-PLATAFORMA.md).

Ele resolve, num instrumento só, cinco linhas de receita que hoje estão soltas:
plataforma/OCPP (Degrau 7), SLA de manutenção pós-garantia (8-c), marketing local do ponto (8-e),
seguro (8-d) e o **direito de preferência na rede** (Degrau 9).

**Por que ele não pode ser um capítulo do turnkey:** ver a seção seguinte.

### ③ Turnkey (obra) — **existe em v1**

[CONTRATO-ELETROPOSTO.md](CONTRATO-ELETROPOSTO.md). Não precisa mudar de natureza.
Precisa só de uma remissão ao ② — e do desconto expresso como contrapartida, não como cortesia.

### ④ Termo de Entrega do Business Plan / Raio-X — **o mais subestimado**

O Degrau 3 vende, por R$ 3.900, um documento com **payback, VPL, TIR e análise de sensibilidade**,
cuja finalidade declarada é ser **bancável** — ou seja, nasce para ser levado a um banco.

O Guardrail #1 cobre isso com um rótulo dentro do PDF. Para uma calculadora grátis, rótulo basta.
Para um documento **pago**, com metodologia financeira, que o cliente vai usar para tomar crédito,
não basta: se o ponto não performa, o inadimplente tem um documento seu na mão e um banco no pé.
E a exposição não para no cliente — **um banco que decidiu com base no seu estudo é um terceiro
que confiou nele.**

O termo (1 página, assinado junto com a entrega) precisa de: premissas visíveis e declaradas
**pelo cliente**, natureza de simulação, ausência de garantia de resultado, vedação de uso
para captação de investidor terceiro sem anuência ⚠️, e validade da análise (⚠️ 90 dias —
tarifa de energia e preço de equipamento mudam).

### ⑤ Termo de Crédito de Upgrade — **a Lei 1 sem prazo é passivo eterno**

A Lei 1 diz *"todo degrau pago vira crédito no degrau de cima"*. Excelente venda, e hoje é
promessa verbal. Sem instrumento, três coisas ficam indefinidas: **prazo** (o doc já fala em
90 dias para o Business Plan, mas nada dos outros), **transferibilidade** (o crédito é da pessoa
ou do CNPJ? vale para outro ponto?) e **acumulação** (quem comprou Raio-X + Sessão + Business Plan
abate R$ 5.497 do turnkey — isso cabe na margem?).

Esse último ponto trava na **pergunta 1 da Parte 7**, ainda sem resposta: qual a margem real do
turnkey de 80 kW. Sem ela, não dá para dizer quanto crédito cabe — e um crédito mal calibrado
transforma a esteira inteira em desconto.

É meia página: valor, origem, prazo ⚠️, intransferibilidade, não-cumulatividade com outras promoções,
e abatimento no preço bruto.

### ⑥ Contrato de Arrendamento / Corretagem do ponto — **quando o ponto não é do cliente**

Degrau 8-a. A LP já pergunta *"quero ajuda para encontrar o ponto"* e isso hoje não é monetizado.
Aqui, e só aqui, a família de cessão de área é a certa — a [minuta da CEMIG](https://www.cemig.com.br/wp-content/uploads/2026/05/cps-anexo-ii-minuta-cooperacao-eletropostos.pdf)
serve de esqueleto, **convertida para onerosa**: o simulador já usa 10% de arrendamento,
então a cláusula de remuneração é percentual sobre faturamento do ponto, não aluguel fixo.

Some-se a comissão de corretagem da IO sobre o arrendamento e o direito de a IO ser a
operadora do ponto — que reconecta ao ②.

---

## A decisão de desenho que mais importa: por que ② e ③ são separados

A tentação é óbvia: enfiar a plataforma como cláusula do turnkey e resolver tudo numa assinatura só.
**Não faça.** Três razões, em ordem de força:

**1. Venda casada.** Condicionar a venda de um ativo de R$ 145 mil à contratação de um serviço
recorrente, no mesmo instrumento, é o desenho clássico do art. 39, I do CDC. Sendo o comprador
pessoa física ou pequeno empresário, o risco é real.

**2. Você perde a cláusula e mantém o desconto.** Se um juiz derruba a exclusividade embutida,
o que cai é a cláusula — o desconto que você deu em troca dela fica de pé. Você paga pela trava
e não fica com ela.

**3. A REN 819/2018 é sua aliada e vira sua adversária.** Você verificou: o preço da recarga é
**livremente negociado pelo operador**. É isso que permite ao seu cliente ganhar dinheiro — e é
exatamente esse mesmo princípio que um advogado usa contra uma cláusula que amarra a operação
dele por N anos dentro do contrato de compra do equipamento.

**O desenho que funciona:** dois instrumentos, **mesa única, assinatura no mesmo dia**.
O desconto do turnkey é redigido como **contrapartida expressa** da adesão ao ②, com
**devolução proporcional (claw-back)** se o cliente sair antes do prazo ⚠️. Isso não é
exclusividade imposta — é preço condicionado, que é a coisa mais comum do mundo comercial e
sobrevive à leitura de qualquer advogado.

E a adesão à rede futura (Degrau 9) **nunca** pode ser obrigação: obrigar alguém a aderir a
condições ainda não definidas é obrigação indeterminada e não se executa. O que se escreve é
**direito de preferência** — nas mesmas condições oferecidas a pontos comparáveis.

---

## O que muda no contrato de obra (edição mínima)

Uma remissão na Cláusula 12 e nada mais. Já aplicada — a 12.3 continua intacta,
porque ela é a proteção de vocês contra o resultado econômico do cliente.

---

## Ordem de construção

| # | Instrumento | Por quê agora |
|---|---|---|
| 0 | **Ler o contrato do fornecedor da plataforma** | 20 min. Sem isso o ② não pode ser assinado |
| 1 | **① Adesão DIY** | Única exposição de responsabilidade civil sem papel |
| 2 | **② Operação e Plataforma** ✅ construído | Toda obra entregue sem ele é ponto perdido pra sempre |
| 3 | **④ Termo do Business Plan** | Vale a partir do primeiro documento vendido |
| 4 | **⑤ Crédito de upgrade** | Trava na margem real (pergunta 1) |
| 5 | **⑥ Arrendamento** | Só quando o Degrau 8-a entrar em operação |

---

## ⚠️ Decisões pendentes desta arquitetura

Completa — uma linha por ⚠️ do arquivo.

| # | Onde | Decisão |
|---|---|---|
| 1 | Abertura | **Ler o contrato do fornecedor da plataforma** (pergunta 3 da Parte 7) |
| 2 | ④ | Business Plan pode ser usado para captar investidor terceiro? |
| 3 | ④ | Validade da análise: 90 dias? |
| 4 | ⑤ | Prazo, transferibilidade e teto de acumulação do crédito — depende da margem real (pergunta 1) |
| 5 | Desenho ②×③ | Prazo do compromisso e % do claw-back do desconto |

**Todas as minutas desta arquitetura precisam de revisão de advogado antes de ir a cliente.**
