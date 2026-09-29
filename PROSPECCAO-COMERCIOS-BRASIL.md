# Chegar em todos os comércios do Brasil
### Postos, farmácias, estacionamentos, hotéis e mercados · eletroposto · 28 e 29/set/2026

> **A pergunta:** "estratégia para chegar em postos de combustível, farmácias e etc, quero
> chegar em todos do Brasil".
>
> **A resposta curta:** dá para chegar em todos, mas não por mensagem um a um. São
> **45.825 postos** só de combustível, medidos hoje no cadastro da ANP. No ritmo que a
> linha aguenta, a fila levaria **2 anos e 5 meses**, e isso sem contar farmácia. Pior: a
> fila fria já rodou 349 toques, marcou 7 reuniões e **nenhuma avançou**, enquanto a
> landing marcou 462 com cerca de 20% avançando. O que chega em todos são as duas camadas
> que já existem na casa e estão subusadas: o **anúncio**, que hoje custa R$ 18,55 por
> reunião e está comprando a métrica errada, e o **dono da bandeira**, que fala com 18.348
> postos de uma vez. O 1 a 1 continua na mesa, mas como teste de 200 toques em **10 mil
> endereços escolhidos**, não como projeto de 45 mil.

Todo número deste documento foi medido em 28 e 29/09/2026. A fonte de cada um está na seção 9.
Seguindo a convenção do `PONTO-COMO-CONSEGUIR.md`, **⚠️ marca raciocínio meu, não medido**.

> **CORREÇÃO da primeira versão, 29/09/2026.** A versão de ontem mandava subir as 362
> cidades como público do anúncio. **Eu testei contra as 462 reuniões e não se sustenta:**
> dentro das 362 a taxa de avanço é 21,5% e fora é 22,2%, praticamente igual, e o top 50
> por carência é o pior bloco, 17,0%. Restringir o anúncio jogaria fora 31% das reuniões
> sem ganhar qualidade nenhuma. A lista continua valendo para ordenar a fila 1 a 1 e para
> a conversa com bandeira e sindicato, que são perguntas sobre o ponto, não sobre o
> público do anúncio. Detalhe na seção 2. O arquivo mudou de nome para
> `PROSPECCAO-CIDADES-PRIORIDADE.txt` justamente para ninguém colar no Meta por engano.
>
> E no lugar disso entrou um achado maior, na seção 4: **a Meta não enxerga nenhuma das
> 225 reuniões dos últimos 30 dias.** Zero conversão personalizada criada na conta.

---

## 1. A aritmética que decide tudo

| | |
|---|---:|
| Postos de combustível no Brasil (ANP, cadastro de revendedores) | **45.825** |
| Municípios com pelo menos um posto | 5.525 |
| Teto diário da fila de prospecção, Thiago + Diego + Giovanna | 75/dia |
| Dias úteis para tocar 45.825 uma vez | **611** |
| Postos já na base hoje | 147 (0,3%) |
| Último toque humano na fila | **11/09/2026** |

Duas coisas se leem nessa tabela.

A primeira é que 1 a 1 não fecha a conta. Mesmo com os três consultores no teto todo dia,
sem férias e sem reunião, a primeira volta na lista de postos termina em fevereiro de 2029.

A segunda é pior e não é de capacidade. A fila está parada há dezessete dias. A Giovanna
trabalhou de 06 a 17 de agosto, com dias de 63, 40 e 39 toques, e parou. Depois disso
saíram dois toques humanos no total. **O gargalo de hoje não é o teto, é que ninguém está
na fila.** Qualquer plano que comece comprando lista nova está resolvendo o problema errado.

### O custo escondido do 1 a 1 em posto

Os 213 toques já dados em posto voltaram assim:

| resultado | n | |
|---|---:|---:|
| enviei, sem resposta | 165 | 77,5% |
| respondeu | 23 | 10,8% |
| **não perturbar** | **16** | **7,5%** |
| sem interesse | 6 | 2,8% |
| interessado | 3 | 1,4% |

