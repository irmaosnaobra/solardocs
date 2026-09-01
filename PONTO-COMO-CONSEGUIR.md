# PEÇA 2 — Como conseguir o ponto (originação, abordagem e negociação do local)

# PEÇA 2 — Como conseguir o ponto
### Originação, abordagem e negociação do local · Irmãos na Obra · 30/ago/2026

> **Para quem é:** o investidor que tem capital e não tem onde instalar. Hoje são **122 pessoas
> na base** com capital declarado — 13 na faixa de R$ 50–100 mil, 11 na de R$ 100–200 mil e 2 acima
> de R$ 200 mil — contra **um único dono de ponto cadastrado**. O dinheiro não é o gargalo. O ponto é.
>
> **A tese, na palavra do dono:** *"A dor desse cliente não é dinheiro. É entrar no mercado, ter o
> ponto correto, e saber como estruturar esse contrato e o fechamento."*
>
> **O funil confirma:** investidor converte **5,4%** das reuniões em proposta contra **16,8%** de quem
> tem negócio próprio com fluxo na porta. E ter o ponto não conserta o perfil — **investidor com ponto
> converte 6%**. Ou seja: não basta arrumar um endereço. Tem que ser o endereço certo, com a energia
> certa, no papel certo. É isso que este capítulo ensina.
>
> **De onde veio cada número:** simulador de `/io/eletroposto` e `computeEletro` do `/gerador`
> (mesma fórmula, conferida ao centavo). Réguas de qualificação: as do formulário da LP e as da
> `/io/eletroposto/parceria`. Cláusulas citadas: `CONTRATO-ELETROPOSTO.md` (turnkey) e
> `CONTRATO-OPERACAO-PLATAFORMA.md` (recorrente). Desenho do arrendamento:
> `ARQUITETURA-CONTRATOS-ELETROPOSTO.md`, instrumento ⑥.
>
> **⚠️ = decisão minha, não do Thiago.** Tabela completa no fim, uma linha por marca.
> **PONTO PARA O ADVOGADO** = onde a regra jurídica importa e eu não tenho certeza.

---

## 0. Antes de tudo: o número da capa não é o seu número

O simulador da landing roda com **arrendamento = 0**. Isso é de propósito e está escrito no código:
o público da LP — posto, mercado, academia, condomínio — **já é dono do espaço**, e cobrar aluguel
de quem paga a si mesmo derrubava margem e payback sem motivo.

**Você é a exceção.** Você vai pagar aluguel a alguém. Então o número que você viu na página não é
o seu. Ligue o arrendamento e olhe de novo.

**Cenário de referência deste capítulo** — 80 kW · investimento R$ 144.595 · 10 carros/dia ·
revenda R$ 2,35/kWh · custo da energia R$ 0,70/kWh · 20 kWh por recarga · taxa de ativação
R$ 1,20 por sessão · 30 dias. É a configuração recomendada e o cenário conferido da casa.
**Todas as contas deste capítulo mantêm esta configuração fixa** — trocar para 60 ou 120 kW muda
investimento e capacidade, e portanto muda tudo.

| | Sem aluguel (o que a LP mostra) | Com 10% de arrendamento |
|---|---:|---:|
| Faturamento/mês | R$ 14.460 | R$ 14.460 |
| Aluguel do ponto | — | **R$ 1.446** |
| Lucro líquido/mês | R$ 6.933 | **R$ 5.487** |
| Margem | 47,95% | **37,95%** |
| Payback | 2,27 anos | **≈ 2,7 anos** |

**Leia a última linha devagar.** O aluguel do ponto custa **cerca de 5 meses e meio de payback**.
Não é detalhe de rodapé — é a diferença entre o negócio que você imaginou e o negócio que você vai ter.
E é exatamente por isso que **negociar o ponto é onde você ganha ou perde dinheiro**, não na compra
do carregador.

> **Cuidado com o terceiro número.** O PDF do Estudo de Viabilidade ainda roda sobre
> R$ 160.000, não sobre R$ 144.595. Quem comparar a LP com o estudo vai ver paybacks
> diferentes. Use sempre a mesma base, e diga qual é.

**A régua que você vai usar o capítulo inteiro:**

> **Cada carro por dia vale R$ 1.446 de faturamento por mês.**
> (20 kWh × R$ 2,35 = R$ 47,00 + R$ 1,20 de ativação = **R$ 48,20 por carro** × 30 dias.)
> **10% disso é R$ 144,60.**

Guarde esses dois números. Eles convertem qualquer conversa de aluguel em carros por dia, e é assim
que você descobre, na hora, se a proposta do dono do imóvel é cara ou barata.

---

## 1. O que conta como "ponto" — três travas, nesta ordem

A régua da casa mudou em 29/08/2026 e virou **ponto próprio**: só marca reunião quem tem o local
na mão. Não é burocracia — é a constatação de que 16 das 63 reuniões de um período de 13 dias foram
com gente que nunca tinha falado com o dono do imóvel.

Um endereço só vira **ponto** quando passa nas três travas:

**Trava 1 — Alguém controla o imóvel, e esse alguém fala com você.**
As respostas que a casa aceita são: *sou o proprietário · administro o local · represento o
proprietário · sou inquilino*. Todas as quatro servem, com ou sem escritura no seu nome — **quem tem
a chave do lugar fecha negócio**. O que não serve é *"ainda não é meu, pretendo alugar ou comprar"*.
Isso é intenção, não ponto.

**Trava 2 — A energia aguenta, ou você sabe quanto custa fazer aguentar.**
Três informações resolvem, e as três estão de graça na conta de luz e no quadro do relógio:
**tipo de ligação**, **disjuntor geral** e **consumo em kWh/mês**. Um carregador de 80 kW é carga
nova, e é mais do que a maioria dos imóveis comerciais tem contratada inteira. Quando o padrão não
aguenta, a saída é entrada de energia própria — transformador e nicho —, o que custa dinheiro e
meses de espera. **Um ponto ótimo com padrão pequeno vira projeto caro. Um ponto mediano com padrão
forte fecha rápido.**

**Trava 3 — Passa carro, e o carro fica tempo suficiente.**
Fluxo sozinho não basta. O que interessa é **carro que para** e **fica parado o bastante para
carregar**. No 80 kW a régua da casa dá capacidade para até 30 carros/dia — e capacidade não é
previsão de movimento. Quem estima quantos carros param no seu ponto é você, medindo.

