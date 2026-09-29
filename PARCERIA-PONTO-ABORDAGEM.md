# Parceria do ponto: como achar posto e farmácia
### O modelo 01 e a metade vazia do mercado · Irmãos na Obra · 29/set/2026

> **O pedido:** "quero achar parceria com postos, farmácias".
>
> **A resposta curta:** não é canal novo, é a metade que falta de um mercado que já existe
> e já converte. O modelo **01 · Cedo o espaço e vocês investem 100%** é o que mais avança
> de todos: **28 reuniões, 14 avançaram, 50%**. E a base tem **217 pessoas com capital
> contra 17 com local**. Falta local, não falta dinheiro nem falta oferta.
>
> **A armadilha que mata depois da reunião:** dos 17 locais cadastrados, **10 são de
> inquilino** e só 3 são do próprio dono. O contrato de cessão é assinado pelo dono do
> imóvel. A pergunta do imóvel vem antes do pitch, não depois.

Números medidos em 29/09/2026. Fonte de cada um na seção 8.
Seguindo a convenção da casa, **⚠️ marca raciocínio meu, não medido**.

Este documento é o gêmeo de [PONTO-COMO-CONSEGUIR.md](PONTO-COMO-CONSEGUIR.md). Aquele
ensina o investidor a achar local. Este é o roteiro de quem liga para o dono do local.

---

## 1. Por que o modelo 01 é a oferta, e não a opção

Das 462 reuniões da LP, separadas pelo modelo que o lead escolheu:

| modelo | reuniões | avançou | taxa |
|---|---:|---:|---:|
| **01 · Cedo o espaço e vocês investem 100%** | 28 | 14 | **50,0%** |
| 03 · Chave na mão, o eletroposto é meu | 23 | 9 | 39,1% |
| Ainda não sei, quero comparar na reunião | 94 | 31 | 33,0% |
| 02 · Sociedade meio a meio | 9 | 2 | 22,2% |

O modelo 01 é o que menos exige do outro lado e o que mais fecha. Faz sentido: é o único
em que a resposta para "quanto eu preciso investir" é **zero**.

E o mercado está desbalanceado exatamente no sentido que favorece essa conversa:

| lado do cadastro `eletroposto_parceria` | pessoas |
|---|---:|
| **capital** (tem dinheiro, quer um ponto) | **217** |
| integrador | 52 |
| **ponto** (tem o local) | **17** |

**Treze pessoas com dinheiro para cada uma com local.** Quem traz um posto bom para a
mesa não está vendendo nada difícil: está trazendo a peça que está em falta.

---

## 2. A primeira pergunta é do imóvel

Dos 17 locais cadastrados até hoje:

| relação com o local | n |
|---|---:|
| Sou inquilino | 10 |
| Sou o proprietário | 3 |
| Represento o proprietário | 2 |
| Estou negociando com o proprietário | 2 |

O `CONTRATO-ARRENDAMENTO-PONTO.md` é uma **Cessão Onerosa de Área**, e quem assina como
CEDENTE é o **dono do imóvel**. Gerente de posto, franqueado de farmácia e locatário de
loja **não assinam sozinhos**. A cláusula de não acessão, que protege o equipamento de
virar parte do imóvel, depende justamente de quem tem o domínio.

Isso não descarta o inquilino. Só muda quem precisa estar na sala. Na prática:

- **É seu:** segue direto, é o caso bom.
- **É alugado:** pergunte quanto falta de contrato e se ele fala com o proprietário. O
  prazo do contrato de cessão tem piso econômico, porque o payback do investidor é de
  **2,73 anos com 10% de arrendamento**. Contrato de aluguel que vence em 18 meses não
  sustenta a cessão.
- **Ele administra ou representa:** peça o nome de quem assina, e traga essa pessoa para
  a segunda conversa.

A pergunta já existe no formulário de `/io/eletroposto/parceria` ("O local é seu?"). Ela
está sendo **coletada e não está sendo usada para filtrar**. Deveria ser o primeiro
critério de fila, não um campo no meio da ficha.

---

## 3. A oferta, em números que você pode falar ao telefone

Cenário de referência da casa: 80 kW, investimento de R$ 144.595, 10 carros por dia,
20 kWh por recarga, revenda a R$ 2,35/kWh, energia a R$ 0,70/kWh. Faturamento bruto de
**R$ 14.460 por mês**.

| percentual para o dono do local | ele recebe por mês | payback do investidor |
|---|---:|---:|
| 0% | R$ 0 | 2,27 anos |
| **10% (referência da casa)** | **R$ 1.446** | 2,73 anos |

**A régua da negociação: cada ponto percentual vale R$ 144,60 por mês para o dono do
local e custa cerca de 0,04 ano de payback ao investidor.** É a conta que você faz na
hora, sem abrir planilha.

Três coisas que o dono do local quase sempre pergunta, e a resposta curta de cada uma:

- **"Quanto eu ponho?"** Nada. No modelo 01 quem investe é o outro lado. Você entra com
  a vaga e a energia.
- **"E se não vier carro?"** Existe piso mensal negociável, e existe carência de rampa
  nos primeiros meses. Os dois estão previstos no contrato.
- **"E a conta de luz?"** É do operador, não sua. A medição é separada.

**⚠️ O que eu recomendo levar já resolvido, e não está cravado:** o piso mensal. Percentual
puro joga todo o risco de movimento em quem só cedeu o espaço, e é a cláusula que mais
trava assinatura. Piso alto vira aluguel disfarçado e derruba o payback. Quem crava esse
número é o Thiago, e sem ele a conversa trava na segunda reunião.

---

## 4. Por onde entrar, canal a canal

### Posto de bandeira: fale com a bandeira, não com o revendedor

Quatro distribuidoras cobrem **18.348 postos, 40% do país**:

| bandeira | postos | % |
|---|---:|---:|
| Vibra | 6.881 | 15,0% |
| Ipiranga | 5.623 | 12,3% |
| Raízen (Shell) | 4.766 | 10,4% |
| Ale | 1.078 | 2,4% |

Todas já têm programa de eletroposto na rede e já falam com cada revendedor por canal
próprio. **A conversa com elas não é de venda, é de execução:** quem instala e opera nas
cidades do interior onde o time delas não chega. Abra pela área de novos negócios ou de
transição energética, não pelo comercial de combustível.

O argumento que só nós temos: a lista de cidades com frota elétrica e sem carregador, que
já sai pronta do `/gerador/estados` e está em `PROSPECCAO-CIDADES-PRIORIDADE.txt`. É uma
conversa sobre **onde** a rede deles está descoberta, com número.

### Posto de bandeira branca: fale com o sindicato

**22.163 postos, 48,4% do país**, e nenhum dono único. A **Fecombustíveis** tem 34
sindicatos filiados e se apresenta representando cerca de 40 mil postos. É um interlocutor
por estado.

Sindicato não compra equipamento. Sindicato abre agenda, manda circular e cede espaço em
convenção. O que entra por essa porta é **palestra e estudo de viabilidade por região**,
que o `/gerador/estados` e o estudo do local já produzem sozinhos, sem trabalho novo.

### Farmácia de rede: só as que têm estacionamento próprio

As maiores por número de lojas são **RD Saúde** (Raia Drogasil), **Pague Menos**, **Grupo
DPSP** (Drogaria São Paulo e Pacheco), **Farmácias São João** e **Panvel**. A associação
das grandes é a **Abrafarma**. As grandes redes são cerca de 11% dos pontos de varejo
farmacêutico e respondem por perto de 53% da dispensação, ou seja, **a maior parte das
lojas é independente ou associativista**, e aí o caminho é a central de negócios, igual
à bandeira branca.

**⚠️ O filtro que eu aplicaria antes de ligar:** só loja com estacionamento próprio. Sem
vaga, não existe conversa, por melhor que seja o fluxo de gente.

### Farmácia de rua: provavelmente não, e vale dizer por quê

Na base há 6 reuniões com perfil farmácia, e 4 avançaram. É a melhor taxa da tabela de
perfis e é uma amostra de 6, então não decide nada. **⚠️ Minha leitura:** recarga rápida
útil pede 20 a 40 minutos de permanência e farmácia de rua é visita de 5 minutos. O mais
provável é que essas 6 sejam **donos do imóvel** aproveitando a vaga, não a operação do
balcão. Trate como dono de imóvel, não como segmento de varejo.

### O atalho que já está pago: 2.039 integradores

Estão em `prospeccao_contatos` agora, com celular, e praticamente sem toque. O integrador
solar já entra em posto, mercado e academia para vender geração, já sabe ler padrão de
entrada e hoje perde a conversa quando o cliente pergunta de carregador. Um integrador
que leva a nossa oferta entra em vinte comércios que a gente nunca vai tocar um a um.

---

## 5. O roteiro da ligação

Para o dono de posto ou de farmácia, modelo 01. Uma frase por vez, como gente fala.

**Abertura, sem vender nada:**

> Bom dia, é o dono do posto?
> Sou da Irmãos na Obra, a gente instala e opera eletroposto.
> Uma pergunta rápida e eu já te libero: o imóvel do posto é seu ou alugado?

Essa pergunta faz três coisas de uma vez. Qualifica, não parece pitch, e a resposta
determina se vale continuar hoje ou se falta gente na conversa.

**Se o imóvel é dele:**

> Então é o seguinte.
> A gente coloca um carregador rápido aí, e quem paga o equipamento e a instalação somos nós.
> Você entra com a vaga e com a ligação de energia.
> E recebe um percentual de tudo que o carregador faturar, todo mês.

**O número, só depois que ele perguntar:**

> No nosso cenário de 80 kW, com dez carros por dia, dá perto de R$ 1.400 por mês pra você.
> Sem você ter posto um real.