O disjuntor da fila trava tudo quando o opt-out passa de **8%**. O "não perturbar" sozinho
já está em 7,5%, e somado ao "sem interesse" dá 10,3%. Ou seja: o 1 a 1 frio em posto
**já roda encostado no próprio freio**. Escalar o volume sem mexer no script não escala o
resultado, trava a fila inteira.

### E o desfecho das 7 reuniões que a prospecção marcou

Fui olhar uma a uma. A prospecção inteira deu 349 toques até hoje e marcou **7 reuniões**
pela porta `prosp_eletroposto`. O desfecho delas:

| reunião | status |
|---|---|
| Posto Turbo, Mirabela/MG | não atendeu |
| Posto Rainha da Paz, Campinorte/GO | sem interesse |
| Posto Rainha da Paz, Campinorte/GO (remarcada) | cancelado |
| Posto Estância dos Ipês | sem interesse |
| Lava jato Dois Irmãos, Alto Paraíso/GO | não atendeu |
| Felipe Scalabrin | não atendeu |
| Webert | falando no WhatsApp |

**Nenhuma avançou.** Zero proposta, zero chave na mão, zero arrendamento. Três não
apareceram na reunião marcada.

São 7 casos, amostra pequena, e "não atendeu" é falta de comparecimento, não recusa do
produto. Mas o contraste com a landing é grande demais para ignorar: **462 reuniões pela LP
com cerca de 20% avançando, contra 7 reuniões pela fila fria com 0% avançando.** Somado aos
7,5% de "não perturbar", a conclusão honesta é que **o 1 a 1 frio para posto ainda não provou
que funciona**. Ele não é o canal para escalar primeiro. É o canal para consertar e medir de
novo, com volume pequeno, antes de apostar meses de trabalho nele.

---

## 2. Onde vale a pena estar (e o mapa já estava pronto)

Eletroposto só se paga onde tem carro elétrico. A frota plug-in por município já mora no
repositório, e cruzada com o cadastro da ANP o país encolhe muito:

| corte | cidades | % dos municípios | % da frota plug-in | postos ANP |
|---|---:|---:|---:|---:|
| Todos | 5.570 | 100% | 100% | 45.825 |
| 30+ plug-in | 693 | 12,4% | 95,8% | 24.304 |
| **100+ plug-in** | **362** | **6,5%** | **91,4%** | **19.614** |
| 200+ plug-in | 229 | 4,1% | 86,9% | 16.829 |

E ordenando essas 362 pela régua de carência que a tela `/gerador/estados` já usa:

- **Top 50 cidades: 6.638 postos.**
- **Top 100 cidades: 10.016 postos e 69% da frota elétrica do país.**

Esse é o alvo real **para a fila 1 a 1**. Dez mil endereços, não quarenta e cinco mil,
cobrindo dois terços da frota elétrica do país.

### O teste que derrubou o uso desta lista como público de anúncio

Antes de mandar subir as 362 no Meta, cruzei as 462 reuniões da LP com elas. Das 461 que
têm cidade preenchida:

| faixa | cidades | reuniões | % | avançou | taxa |
|---|---:|---:|---:|---:|---:|
| Top 50 por carência | 35 | 147 | 31,9% | 25 | **17,0%** |
| Resto das 362 | 80 | 170 | 36,9% | 43 | 25,3% |
| **Fora das 362** | 123 | **144** | **31,2%** | 32 | **22,2%** |
| Total | 238 | 461 | 100% | 100 | 21,7% |

**Dentro das 362 a taxa é 21,5%, fora é 22,2%.** É a mesma coisa. E o top 50 por carência,
que era para ser o filé, é o pior bloco dos três. Restringir o anúncio às 362 jogaria fora
144 reuniões, quase um terço, sem comprar qualidade nenhuma.

**Por que a carência não prevê comprador.** A régua responde "onde falta carregador", que é
uma pergunta sobre o ATIVO. Quem compra é o dono do comércio, e a decisão dele passa pelo
payback e por ter o ponto, não pela frota da cidade dele. Araguari, Três Marias e Catalão
estão fora das 362 e somam 13 reuniões com 5 avanços.