> **A ordem importa.** Você não negocia preço antes da trava 2, e não visita antes da trava 3.
> Cada trava pulada tem preço com nome — e o preço da trava 2 pulada é descobrir a carga
> **depois de assinar**.

---

## 2. Onde estão os pontos

### 2.1 Por tipo de imóvel

A ordem abaixo não é opinião: é a régua de perfil que a própria casa usa para pontuar lead
(`PESO_PERFIL`). Quem tem fluxo próprio na porta vale 3, quem tem fluxo menor vale 2, e quem não
tem fluxo próprio depende inteiramente da rota.

| Peso | Tipo de imóvel | Por que o dono topa | O que ele teme | O sinal de que vale a visita |
|:---:|---|---|---|---|
| **3** | **Posto de combustível** | Já vive de carro parando; vê o elétrico como o cliente que ele está perdendo | Perder vaga de bomba; conflito com a bandeira | Pátio com área ociosa fora das bombas e loja de conveniência ativa |
| **3** | **Mercado / supermercado / atacado** | Recarga é tempo de loja: o carro carregando é cliente comprando | Vaga de cliente ocupada por quem não compra | Estacionamento próprio, grande, com rotatividade de 30–60 min |
| **3** | **Estacionamento** | Aluga espaço por natureza; entende metro quadrado como receita | Vaga rendendo menos que a diária | Pátio coberto ou fechado, 24h, com movimento constante |
| **3** | **Hotel / pousada** | Carro dorme lá; é diferencial de reserva sem custo operacional | Hóspede reclamando de vaga tomada | Estacionamento próprio e público que roda de carro (rota, turismo) |
| **2** | **Restaurante / lanchonete / conveniência** | Permanência boa (a refeição é a recarga) e diferencial na fachada | Fila e manobra no horário de pico | Estacionamento próprio na frente, movimento de almoço e jantar |
| **2** | **Academia** | Permanência longa e clientela de renda mais alta | Vaga de aluno ocupada | Estacionamento próprio e horário de pico definido |
| **2** | **Farmácia** | Fachada visível, funciona à noite | Permanência curta demais | Só vale se estiver em avenida com fluxo, não em rua de bairro |
| **2** | **Condomínio** | Valoriza o empreendimento e resolve um problema que já bate na assembleia | Assembleia, rateio de energia, morador contra | Condomínio com vaga de visitante e síndico profissional |
| **0** | **Shopping / galeria** | Fluxo e permanência altos | Decisão lenta, várias camadas | Só entre se você chegar em quem decide — não no gerente da loja |
| **0** | **Terreno em rota** | Renda de terreno parado | Nada a perder — mas nada a ganhar se não passar carro | Rodovia com tráfego medido e ponto de parada natural por perto |

> **A coluna "Peso 0" não quer dizer ponto ruim.** Quer dizer **sem fluxo próprio** — quem responde
> pelo movimento nesses casos é a rota, e a rota tem régua separada: **rodovia ou corredor de
> tráfego vale 2 · área comercial movimentada vale 1 · "não sei estimar" vale 0**. Se o seu ponto é
> peso 0 e você respondeu "não sei estimar o movimento", você não tem um ponto — tem uma esquina.

### 2.2 Por tipo de dono (é aqui que a conversa muda)

O mesmo imóvel tem conversas completamente diferentes dependendo de quem está do outro lado:

| Quem é | O que move ele | Como abrir | Armadilha |
|---|---|---|---|
| **Proprietário que opera o negócio** | Cliente na porta. Ele quer movimento, não aluguel | Fale de **cliente**, não de renda: *"o carro carregando fica 40 minutos na sua loja"* | Ele vai querer o negócio inteiro pra ele. Isso é bom — vira cliente de turnkey, não arrendador |
| **Proprietário rentista (imóvel alugado a terceiro)** | Renda com zero trabalho | Fale de **renda por metro quadrado ocioso** | Ele não decide sozinho: o inquilino usa o espaço. Precisa dos dois |
| **Inquilino / operador do ponto** | O negócio dele, não o imóvel | Fale como o item acima, mas **exija a anuência escrita do proprietário** | Fechar só com ele e descobrir o proprietário depois. Isso mata o contrato |
| **Administrador / franqueado** | Meta e regra da rede | Descubra em 1 pergunta se ele decide. Se não decide, peça o nome de quem decide | Gastar três visitas com quem só pode dizer "não" |
| **Síndico / condomínio** | Não ter problema na assembleia | Leve pauta pronta e resposta de rateio de energia | Achar que o síndico decide. Quem decide é a assembleia |
| **Espólio / família / imóvel em inventário** | Sair da inércia | Descubra **quem assina** antes de qualquer coisa | Assinar com um herdeiro e descobrir que eram cinco |

### 2.3 Onde procurar, na prática

1. **Mapa dos aplicativos de recarga.** Abra os apps e olhe onde **já tem** ponto. O que você
   procura é o buraco: o trecho de avenida ou o trecho de rodovia sem nenhum ponto num raio
   grande. Esse mapa é gratuito e é o seu mapa de concorrência.
2. **Vista de rua (Street View) antes do carro.** Dá pra ver a fachada, contar vagas, ver onde
   está o padrão de entrada e medir a distância da entrada de energia até onde o carregador
   ficaria. Você elimina metade dos endereços sem sair de casa.
3. **Placas de "aluga-se" em pátio comercial e imobiliárias de imóvel comercial.** Dono de imóvel
   comercial parado é quem menos resiste a uma conversa.
4. **O cadastro da própria casa.** A `/io/eletroposto/parceria` recebe dono de ponto. Hoje há **um**.
   É pouco — e é exatamente por isso que este capítulo existe: quem vai encher esse cadastro é
   trabalho de campo, não de anúncio.
5. **Associações e sindicatos locais** — de postos, de supermercados, de hotelaria. Uma reunião
   de associação vale trinta portas.
6. **Redes e franquias:** nunca comece pela loja. Comece por quem decide a rede.

---

## 3. Qualificar antes de falar — a mesa antes da porta

Bater na porta é caro. Cada visita é meio dia. Antes de qualquer contato, responda estas oito
perguntas — e responda com as **mesmas palavras que o cadastro da casa usa**, para que a sua anotação
de campo entre direto na ficha sem retrabalho. Dois formulários, uma régua só.