**O fechamento é um cadastro, não uma reunião:**

> Te mando o link do cadastro do local.
> São cinco perguntas, leva dois minutos.
> Assim que você preencher, a gente faz o estudo do seu ponto e te devolve com número.

O link vai numa **segunda mensagem**, cerca de um minuto depois, com `https://` na frente:
`https://solardoc.app/io/eletroposto/parceria`. Link solto no primeiro toque é o que faz
número ser denunciado.

**Se o imóvel é alugado:**

> Entendi.
> Nesse caso quem assina é o dono do imóvel, porque o contrato é de cessão de área.
> Você fala com ele?
> Se você quiser, eu te mando o resumo de uma página pra você levar pra ele.

Não descarte. Cadastre com a relação correta e trate como conversa de duas etapas.

---

## 6. O que fazer com quem diz sim

1. **Cadastro em `/io/eletroposto/parceria`, lado ponto.** É o que já grava endereço,
   vagas, movimento, tipo de ligação e disjuntor.
2. **Estudo do local.** Roda sozinho a partir do endereço e devolve nota. É o que
   transforma "tenho um lugar" em "tenho um ponto com número".
3. **Cruzar com os 217 do lado capital.** É aqui que o desbalanço vira dinheiro: cada
   ponto bom tem treze candidatos esperando.
4. **Contrato.** `CONTRATO-ARRENDAMENTO-PONTO.md`, com o piso e a carência preenchidos.
   A minuta ainda precisa de revisão de advogado antes de ir a cliente, e a página de
   parceria ainda não avisa que a IO cobra corretagem. Corretor que não declara a comissão
   antes é o jeito mais barato de perder a comissão.

---

## 7. O bloqueio da lista, com nome

Para ligar em posto é preciso telefone, e hoje não temos:

- **A ANP dá 45.825 postos** com CNPJ, razão social, endereço, município e bandeira, de
  graça. **Não dá telefone.** Serve de espinha dorsal, não de lista de discagem.
- **A Apify, que traria telefone pelo Google Maps, está bloqueada.** Erro 403
  `platform-feature-disabled`, mensagem `Too many outstanding invoices`, desde 10/09/2026.
  O `APIFY_TOKEN` está no servidor: o problema é fatura, não configuração.
- **A Receita Federal publica telefone e e-mail** de todo CNPJ nos dados abertos, mensal
  e de graça, e casa com a ANP pelo CNPJ. É o caminho que não depende de fornecedor
  nenhum, e é trabalho de baixar e cruzar, não de contratar.

Enquanto isso, o caminho que não precisa de lista é o da seção 4: bandeira, sindicato e
integrador. São dezenas de telefonemas, não milhares, e os contatos são públicos.

---

## 8. De onde veio cada número

| número | fonte |
|---|---|
| Modelo 01 com 50% de avanço | `agendamentos`, `created_by = lp_eletroposto`, campo `Modelo de interesse:` da observação |
| 217 capital, 52 integrador, 17 ponto | tabela `eletroposto_parceria`, coluna `lado` |
| 10 inquilinos de 17 | `eletroposto_parceria`, coluna `ponto_relacao`, `lado = 'ponto'` |
| R$ 1.446/mês e payback de 2,73 anos | `CONTRATO-ARRENDAMENTO-PONTO.md`, cláusula 4.3 |
| 45.825 postos e as bandeiras | CSV de dados abertos da ANP, baixado em 28/09/2026 |
| 34 sindicatos da Fecombustíveis | página institucional da Fecombustíveis |
| Ranking das redes de farmácia e os 11% / 53% | ranking Abrafarma divulgado na imprensa do setor, 2026 |
| Apify em 403 por fatura | `prospeccao_buscas`, coluna `erro`, última em 10/09/2026 |
| 2.039 integradores com celular | `prospeccao_contatos` sem categoria |

---

## 9. O que não fazer

**Não abra pelo preço do carregador.** Quem tem posto não quer comprar equipamento, quer
saber o que ganha sem gastar. O modelo 01 existe para essa conversa e é o que mais fecha.

**Não peça reunião no primeiro toque.** Peça o cadastro do local. Reunião marcada por
quem foi procurado tem histórico ruim na casa: das 7 marcadas pela fila fria, 3 não
apareceram, e todas as 3 tinham recebido confirmação e dois lembretes.

**Não trate inquilino como descarte nem como fechado.** É conversa de duas etapas, e
pular a etapa do proprietário é descobrir isso depois do estudo pronto.

**Não prometa piso mensal sem o Thiago cravar.** É a cláusula que decide margem e
velocidade de assinatura ao mesmo tempo.

**Não escale isso pela linha IO no WhatsApp frio.** O toque frio em posto já roda com
7,5% de "não perturbar" contra um disjuntor de 8%. Bandeira e sindicato se fala por
telefone e e-mail, que não têm teto anti-ban.