**O cuidado que vale declarar:** isso é observação, não experimento. Os anúncios rodam em
Brasil inteiro, então as 144 reuniões de fora existem *porque* o alcance é nacional. Não dá
para concluir que um conjunto restrito às 362 iria mal. Dá para concluir, e é o suficiente,
que **não existe ganho de qualidade geográfica para colher**, e portanto a restrição não é
o ganho fácil que eu tinha anunciado.

**O que a lista continua servindo:** ordenar a fila 1 a 1 da seção 6, e municiar a conversa
com bandeira e sindicato da seção 5, onde o argumento é "seus revendedores nestas cidades
têm frota e não têm carregador". As duas são perguntas sobre o ponto, não sobre público.

Sobre o prazo da fila, com o cuidado que a seção 1 pede: no teto teórico de 75/dia dá 134 dias
úteis, uns 6 meses e meio. Só que esse teto nunca foi sustentado. O recorde real foi a
Giovanna sozinha, cerca de 40/dia por oito dias úteis, e depois a fila parou. **No ritmo
que já se provou sustentável, que é zero, o prazo é infinito.** O número que importa antes
de escolher a lista é quantas horas por dia alguém vai sentar na fila.

As dez primeiras da lista:

| # | cidade | plug-in | postos | km até o polo mais perto |
|---:|---|---:|---:|---:|
| 1 | Vitória da Conquista/BA | 1.202 | 98 | 352 |
| 2 | Fernando de Noronha/PE | 144 | 2 | 377 |
| 3 | Passo Fundo/RS | 1.143 | 53 | 164 |
| 4 | Santa Maria/RS | 942 | 56 | 260 |
| 5 | Santiago/RS | 215 | 13 | 360 |
| 6 | Brasília/DF | 35.134 | 392 | 0 |
| 7 | Mossoró/RN | 1.099 | 67 | 202 |
| 8 | Curitiba/PR | 14.240 | 348 | 0 |
| 9 | São Paulo/SP | 51.365 | 1.537 | 0 |
| 10 | Arapiraca/AL | 957 | 71 | 108 |

A lista completa das 362 está em **`PROSPECCAO-CIDADES-PRIORIDADE.txt`**, uma por linha,
**ordenada por carência**, que é a ordem da fila da seção 6. O formato de cada linha é
`Cidade, UF, Brazil` porque foi gerado para colagem no Meta antes do teste acima; o formato
é inofensivo e continua útil se um dia alguém quiser rodar um conjunto de teste separado.
**Não é para virar o público do anúncio principal**, e foi por isso que o arquivo deixou de
se chamar `-META`.

---

## 3. Quem converte, medido nas 462 reuniões da LP

A landing do eletroposto marcou 462 reuniões entre 17/07 e 28/09. Separadas por perfil, e
contando como "avançou" quem chegou a proposta, chave na mão, meio a meio, carregador ou
arrendamento:

| perfil | reuniões | avançou | taxa |
|---|---:|---:|---:|
| farmácia | 6 | 4 | **66,7%** |
| hotel | 16 | 5 | 31,3% |
| outro | 144 | 43 | 29,9% |
| estacionamento | 64 | 17 | 26,6% |
| academia | 13 | 3 | 23,1% |
| **posto** | **30** | **7** | **23,3%** |
| mercado | 15 | 3 | 20,0% |
| condomínio | 8 | 1 | 12,5% |
| **investidor** | **106** | **9** | **8,5%** |
| restaurante | 29 | 2 | 6,9% |

**A leitura que muda a estratégia:** quem tem comércio com ponto converte entre 20% e 31%.
O investidor sem ponto converte 8,5%, e é o segundo maior grupo da agenda, 106 de 462.
A casa gasta a maior parte do esforço no perfil que menos avança. Virar a mira para o
comércio é aumentar a conversão sem aumentar o volume de reunião.

**Sobre a farmácia, com honestidade:** 66,7% é a melhor taxa da tabela e vem de 6 reuniões.
Com essa amostra, uma reunião a mais ou a menos muda tudo. Há também uma razão física para
desconfiar: recarga rápida útil pede 20 a 40 minutos de permanência, e farmácia de rua é
visita de 5 minutos. O mais provável é que essas 6 sejam **donos do imóvel**, não a operação
do balcão. Vale testar com volume antes de virar segmento, e vale testar primeiro nas
**redes de drogaria com estacionamento próprio**, que é onde a permanência existe.