| # | Pergunta | Respostas aceitas (as do cadastro) | Onde se descobre sem falar com ninguém |
|---|---|---|---|
| 1 | **O local é de quem?** | Sou o proprietário · Administro · Represento · Sou inquilino · Estou negociando | Matrícula do imóvel, IPTU, placa na fachada, CNPJ no Google |
| 2 | **Que tipo de local?** | Estacionamento · Posto · Supermercado/atacado · Shopping/galeria · Hotel/pousada · Restaurante/conveniência · Condomínio · Terreno em rota · Outro | Olhando |
| 3 | **Quantas vagas?** | 1–2 · 3–5 · 6–10 · mais de 10 | Vista de rua, contando |
| 4 | **Como é o movimento?** | Rodovia/rota · Avenida movimentada · Rua comercial · Movimento próprio · Movimento fraco | Contagem própria (ver 3.1) |
| 5 | **Tipo de ligação** | Trifásico (4 fios) · Bifásico (3 fios) · Monofásico (2 fios) · Não sei | Conta de luz. Ou foto do padrão |
| 6 | **Disjuntor geral** | Até 40 A · 40–63 A · 63–100 A · Acima de 100 A · Não sei | O número gravado no disjuntor, dentro da caixa do relógio |
| 7 | **Consumo médio** | Até 500 · 500–2.000 · 2.000–10.000 · Acima de 10.000 kWh/mês | Conta de luz |
| 8 | **Consegue foto do padrão e da conta?** | Hoje mesmo · Preciso ir ao local · Não consigo | Só perguntando |

> **"Não sei" é resposta aceita — e tem preço.** Cada "não sei" das perguntas 5, 6 e 7 empurra a
> resposta para uma visita técnica, e visita entra em fila. Se você conseguir **uma foto do padrão
> e uma da conta de luz**, resolve sem visita. Essa foto é o ativo mais barato desta profissão.

### 3.1 Medir movimento, não sentir

"É movimentado" não é dado. O protocolo mínimo:

- Conte **carros que ENTRAM no local**, não carros que passam na rua. Ponto de recarga vive de quem
  para.
- **Três janelas de 30 minutos**, em **dois dias diferentes** (um útil, um sábado), nos horários que
  o local diz ser de pico.
- Anote **quanto tempo o carro fica**. É a variável que decide a potência: no 80 kW, os 20 kWh da
  régua saem rápido, e **quando o carro aceita menos potência que a máquina entrega, quem manda no
  ritmo é o carro**.
- Converta: **cada carro/dia que você acredita conseguir vale R$ 1.446/mês de faturamento**. Se você
  contou movimento que sustenta 6 carros/dia, seu faturamento é ~R$ 8.676 — e não os R$ 14.460 do
  cenário de referência.

⚠️ *Faixa de permanência por tipo de imóvel — posto 5–10 min, farmácia 10–15, mercado 30–60,
restaurante 60–90, academia 60–90, hotel a noite inteira — é **estimativa minha**, não medição da
casa. Serve para ordenar a sua fila de visitas, não para entrar em proposta.*

### 3.2 O corte: três perguntas que matam o ponto antes da visita

Se qualquer uma vier assim, não vá:

1. **"Quem é o dono?"** → *"Não sei" / "É de um pessoal aí"* → você não tem com quem negociar.
2. **"Quantas vagas dá pra separar?"** → *"Talvez uma"* → dois bicos precisam de duas vagas mais
   circulação. Uma vaga é um ponto que nasce estrangulado.
3. **"Passa carro que PARA aqui?"** → *"Passa muito carro na rua"* → passar não é parar.

---

## 4. Os primeiros 30 segundos

Você tem uma frase para dizer quem é, uma para dizer o que quer, e uma para pedir a única coisa que
importa. Nada mais. **O objetivo dos 30 segundos não é fechar nada — é sair de lá com a foto da conta
de luz e do padrão de entrada.**

### 4.1 Presencial, no balcão

> **"Bom dia. Meu nome é [nome], eu trabalho com estação de recarga de carro elétrico aqui na
> região.**
>
> **Eu não vim vender nada pro senhor. Eu instalo a estação por minha conta, no meu equipamento e no
> meu nome — o que eu procuro é o espaço. Duas vagas ali no canto, que ficam paradas.**
>
> **A pergunta que decide se dá ou não dá aqui é a energia do local. O senhor consegue me mandar uma
> foto da conta de luz e uma do quadro do relógio? Com isso em uma semana eu volto e te digo se o seu
> ponto presta ou não — e se não prestar eu te falo também."**

Três coisas estão acontecendo nessas frases:

- **"Eu não vim vender nada"** desarma. Ele está esperando um vendedor.
- **"Por minha conta, no meu nome"** já responde metade das objeções antes de elas nascerem.
- **"Se não prestar eu te falo também"** compra credibilidade barata e é verdade — a maioria dos
  pontos não presta.

### 4.2 Por WhatsApp (quando você achou o telefone antes de achar o dono)

> **"Bom dia, [nome]. Falo do [cidade] — trabalho com estação de recarga de carro elétrico.**
>
> **Estou procurando dois lugares aqui na região pra instalar. O investimento é meu: equipamento,
> obra e operação. O que eu preciso do dono do local é o espaço de duas vagas.**
>
> **Antes de tomar seu tempo com visita, dá pra resolver por foto: uma da conta de luz e uma do
> quadro onde fica o relógio. Se a energia do local aguentar, a gente conversa. Se não aguentar, eu
> te aviso e não incomodo mais. Pode ser?"**

### 4.3 Por telefone

Mesma estrutura, mas com uma diferença: **peça o WhatsApp na primeira frase útil** e mande a foto
pedida por escrito. Pedido de foto por telefone não vira foto.

### 4.4 A pergunta que fecha os 30 segundos, sempre a mesma

Não é *"o senhor tem interesse?"*. É:

> **"Consegue me mandar a foto da conta de luz e a do padrão de entrada?"**

Interesse é opinião e muda. Foto é ação e qualifica.

---

## 5. O que NÃO dizer nos primeiros 30 segundos