**⚠️ Raciocínio meu, não medido.** Ordenando os segmentos por tempo de permanência do
carro, que é o que decide se o carregador gira: estacionamento e shopping, hotel, mercado
grande, academia, posto com conveniência, restaurante, posto de pista, farmácia de rua.
Isso é dedução física, não sai de nenhuma consulta acima, e em dois pontos discorda da
tabela medida: restaurante é o pior número real (6,9%) apesar da permanência boa, e posto
converte 23,3% apesar da permanência curta. O posto provavelmente compensa por outra via,
que é o dono já entender de vender energia e já ter entrada de rede dimensionada. Se essa
ordem for usada para escolher segmento, vale marcar conjunto separado no Meta e deixar o
número decidir, porque a tabela medida já contradiz a dedução duas vezes.

---

## 4. Camada 1: o anúncio por cidade. É o que chega em todos hoje

Já funciona e é a única coisa que literalmente alcança todo mundo dentro das cidades que
importam. A LP entregou 462 reuniões em 73 dias, cerca de 6 por dia, sem gastar nenhuma
mensagem fria.

### Primeiro, o buraco: a Meta não sabe que essas reuniões existem

Fui ver a conta `Ekent- Pré Paga` por dentro. Últimos 30 dias, campanha **Nexus - ABO**,
objetivo `OUTCOME_LEADS`:

| | |
|---|---:|
| Gasto em 30 dias | R$ 4.173 |
| Reuniões marcadas pela LP no mesmo período | **225** |
| **Custo por reunião, calculado no nosso banco** | **R$ 18,55** |
| Eventos `lead` que a Meta registrou | **0** |
| Conversões personalizadas criadas na conta | **0** |

O pixel dispara, e dispara certo: são **229 `offsite_conversion.fb_pixel_custom`** contra
225 reuniões, quase um para um. Só que é um evento **personalizado que nunca foi
cadastrado como conversão** na conta. Resultado: a campanha se chama LEADS e a Meta não tem
um único lead para otimizar. Ela está comprando, na prática, visualização de página.

**É isso que explica o número que me surpreendeu.** Brasil inteiro custa R$ 1,27 por
visualização de página e as cidades perto de Uberlândia custam R$ 1,76. Parece que amplo
ganha. Mas o leilão foi mandado buscar visualização barata, e visualização barata mora
exatamente onde a concorrência é menor. Enquanto a Meta não receber a reunião, ela vai
continuar otimizando para a métrica errada, **e nenhuma decisão de público vale mais do que
consertar isso.** É o item 1 da ordem de execução.

Enquanto não conserta, a única fonte honesta de custo por reunião é o nosso banco, e ela
diz R$ 18,55.

### Depois, o resto

1. **Cadastrar a conversão e mandar o evento de volta.** Criar a conversão personalizada em
   cima do evento que já dispara, e preferencialmente subir a reunião pela API de Conversões,
   que é o que sobrevive a bloqueador e a iOS. Só então trocar o objetivo do conjunto.
2. **Separar conjunto por segmento**, usando o `utm_term` que a aba Quiz do `/admin/hubs` já
   lê. Sem isso não dá para saber se farmácia vale, e a tabela da seção 3 continua com n=6.
3. **Trocar o anúncio de link para Click to WhatsApp.** Está escrito no `WHATSAPP-OFICIAL.md`
   como passo 7, é de graça, é no gerenciador e não em código, e a medição de lá é dura:
   **0 de 868 leads desde 22/04 têm `ctwa_clid`**. Hoje o anúncio manda para a landing e a
   landing manda para o `wa.me`, que não é entrada gratuita. O CTWA abre janela legítima de
   72h e mata na origem a categoria mais cara e mais arriscada, que é abordar quem não pediu.

Essa camada custa dinheiro em vez de custar mensagem, e é a diferença entre um canal que
escala e um canal que um bloqueio derruba.

---

## 5. Camada 2: os multiplicadores. Chegar em todos por procuração

Aqui está a resposta literal ao "todos do Brasil". Não são 45 mil conversas, são algumas
dezenas.