| Não diga | Por quê |
|---|---|
| **"Sociedade" ou "parceria"** | As duas palavras significam *equity* na cabeça de quem ouve — e abrem a porta do "quero uma parte" antes de você ter qualquer número na mão |
| **Qualquer valor. Nem faixa.** | Você ainda não sabe se o padrão aguenta. Preço dito antes da conta de luz vira âncora que você não desfaz |
| **"O senhor vai ganhar R$ X por mês"** | É promessa de rendimento. Nenhum documento da casa promete faturamento, e nenhum deve |
| **"Não te custa nada"** | Custa: custa vaga, custa obra no piso dele, e pode custar energia se a instalação não for em medidor próprio. Dizer isso antes de saber é criar um problema pra daqui a três meses |
| **"Só uma autorizaçãozinha pra eu protocolar"** | Assinatura pedida de surpresa mata a confiança e, se ele assinar sem ler, mata o contrato depois |
| **"Eu vou instalar aqui"** | Você não sabe. Diga "eu vou **avaliar** se cabe aqui" |
| **kW, OCPP, CCS2, REN 819, parecer de acesso** | Jargão. Ele não é engenheiro e vai achar que a conversa é complicada demais pra ele |
| **Deixar ele falar o preço primeiro** | Quem fala o número primeiro define a régua. E o dono de imóvel chuta alto, porque ele está precificando "novidade", não metro quadrado |
| **Pedir exclusividade já** | Exclusividade antes de viabilidade é o pedido que faz o dono desconfiar |

---

## 6. A segunda conversa — a da conta de luz

É onde a venda acontece de verdade. Você chega com três coisas:

1. **A leitura da conta dele**, em português: *"o seu local é trifásico, disjuntor de X amperes,
   e consome Y kWh por mês."*
2. **O tamanho do problema**, sem enfeite: *"a estação que eu quero instalar é carga nova. Ou ela
   entra no padrão que já existe, ou eu preciso trazer entrada de energia própria — e isso é obra
   na concessionária, que custa e demora."*
3. **A pergunta de decisão**, uma só: *"se der certo na energia, o senhor separaria duas vagas
   ali?"*

**O que você ainda NÃO faz nesta conversa:** falar valor de aluguel, falar prazo, e pedir assinatura.
Você só sai daqui com um "sim, se der certo" e com a autorização verbal para a visita técnica.

**O que você registra:** endereço completo, relação dele com o imóvel, número de vagas, movimento,
os três números da energia, e quem assina. É a ficha do cadastro, inteira.

---

## 7. As objeções — e a resposta de cada uma

### 7.1 "Vai furar meu piso" / "vai estragar meu pátio"

**O que ele está perguntando de verdade:** *como fica o meu pátio quando isso acabar?*

**Resposta:**

> *"Vai ter obra, sim — base pro equipamento, caminho pro cabo e o quadro. Nada disso é improvisado:
> sai desenhado em planta antes de o senhor assinar, e o senhor aprova o desenho.*
>
> *Duas coisas que ficam por escrito no contrato: a obra é minha e sai limpa — entulho removido e o
> que a minha equipe danificar é recomposto por mim. E, no fim do contrato, eu retiro o equipamento e
> devolvo o espaço no estado em que peguei."*

A primeira metade já é obrigação contratual do turnkey — **"manter o Local organizado, remover
entulho e recompor o que for danificado por sua equipe"**. Pode dizer com segurança.

> 🚧 **A segunda metade ainda não existe em papel nenhum.** Nenhum dos seis instrumentos da
> arquitetura tem cláusula de **retirada e recomposição do local no fim do contrato**. A reserva de
> domínio e o direito de retomada do turnkey protegem a Irmãos na Obra, não o dono do imóvel.
> É a primeira coisa que todo proprietário pede, e o instrumento ⑥ precisa nascer com ela.
> **PONTO PARA O ADVOGADO** — a redação decide quem paga a recomposição e em que estado o local
> é devolvido; sem isso, o fim do contrato vira discussão sobre benfeitoria.

**O que nunca dizer:** *"não vai furar nada"*. Vai.

### 7.2 "E a minha conta de luz?"

**A resposta honesta tem uma premissa, e a premissa é a resposta inteira.**

> *"A recarga não entra na sua conta. A estação tem **medidor próprio, unidade consumidora nova, no
> meu nome** — a conta da energia vendida vem pra mim, e a sua continua exatamente como está hoje.*
>
> *E eu preciso que seja assim, não é favor: quem responde pela energia da operação sou eu."*

**O número que prova:** no cenário de referência, 10 carros/dia consomem **6.000 kWh por mês**. Se
isso caísse na conta dele, seriam cerca de **R$ 4.200/mês** na régua de custo do simulador. É por isso
que a resposta certa é medidor separado — e é por isso que a resposta errada só aparece três meses
depois, quando a conta chega.

Os contratos da casa já assumem essa arquitetura: a unidade consumidora é identificada no preâmbulo
do turnkey, o investidor é quem **mantém a UC adimplente**, e a **energia consumida na operação não
está inclusa no preço da obra** — ela é dele.

> **PONTO PARA O ADVOGADO (e pergunta para a distribuidora):** quando **não** for possível abrir UC
> nova — condomínio, galeria, imóvel com uma única entrada —, a saída improvisada em campo é
> **sub-medição com reembolso ao dono do imóvel**. Isso muda quem é o titular da energia, quem emite
> o quê, e como o consumo é comprovado numa discussão. Não improvise: essa é a objeção que se
> desmancha **depois** da assinatura.

### 7.3 "E se não der certo?"

**O que ele está perguntando:** *eu fico com um ferro velho no meu pátio e sem receber nada.*

> *"Se não der certo, o prejuízo é meu. O equipamento é meu, a obra é minha, e o dinheiro parado é
> meu — o senhor não põe um real.*
>
> *O seu risco é o espaço e o tempo. Por isso duas coisas ficam escritas: **prazo com data pra
> acabar** e **retirada com recomposição** — eu tiro o equipamento e devolvo o pátio.*
>
> *E é justamente por isso que eu prefiro te pagar um percentual do que entra, e não um valor fixo:
> se o ponto não faturar, o senhor não recebe — mas também não perde. Se faturar bem, o senhor ganha
> junto."*

Essa última frase é o pivô: **a objeção "e se não der certo" é a melhor porta de entrada para o
percentual**. Use.

### 7.4 "Quero uma parte" — são três pedidos diferentes, e só um tem resposta "sim"

Essa é a objeção mais cara do capítulo, porque ela costuma ser respondida como se fosse uma só.
São três instrumentos diferentes:

**a) Percentual sobre o FATURAMENTO — sim. É a régua da casa.**

O simulador trabalha com **10% de arrendamento** e o instrumento ⑥ já foi desenhado assim:
remuneração em percentual sobre o faturamento do ponto, não aluguel fixo. Funciona porque:

- É **auditável sem abrir os seus livros**: o painel da plataforma mostra sessões, kWh e faturamento.
- Ele **não carrega custo nenhum** — não paga energia, não paga manutenção, não paga imposto.
- Ele vira **aliado**: dono que ganha percentual manda cliente pro ponto, coloca placa, reclama
  quando o equipamento está fora do ar.