### As bandeiras cobrem 40% dos postos do país

| bandeira | postos | % |
|---|---:|---:|
| Bandeira branca | 22.163 | 48,4% |
| **Vibra** | 6.881 | 15,0% |
| **Ipiranga** | 5.623 | 12,3% |
| **Raízen (Shell)** | 4.766 | 10,4% |
| **Ale** | 1.078 | 2,4% |
| Rodoil | 584 | 1,3% |
| Charrua | 495 | 1,1% |
| Atem's | 463 | 1,0% |

Quatro conversas alcançam 18.348 postos. Não é venda, é parceria: a distribuidora já tem
programa de eletroposto na bandeira dela e já fala com cada revendedor por canal próprio.
A pergunta que abre essa porta não é "quer comprar um carregador", é "quem instala e opera
para a sua rede no interior, onde o seu time não chega".

### A bandeira branca tem sindicato, e ele é maior que as quatro bandeiras juntas

Quase metade dos postos não tem dono único, mas tem representação. A **Fecombustíveis** tem
**34 sindicatos filiados** e se apresenta representando cerca de **40 mil postos revendedores**,
o que é quase o universo inteiro medido na ANP. É um interlocutor por estado, mais ou menos,
e é o caminho para os 22.163 de bandeira branca.

O que entra por essa porta não é o carregador. É a palestra e o estudo de viabilidade por
região, que o `/gerador/estados` e o estudo do local já produzem sozinhos, sem trabalho novo.
Sindicato não compra equipamento, mas abre agenda, manda circular e cede espaço em convenção.

### Para farmácia, o mesmo desenho

Redes e centrais de negócio concentram milhares de lojas em poucos interlocutores. Confirmar
os nomes e o tamanho de cada uma antes de escrever a abordagem, que aqui eu não medi.

### O multiplicador que já está no banco, com telefone

**2.039 empresas de energia solar** estão em `prospeccao_contatos` agora, com celular, sem
categoria e praticamente sem toque. Esse é o melhor multiplicador disponível e é de graça:
o integrador solar já entra em posto, mercado e academia para vender geração, já sabe ler
padrão de entrada, e hoje perde a conversa quando o cliente pergunta de carregador. O
`isca-integradores-solardoc` e o KIT-INTEGRADOR já existem para essa porta.

Um integrador que revende leva o eletroposto para dentro de 20 comércios que a gente nunca
vai conseguir tocar um a um. 2.039 deles é uma malha nacional que já está paga.

---

## 6. Camada 3: o 1 a 1, que precisa provar antes de escalar

Esta é a camada que a pergunta original tinha em mente, e é a que menos merece o
investimento agora. 349 toques, 22 pedidos para não incomodar, 7 reuniões, nenhuma
avançando. Antes de virar projeto de 10 mil endereços, ela precisa passar num teste.

**O teste, e é barato.** Uma rodada única de 200 toques, só nas 50 primeiras cidades da
lista, com script novo, medindo três coisas: opt-out, comparecimento e quantas avançam.
200 toques é um mês leve para um consultor. Se sair uma reunião que avança, escalar tem
base. Se sair o mesmo zero de hoje, a resposta está dada e o dinheiro vai para as camadas
1 e 2, que já provaram.

**O que consertar antes do teste.**

*O script.* 7,5% de "não perturbar" é o número que trava a fila quando o volume subir. A
regra da casa já é a certa: alegação com fonte, e quem não responde o primeiro toque não
recebe o terceiro. Medir o opt-out por script antes de escolher qual sobe.

*O comparecimento, e aqui a explicação fácil não serve.* Três das sete reuniões marcadas
ninguém apareceu. Fui conferir se tinham recebido lembrete, esperando achar aí a causa, e
não é: `prosp_eletroposto` está dentro do `EP_ORIGENS` em `eletropostoAgenda.ts`, e as três
faltas **receberam confirmação, lembrete de 1h e lembrete de 5min**, as três. Cinco das
sete receberam o pacote inteiro.