> *"Uma parte **do que entra**, não do que sobra. É o modelo que a gente usa: um percentual sobre o
> faturamento da estação, todo mês, com o relatório da plataforma na sua mão."*

**b) Percentual sobre o LUCRO — não. Nunca.**

- Abre a sua contabilidade para o dono do imóvel e transforma **toda despesa em discussão**.
- Ele não carrega a rampa: nos primeiros meses o ponto opera abaixo do regime pleno, e é você quem
  banca isso.
- "Lucro" é o número que **você** controla — e é exatamente por isso que ninguém do outro lado
  aceita o seu número sem auditar.

> *"Sobre o lucro eu não faço, e vou ser franco do porquê: aí a gente ia discutir todo mês o que é
> despesa e o que não é. Sobre o faturamento é um número só, e ele está no relatório."*

**c) Sociedade / cota do negócio — outro contrato, outra conversa.**

Isso **não é arrendamento**. Muda quem responde pelo CNPJ, pela tarifa, pelo imposto e pela dívida.

> **PONTO PARA O ADVOGADO.** Nenhum dos seis instrumentos da arquitetura cobre sociedade. Se o dono
> do imóvel entra como sócio, o instrumento ⑥ não serve, e o que existe hoje na casa não resolve.
> Não improvise um "contrato de parceria" — improviso aqui vira litígio societário.

**A frase de manejo, quando ele diz "quero uma parte" e você ainda não sabe qual das três:**

> *"Parte de quê, exatamente? Porque tem três jeitos bem diferentes e um deles eu faço com prazer."*

### 7.5 As outras quatro que aparecem sempre

| Objeção | Resposta |
|---|---|
| **"O imóvel é alugado / eu sou inquilino"** | *"Sem problema — mas eu vou precisar da autorização escrita do proprietário, porque a obra é fixa."* Não é preciosismo: o turnkey exige que o CONTRATANTE comprove legitimidade sobre o imóvel e, **sendo o imóvel locado, apresente a anuência escrita do proprietário**. Fechar só com o inquilino é assinar um contrato que não se executa |
| **"E se eu quiser vender o imóvel?"** | *"O contrato prevê isso: ou ele acompanha o imóvel pro comprador, ou eu retiro o equipamento com aviso e prazo."* **PONTO PARA O ADVOGADO** — se o arrendamento vale contra quem comprar o imóvel depende de registro/averbação, e isso eu não verifiquei. Decidir antes de assinar o primeiro |
| **"Quanto tempo vocês querem o espaço?"** | Diga o prazo, e diga por quê: *"o investimento leva perto de três anos pra voltar. Contrato curto não fecha a conta — nem pra mim nem pro senhor, que ia ver isso sair na hora que começasse a render."* ⚠️ O prazo mínimo é decisão do dono da casa |
| **"Já veio outro aqui"** | Ótimo sinal — o ponto presta. *"E o que ele te ofereceu?"* Deixe ele falar. Se o outro ofereceu fixo, você entra com percentual e o argumento do 7.3. Se ofereceu percentual, você entra com **energia por sua conta, medidor próprio, retirada e recomposição por escrito** — que é onde quase ninguém escreve nada |

---

## 8. A régua de negociação: fixo, percentual ou misto

### 8.1 A conversão que decide tudo

> **Um aluguel fixo de R$ X equivale a 10% do faturamento quando o ponto faz `X ÷ 144,60` carros por dia.**

| Aluguel fixo | Equivale a 10% se o ponto fizer |
|---:|---:|
| R$ 500 | 3,5 carros/dia |
| R$ 700 | 4,8 carros/dia |
| R$ 1.000 | 6,9 carros/dia |
| **R$ 1.446** | **10 carros/dia** *(o cenário de referência)* |
| R$ 2.000 | 13,8 carros/dia |
| R$ 2.892 | 20 carros/dia |

> **O divisor não é constante.** R$ 144,60 é 10% dos R$ 48,20 que **um** carro deixa na régua da
> casa (20 kWh × R$ 2,35 + R$ 1,20 de ativação). Se você for vender a recarga a outro preço, o
> divisor muda junto — refaça: `preço do kWh × 20 + ativação`, e tire 10%.

**Como usar na hora:** o dono pediu R$ 1.200/mês? Isso é 8,3 carros/dia. Se você acredita que o
ponto faz mais que isso, **o fixo é mais barato pra você**. Se acredita que faz menos, o fixo é caro
e você deve empurrar para o percentual.

### 8.2 O que acontece na prática — mesma configuração, três movimentos

Tudo abaixo é 80 kW · R$ 144.595 · R$ 2,35 de revenda · R$ 0,70 de custo, **em regime pleno
(mês 24 em diante, ponto já maduro)**. Só o movimento muda. A rampa vem na seção seguinte, e é ela
que separa o fixo do percentual.

| Em regime pleno | 5 carros/dia | 10 carros/dia | 20 carros/dia |
|---|---:|---:|---:|
| Faturamento/mês | R$ 7.230 | R$ 14.460 | R$ 28.920 |
| Lucro **sem** aluguel | R$ 3.256 | R$ 6.933 | R$ 14.287 |
| Lucro com **10%** | R$ 2.533 | R$ 5.487 | R$ 11.395 |
| Lucro com **fixo de R$ 1.446** | R$ 1.810 | R$ 5.487 | R$ 12.841 |
| **Quanto o aluguel come do lucro — 10%** | 22% | 21% | 20% |
| **Quanto o aluguel come do lucro — fixo** | **44%** | 21% | 10% |

**Leia a última linha.** É o capítulo inteiro em três números:

- **O percentual come sempre a mesma fatia** — em qualquer cenário, cerca de um quinto do lucro.
- **O fixo é uma aposta.** Se o ponto for bom, o fixo é o melhor negócio que existe. Se o ponto for
  fraco, o fixo **dobra** o peso do aluguel e come quase metade do que sobra.
- Você não sabe qual dos três cenários é o seu ponto. **É por isso que a régua padrão é o percentual.**

> ⚠️ **Não pare nesta tabela.** Na coluna de 10 carros/dia o fixo e o percentual empatam — e esse
> empate é falso, porque a tabela é de **regime pleno**. No **mês 1** o ponto opera a metade da
> ocupação: o faturamento é de cerca de R$ 7.230, os 10% custam **R$ 723**, e o fixo custa os
> **R$ 1.446 inteiros** — o dobro, no mês em que você tem menos caixa. A próxima seção mede
> quanto isso vale.

### 8.3 O detalhe da rampa (que quase ninguém vê)

Mesmo empatando em regime pleno, fixo e percentual **não empatam no payback**:

| Aluguel | Lucro em regime pleno | Payback |
|---|---:|---:|
| Nenhum | R$ 6.933 | 2,27 anos |
| **10% do faturamento** | R$ 5.487 | **≈ 2,7 anos** |
| **Fixo de R$ 1.446** | R$ 5.487 | **≈ 2,9 anos** |

Os dois pagam o mesmo por mês quando o ponto está cheio. O fixo é pior porque **corre inteiro desde
o mês 1**, e no mês 1 o ponto opera a metade da ocupação (a rampa da casa vai de 50% a 100% em 24
meses). No mês 1, 10% do faturamento é cerca de R$ 723 — o fixo já cobraria os R$ 1.446.

> **A frase pro dono do imóvel:** *"eu prefiro o percentual porque no começo o ponto não fatura
> nada. Se eu te prometo um fixo alto no mês 1, eu quebro antes de o negócio pegar — e aí o senhor
> perde o inquilino."*

### 8.4 A régua, em ordem de preferência

**1º — Percentual puro sobre o faturamento (10%).** É o padrão. Use sempre que:
- o ponto é novo e não tem histórico de recarga;
- o movimento é estimado, não medido;
- o dono está ansioso por "participar" — o percentual satisfaz esse desejo sem custar upside fixo;
- você está em rampa (ou seja: sempre, no começo).

**2º — Misto: piso mínimo + percentual, o que for maior.** Use quando o dono não aceita percentual
puro. Desenho recomendado:
- o **piso só começa depois da rampa** (o percentual puro vale nos primeiros meses);
- o piso é sempre **abaixo** do valor que o percentual daria no seu cenário conservador;
- fica escrito **"o maior entre"**, nunca "piso mais percentual" — somar os dois é pagar duas vezes.

⚠️ *Existe piso? De quanto? A partir de que mês? Decisão do dono da casa. Um piso alto demais na
rampa é o que quebra o ponto no ano 1.*

**3º — Fixo puro.** Só quando **três coisas** forem verdade ao mesmo tempo:
- o ponto é comprovadamente de alto fluxo (rodovia, mercado grande, estacionamento cheio) e você
  **mediu**, não sentiu;
- o valor pedido equivale a menos carros/dia do que você acredita fazer (tabela 8.1);
- o dono não aceita nada além de previsibilidade.

**4º — O que não é dinheiro.** Antes de subir o percentual, ofereça o que custa menos:
- **placa e visibilidade** na fachada, com o nome do local nos aplicativos de recarga (o ponto entra
  no mapa com o nome dele — para comércio, isso vale muito);
- **prioridade de vaga** em horário definido;
- **condição preferencial de recarga** para os carros dele. *Cuidado:* isso é custo real, sai do seu
  bolso, e a tarifa é sua para definir — não vire promessa aberta.

### 8.5 O que NUNCA ceder

1. **A tarifa.** Quem opera define o preço da recarga — é assim que está escrito nos dois contratos
   da casa (turnkey Cl. 12.3 e operação Cl. 6.1). Dono de imóvel definindo tarifa quebra a conta e
   cria um problema que vai muito além deste ponto. *(A arquitetura da casa lembra que esse mesmo
   princípio de livre preço é de duas pontas: ele te protege aqui e é o argumento que um advogado usa
   contra cláusula que amarre a operação de alguém. Use-o para não ceder a tarifa, não para prender
   ninguém.)*
2. **A propriedade do equipamento.** O carregador não é benfeitoria do imóvel. Isso precisa estar
   escrito — inclusive porque, até a quitação, o equipamento **nem seu é**: o turnkey o vende com
   reserva de domínio.
3. **O direito de retirar no fim.** Sem cláusula de retirada, o fim do contrato entrega o ativo ao
   imóvel.
4. **Percentual sobre lucro** (7.4-b).
5. **Exclusividade sem prazo ou sem contrapartida** — e **nunca** aceite cláusula que te proíba de
   instalar em outro ponto da mesma cidade. Você está montando uma operação, não um ponto.
6. **Prazo curto.** Com 10% de arrendamento, o payback é de cerca de 2,7 anos no cenário de
   referência. Contrato que acaba antes de o dinheiro voltar não é contrato, é doação. ⚠️
7. **Reajuste fora de índice.** Os dois contratos da casa reajustam por **IPCA**. Aluguel que
   reajusta "por combinação" reajusta por humor.
8. **Aluguel começando na assinatura.** Ele começa **na primeira recarga**. Há precedente na
   própria casa: o contrato de operação tem **90 dias de carência** do percentual sobre faturamento,
   justamente porque nesse período o ponto ainda não tem demanda formada. ⚠️
9. **Assinar o definitivo antes do parecer de acesso** (seção 9).
10. **Os dados operacionais.** Sessões, kWh e faturamento são seus — é assim que o contrato de
    operação já define. O dono do imóvel recebe **relatório**, não acesso.

---

## 9. O fechamento

### 9.1 A ordem — e por que ela é essa

Existe um problema de galinha e ovo aqui, e ele é a razão de tudo o que vem abaixo: **você não
protocola na distribuidora sem ter direito sobre o imóvel** (o turnkey exige comprovação de
legitimidade sobre o local e procuração para representar o titular perante a distribuidora) — e você
**não quer assinar um arrendamento de anos antes de saber se o ponto é viável**.

A saída é a mesma lógica que o turnkey já usa quando o parecer é negado: **dois estágios**.

| Etapa | O que acontece | Por que nesta posição |
|:---:|---|---|
| **0** | **Quem assina.** Matrícula ou IPTU, contrato social ou procuração, contrato de locação se for inquilino | Descobrir na etapa 6 que eram cinco herdeiros custa o projeto inteiro |
| **1** | **Os três números da energia.** Foto do padrão + conta de luz: ligação, disjuntor, kWh/mês | É gratuito e elimina a maioria dos endereços |
| **2** | **Instrumento curto: opção / exclusividade de arrendamento, com prazo** ⚠️ | Trava o ponto pelo tempo do estudo, custa pouco, e é o papel que te autoriza a gastar com projeto |
| **3** | **Visita técnica e estudo de viabilidade do endereço** | Aqui aparece o custo real: distância da entrada, necessidade de transformador, posição das vagas |
| **4** | **Solicitação de acesso protocolada na distribuidora** | Só aqui se descobre se vai ter obra de reforço na rede — que **não está inclusa** no turnkey e corre por conta do investidor |
| **5** | **Parecer de acesso aprovado + custo de reforço conhecido** | **Antes disto, o número final do investimento não existe** |
| **6** | **Arrendamento definitivo assinado** (instrumento ⑥) | Agora você sabe quanto o ponto custa e quanto ele rende. Só agora dá pra dizer quanto vale o aluguel |
| **7** | **Turnkey (③) + Operação (②), mesma mesa, mesmo dia** | É o desenho da arquitetura da casa: dois instrumentos separados, assinatura simultânea |
| **8** | **Obra, comissionamento e primeira recarga** | A primeira recarga é o marco de entrega, não a instalação física |