Ou seja, o não comparecimento da fila fria não é falha de automação. É a diferença entre
quem procurou a gente e quem foi procurado. Quem chega pela LP escolheu o horário depois de
responder um quiz. Quem chega pela fila fria aceitou um horário no meio de uma conversa que
não pediu, e o compromisso vale menos. Isso é argumento a favor de gastar no anúncio e não
na fila, e é o tipo de coisa que o teste dos 200 toques mede de novo com script melhor.

*A ordem da fila.* Top 50 cidades por carência, 6.638 postos, e dentro de cada cidade o
posto com maior nota no Maps, que é proxy de movimento. Não começar por São Paulo: 1.537
postos, carência alta só pelo tamanho, e a maior concorrência instalada do país.

O canal certo para o frio continua sendo a Z-API na linha IO, com a ressalva do
`linha-io-orcamento-frio-30`: numa segunda com agenda cheia o transacional come o orçamento
frio inteiro, e a fila não anda mesmo com gente trabalhando.

---

## 7. A base de "todos", e ela é de graça

As 27 buscas da Receita via Apify, enfileiradas em 03/08 com custo estimado de US$ 38, foram
**canceladas** e nunca rodaram. Não precisam voltar. As duas fontes que cobrem o país inteiro
são públicas e custam zero:

**ANP, cadastro de revendedores varejistas de combustíveis automotivos.** CSV único, 7,9 MB,
45.825 linhas, campos `RAZAOSOCIAL, CNPJ, ENDERECO, BAIRRO, CEP, UF, MUNICIPIO, BANDEIRA`.
Baixado e conferido hoje. **Não traz telefone**, então serve como espinha dorsal e âncora de
CNPJ, não como lista de discagem.

**Receita Federal, dados abertos do CNPJ.** Arquivos de Empresas, Estabelecimentos e Sócios,
atualizados mensalmente, com CNAE principal e secundários, situação cadastral, endereço,
**telefone e e-mail**. É daqui que sai farmácia, mercado, hotel, academia e estacionamento,
por CNAE, no país inteiro, com contato.

Duas armadilhas antes de tratar isso como canal de e-mail:

- **O e-mail da Receita é muito frequentemente o do contador**, não o do dono. Medir a taxa
  de resposta num lote pequeno antes de contar com o canal.
- **Se for disparar e-mail em volume, domínio separado e aquecimento.** Nunca pelo domínio
  que carrega o transacional do SolarDoc, ou uma campanha fria derruba a entrega de fatura,
  de acesso e de proposta junto.

---

## 8. A ordem de execução

Do mais barato e mais rápido para o mais caro.

1. **Fazer a reunião chegar na Meta.** Conversão personalizada cadastrada em cima do evento
   que já dispara, e a reunião subindo pela API de Conversões. Hoje são R$ 4.173 por mês
   comprando a métrica errada porque a Meta enxerga 0 de 225 reuniões. Está acima de
   qualquer decisão de público, inclusive das 362.
2. **Trocar o anúncio para Click to WhatsApp.** Horas, no gerenciador, de graça. Segunda
   maior alavanca e independe de tudo o mais.
3. **Abrir a conversa com as quatro bandeiras e com a Fecombustíveis.** Cinco telefonemas,
   18.348 postos de bandeira nas quatro e mais 34 sindicatos na federação.
4. **Ativar os 2.039 integradores que já estão no banco.** Lista pronta, canal pronto, e é a
   única forma de estar dentro de comércio que a gente nunca vai tocar.
5. **Baixar a Receita por CNAE** para farmácia, mercado, hotel, academia e estacionamento
   nas 362 cidades, e importar com telefone.
6. **O teste de 200 toques** nas top 50 cidades, com script novo, medindo opt-out,
   comparecimento e quantas avançam. Só depois desse número é que se decide se a fila 1 a 1
   merece os 10 mil endereços.

Os itens 1 a 4 não dependem de código novo nem de tela nova, e os dois primeiros saem hoje.

---

## 9. De onde veio cada número