> ⚠️ **VERIFICAR ANTES DE ADOTAR COMO REGRA:** não está confirmado se a distribuidora aceita um
> instrumento de **opção/exclusividade** como prova de direito sobre o imóvel para o protocolo de
> acesso, ou se exige o **contrato de arrendamento definitivo**. Se exigir o definitivo, as etapas 2
> e 6 se fundem e a proteção do investidor muda de natureza — passa a depender de uma **condição
> resolutiva vinculada ao parecer** dentro do próprio arrendamento. É uma pergunta de 20 minutos
> para a concessionária e ela reordena este capítulo. **PONTO PARA O ADVOGADO.**

### 9.2 O custo de inverter a ordem

| Se você inverter | O que custa |
|---|---|
| Assinar o arrendamento **antes** do parecer | Você paga aluguel de um ponto que pode ser inviável. A saída do turnkey te devolve o dinheiro da obra descontado o projeto — **mas não devolve o aluguel** |
| Protocolar **sem** papel assinado com o dono | Ele fecha com outro depois que você pagou o projeto e a ART. E o turnkey exige comprovação de legitimidade sobre o imóvel para protocolar |
| Falar valor de aluguel **antes** da conta de luz | Você ancora um preço sem saber se vai precisar de transformador — e transformador muda o investimento inteiro |
| Pedir a foto do padrão **depois** da visita | A resposta vira visita técnica, e visita entra na fila |
| Fechar com o inquilino **sem** o proprietário | Contrato que não se executa. A anuência escrita do proprietário é exigência do próprio turnkey |

### 9.3 Checklist: o que precisa estar na mão antes de assinar

**Do imóvel e de quem assina**
- ☐ Matrícula atualizada **ou** IPTU + contrato de locação (se inquilino)
- ☐ Contrato social ou procuração de quem vai assinar
- ☐ **Anuência escrita do proprietário**, se o local for locado
- ☐ Anuência do condomínio ou da assembleia, quando aplicável
- ☐ Certidões do imóvel (ônus, penhora) — **PONTO PARA O ADVOGADO:** decidir se entram sempre ou só
  acima de certo porte

**Da energia**
- ☐ Conta de energia dos últimos 3 meses
- ☐ Tipo de ligação, disjuntor geral e consumo médio anotados
- ☐ Foto do padrão de entrada e do disjuntor
- ☐ **Parecer de acesso aprovado**, com o custo de reforço de rede escrito em número
- ☐ Definição de como fica a unidade consumidora: **UC nova no nome do investidor** (o padrão) ou
  sub-medição com reembolso (a exceção que precisa de advogado)

**Do negócio**
- ☐ Estudo de viabilidade do endereço **com o aluguel já descontado** — não o cenário sem arrendamento
- ☐ Croqui ou planta com posição do carregador, das vagas e do caminho do cabo, aprovado pelo dono
- ☐ Prazo, forma de reajuste (IPCA), carência de início do aluguel e percentual definidos
- ☐ Cláusula de **retirada e recomposição** no fim do contrato
- ☐ Cláusula de **sucessão** — o que acontece se o imóvel for vendido
- ☐ Definição de quem paga o quê: energia, conectividade, seguro do ativo, IPTU

**Antes da caneta**
- ☐ **Revisão de advogado.** O instrumento ⑥ ainda não existe — nada aqui vai a um dono de imóvel
  sem passar por um

---

## ⚠️ Decisões do dono — tabela completa

Uma linha para cada ⚠️ deste arquivo.

| # | Onde | Decisão |
|---|---|---|
| 1 | Seção 0 e 2.3 | **A Irmãos na Obra acha o ponto pro cliente, ou ensina o cliente a achar?** A FAQ da LP promete "ajuda a achar e negociar o local"; a régua de 29/08 corta esse lead da agenda; o rodapé da /parceria se isenta do acordo. Três promessas diferentes no ar ao mesmo tempo |
| 2 | Capítulo inteiro | **Este material é isca ou produto?** Se sai de graça, canibaliza o Degrau 8-a (corretagem de ponto), que é receita desenhada e nunca construída |
| 3 | 8.1 e 8.4 | **10% é régua fixa ou faixa de negociação?** O simulador usa 10%. Vira "de 8% a 12%" na mão do investidor, ou é número travado? |
| 4 | 8.4 | **Existe piso mínimo no misto?** De quanto, e a partir de que mês da rampa |
| 5 | 8.5 item 8 | **Quando o aluguel começa** — na primeira recarga, ou com carência fixa espelhando os 90 dias do contrato de operação? |
| 6 | 7.5 e 8.5 item 6 | **Prazo mínimo do arrendamento.** Com 10%, o payback é ~2,7 anos no cenário de referência. Abaixo de quantos anos a casa não recomenda fechar? |
| 7 | Seção 2 e 9 | **A casa cobra comissão de corretagem sobre o arrendamento?** Quanto, de qual lado (investidor ou dono do ponto), uma vez ou recorrente. O instrumento ⑥ prevê a comissão, e nenhum número foi definido |
| 8 | 9.1 etapa 2 | **Quem paga o instrumento curto de exclusividade e as certidões do imóvel** — o investidor, ou entra no pacote da casa? |
| 9 | 9.3 | **O investidor pode usar o estudo de viabilidade da casa para negociar com o dono do imóvel?** Encosta na decisão já aberta sobre uso do Business Plan para captar terceiro |
| 10 | 3.1 | **A tabela de permanência por tipo de imóvel é assunção minha.** Publica com o aviso, ou tira? |

---

## PONTOS PARA O ADVOGADO — consolidado