| número | fonte |
|---|---|
| 45.825 postos, bandeiras, 5.525 municípios | CSV de dados abertos da ANP, baixado em 28/09/2026 |
| Frota plug-in por município, 362 e 693 cidades | `api/src/data/frotaPluginMunicipio.json`, SENATRAN/RENAVAM, ref. julho/2026 |
| Régua de carência e polos | mesma fórmula da tela `/gerador/estados` |
| 213 toques em posto e os resultados | `prospeccao_toques` × `prospeccao_contatos`, banco do gerador |
| Teto de 75/dia e fila parada | view `prospeccao_teto_hoje` e toques por dia |
| 462 reuniões da LP e conversão por perfil | `agendamentos`, `created_by = lp_eletroposto` |
| 7 reuniões da prospecção e o desfecho de cada uma | `agendamentos` com `created_by = prosp_eletroposto`, cruzado por telefone com `prospeccao_contatos` |
| 349 toques e os lembretes que as 7 receberam | `prospeccao_toques` e as colunas `confirmacao_at`, `lembrete_1h_at`, `lembrete_5min_at` |
| 2.039 contatos sem categoria | `prospeccao_contatos` |
| 0 de 868 leads com `ctwa_clid`, custo da oficial | `WHATSAPP-OFICIAL.md` |
| R$ 4.173, 0 eventos `lead`, 229 pixel custom, 0 conversões personalizadas | API da Meta, conta `act_545732112868250`, campanha `Nexus - ABO`, últimos 30 dias |
| 225 reuniões em 30 dias e o R$ 18,55 por reunião | `agendamentos` cruzado com o gasto da Meta no mesmo período |
| 21,5% dentro das 362 contra 22,2% fora | `agendamentos.cidade` normalizado com `unaccent`, cruzado com as 362 |
| Disjuntor de 8% de opt-out | view `prospeccao_saude` e `prospeccao-travas-v2` |
| 34 sindicatos e 40 mil postos representados | página institucional da Fecombustíveis |