| Onde | Pergunta |
|---|---|
| 7.1 | Redação da cláusula de **retirada e recomposição** do local no fim do contrato — quem paga, em que estado devolve, e como evitar que o equipamento seja tratado como benfeitoria |
| 7.2 | Quando **não** houver UC nova: sub-medição com reembolso ao dono do imóvel é viável? Quem é o titular da energia, o que se emite, e como o consumo se comprova em juízo |
| 7.4-c | Se o dono do imóvel quiser entrar como **sócio**, nenhum dos seis instrumentos serve. Que veículo se usa? |
| 7.5 | O arrendamento vale contra **quem comprar o imóvel**? Depende de registro ou averbação? Em que cartório? |
| 9.1 | A distribuidora aceita instrumento de **opção/exclusividade** para o protocolo de acesso, ou exige o arrendamento definitivo? Se exigir, como se protege o investidor — condição resolutiva vinculada ao parecer? |
| 9.3 | Certidões do imóvel entram sempre no checklist ou só acima de certo porte de investimento? |

---

## O que este capítulo não faz

Ele não substitui o instrumento ⑥. **O Contrato de Arrendamento / Corretagem do ponto ainda não
existe** — a arquitetura o desenhou (esqueleto na minuta de cooperação da CEMIG convertida para
onerosa, remuneração em percentual sobre faturamento, comissão de corretagem da casa e direito de a
Irmãos na Obra ser a operadora do ponto) e ele nunca foi escrito.

Este capítulo é o que acontece **antes** dele: como achar o ponto, como abordar, como negociar e
o que precisa estar na mesa quando a minuta finalmente existir. **Enquanto ⑥ não for escrito e
revisado por advogado, nenhum investidor deve assinar arrendamento com o modelo que ele achar na
internet.**

---

## Decisões que dependem do Thiago

- A Irmãos na Obra ACHA o ponto pro cliente, ou ENSINA o cliente a achar? A FAQ da LP promete 'ajuda a achar e negociar o local'; a régua de 29/08 corta esse mesmo lead da agenda; o rodapé da /parceria se isenta do acordo. Três promessas diferentes no ar ao mesmo tempo — e este capítulo assume a terceira (ensinar).
- Este material é isca ou produto pago? Se sai de graça, canibaliza o Degrau 8-a (corretagem de ponto), que é receita desenhada na arquitetura e nunca construída.
- 10% de arrendamento é régua travada ou faixa de negociação (ex.: 8% a 12%) na mão do investidor? O simulador usa 10% fixo.
- Existe piso mínimo no modelo misto (piso + percentual, o maior entre os dois)? De quanto, e a partir de que mês da rampa — um piso alto demais no ano 1 quebra o ponto.
- Quando o aluguel começa a correr: na primeira recarga, ou com carência fixa espelhando os 90 dias de carência do percentual que já existe no Contrato de Operação (Cl. 5.8)?
- Prazo mínimo do arrendamento. Com 10%, o payback vai a ~2,7 anos no cenário de referência (80 kW, R$ 144.595, 10 carros/dia). Abaixo de quantos anos a casa não recomenda fechar?
- A casa cobra comissão de corretagem sobre o arrendamento? Quanto, de qual lado (investidor ou dono do ponto), e uma vez só ou recorrente. O instrumento ⑥ prevê a comissão e nenhum número foi definido.
- Quem paga o instrumento curto de exclusividade/opção da etapa 2 e as certidões do imóvel — o investidor, ou entra no pacote da casa?
- O investidor pode usar o Estudo de Viabilidade da casa para negociar com o dono do imóvel? Encosta na decisão já aberta na arquitetura sobre uso do Business Plan para captar terceiro.
- A tabela de permanência por tipo de imóvel (posto 5–10 min, mercado 30–60, academia 60–90…) é assunção minha, não medição da casa. Publica com o aviso, ou tira?

## Riscos conhecidos

- Conflito de interesse estrutural: o instrumento ⑥ prevê comissão de corretagem da IO sobre o arrendamento, e este capítulo ensina o investidor a pagar MENOS de arrendamento. Os dois lados da mesa viram a mesma casa — precisa ser resolvido antes de ⑥ ser escrito.
- Contradição viva em três documentos no ar: a FAQ da LP promete 'a gente faz o estudo de região e ajuda a achar e negociar o local'; a régua de 29/08 manda quem está negociando o local para NOTA 1; o rodapé da /parceria diz que a IO 'não é parte do contrato entre investidor e proprietário'. Um lead que leu a FAQ e caiu na NOTA 1 tem razão em reclamar.
- Nenhum dos seis instrumentos da arquitetura tem cláusula de RETIRADA E RECOMPOSIÇÃO do local no fim do contrato. É a primeira coisa que todo dono de imóvel pede, e o capítulo instrui o investidor a prometê-la — sem que exista minuta que a honre. A reserva de domínio e a retomada do turnkey protegem a IO, não o proprietário.
- Canibalização do Degrau 8-a: entregar o método de originação de graça mata a receita de corretagem de ponto antes de ela existir.
- Três paybacks circulando ao mesmo tempo: 2,27 anos (LP, sem arrendamento, sobre R$ 144.595), ~2,7 anos (real do investidor, com 10%) e o número do PDF do Estudo, que ainda roda sobre R$ 160.000. O investidor entra na conversa com o número errado na cabeça.
- NÃO VERIFICADO: se a distribuidora aceita instrumento de opção/exclusividade como prova de direito sobre o imóvel para o protocolo de acesso, ou se exige o arrendamento definitivo. Se exigir, a ordem de fechamento da seção 9 muda e a proteção do investidor passa a depender de condição resolutiva.
- NÃO VERIFICADO: se o arrendamento vale contra quem comprar o imóvel, e se isso depende de registro ou averbação. Um ponto vendido no meio do contrato pode virar perda total do investimento.
- Sub-medição com reembolso quando não há UC nova (condomínio, galeria, entrada única) é a saída que a maioria vai improvisar em campo, e é a que mais dá problema depois da assinatura. Sem orientação escrita, cada investidor inventa a sua.
- O bloqueio 🚧 da arquitetura continua aberto: o contrato com o fornecedor da plataforma nunca foi lido. ⑥ prevê o direito de a IO ser a operadora do ponto de terceiro — se o fornecedor proibir atender ponto que não foi obra da casa, essa cláusula não se honra.
- As faixas de permanência por tipo de imóvel e o corte de 'uma vaga é ponto estrangulado' são assunção minha, não medição da casa — estão marcados no texto, mas um consultor pode citá-los como se fossem número da IO.