Links das fontes públicas:
[ANP, dados cadastrais dos revendedores](https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/arquivos-dados-cadastrais-dos-revendedores-varejistas-de-combustiveis-automotivos/dados-cadastrais-revendedores-varejistas-combustiveis-automoveis.csv) ·
[Receita Federal, dados abertos do CNPJ](https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/) ·
[Layout dos campos do CNPJ](https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf) ·
[Fecombustíveis, sindicatos filiados](https://www.fecombustiveis.org.br/sindicatos/sindicatos-filiados/)

---

## 10. O que não fazer

**Instagram em escala.** A restrição de conversa nova na `@irmaosnaobra__` foi confirmada de
novo em 17/09 pela sonda, e o `teto_manual` está em 0 com o motivo escrito na própria linha.
Subir o teto agora não vira envio, vira tentativa falhada.

**WhatsApp oficial como canal frio.** A migração para a Cloud API resolve o bloqueio mudo da
Z-API, e está desenhada no `WHATSAPP-OFICIAL.md` como quinta prioridade, não primeira. O que
ela **não** resolve é disparo frio: template de Marketing para quem nunca pediu derruba a
taxa de leitura, e a escada de punição da Meta pausa o template por 3h, depois 6h, depois
desativa, sem ninguém denunciar nada. Oficial não é licença para volume frio, é o contrário.

**Comprar lista.** As duas fontes que cobrem o país são públicas e gratuitas, e a busca paga
que já foi enfileirada uma vez acabou cancelada sem rodar.

**Tratar farmácia como segmento.** São 6 reuniões. Testar com conjunto próprio no Meta e
medir, e olhar rede com estacionamento antes de loja de rua.

**Restringir o anúncio às 362 cidades.** Foi o que a primeira versão deste documento
mandou fazer, e o teste da seção 2 derrubou: mesma taxa dentro e fora, top 50 pior que a
média, e 31% das reuniões jogadas fora. A lista serve para a fila e para a conversa com a
bandeira, não para o público.

**Mexer em público, criativo ou orçamento antes de consertar o sinal.** Com 0 de 225
reuniões chegando na Meta, qualquer teste de público está sendo julgado por visualização
de página. Otimizar em cima disso é escolher o melhor caminho para o lugar errado.

**Escalar o 1 a 1 antes do teste.** 7,5% de "não perturbar" com disjuntor em 8% quer dizer
que mais volume trava a fila em vez de encher a agenda. E o histórico é 7 reuniões, zero
avançando. Comprar mais lista antes de virar esse zero é gastar em cima de um canal que
ainda não se pagou uma vez.

---

## Anexo. As 50 primeiras cidades da fila 1 a 1

Ordenadas pela régua de carência. A coluna postos vem do cadastro da ANP cruzado por município.
Somam **6.638 postos**. A lista das 362 está em `PROSPECCAO-CIDADES-PRIORIDADE.txt`.

| # | cidade | UF | plug-in | postos | km até o polo |
|---:|---|---|---:|---:|---:|
| 1 | Vitória da Conquista | BA | 1.202 | 98 | 352 |
| 2 | Fernando de Noronha | PE | 144 | 2 | 377 |
| 3 | Passo Fundo | RS | 1.143 | 53 | 164 |
| 4 | Santa Maria | RS | 942 | 56 | 260 |
| 5 | Santiago | RS | 215 | 13 | 360 |
| 6 | Brasília | DF | 35.134 | 392 | 0 |
| 7 | Mossoró | RN | 1.099 | 67 | 202 |
| 8 | Curitiba | PR | 14.240 | 348 | 0 |
| 9 | São Paulo | SP | 51.365 | 1537 | 0 |
| 10 | Arapiraca | AL | 957 | 71 | 108 |
| 11 | Recife | PE | 8.817 | 199 | 0 |
| 12 | Salvador | BA | 8.079 | 219 | 0 |
| 13 | Porto Alegre | RS | 7.772 | 231 | 0 |
| 14 | Pelotas | RS | 1.065 | 83 | 197 |
| 15 | Macapá | AP | 731 | 82 | 321 |
| 16 | Sinop | MT | 614 | 49 | 452 |
| 17 | Manaus | AM | 6.447 | 334 | 0 |
| 18 | Torres | RS | 254 | 15 | 123 |
| 19 | Florianópolis | SC | 4.719 | 93 | 0 |
| 20 | Belo Horizonte | MG | 15.101 | 294 | 0 |
| 21 | Chapecó | SC | 852 | 48 | 240 |
| 22 | Natal | RN | 4.223 | 106 | 0 |
| 23 | Resende | RJ | 524 | 21 | 121 |
| 24 | Maceió | AL | 3.930 | 123 | 0 |
| 25 | João Pessoa | PB | 3.870 | 122 | 0 |
| 26 | Rio Branco | AC | 691 | 60 | 442 |
| 27 | Itabuna | BA | 402 | 34 | 238 |
| 28 | Rio das Ostras | RJ | 451 | 17 | 124 |
| 29 | Boa Vista | RR | 730 | 84 | 626 |
| 30 | Porto Velho | RO | 2.705 | 135 | 0 |
| 31 | Caxias do Sul | RS | 2.466 | 96 | 0 |
| 32 | Aracaju | SE | 2.396 | 91 | 0 |
| 33 | São Luís | MA | 3.190 | 153 | 0 |
| 34 | Fortaleza | CE | 7.087 | 314 | 0 |
| 35 | Indaiatuba | SP | 2.037 | 49 | 0 |
| 36 | Vitória | ES | 2.035 | 48 | 0 |
| 37 | Cuiabá | MT | 3.209 | 149 | 0 |
| 38 | Imperatriz | MA | 563 | 69 | 468 |
| 39 | São José dos Pinhais | PR | 1.887 | 59 | 0 |
| 40 | Parnamirim | RN | 1.798 | 40 | 0 |
| 41 | Lauro de Freitas | BA | 1.761 | 42 | 0 |
| 42 | Santana de Parnaíba | SP | 1.735 | 14 | 0 |
| 43 | Barueri | SP | 1.713 | 55 | 0 |
| 44 | Balneário Camboriú | SC | 1.642 | 33 | 0 |
| 45 | Jaboatão dos Guararapes | PE | 1.623 | 51 | 0 |
| 46 | Campinas | SP | 5.401 | 167 | 0 |
| 47 | Cariacica | ES | 1.497 | 47 | 0 |
| 48 | Petrolina | PE | 1.493 | 83 | 0 |
| 49 | Niterói | RJ | 1.879 | 76 | 0 |
| 50 | Joaçaba | SC | 135 | 16 | 222 |
