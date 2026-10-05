# NEXUS PARTNER, leitura da estratégia
### O que já está decidido, o que o documento acrescenta e o que ele contraria · 25/set/2026

> **Isto não é um plano novo.** É a reconciliação entre o documento "NEXUS PARTNER, a rede
> comercial da Nexus" e o que já foi decidido e precificado em
> `PLANO-CONTAINER-ELETROPOSTO.md` (17/ago/2026, Parte 4, Trilha 2) e em
> `ECOSSISTEMA-ELETROPOSTO.md` (as 3 travas e os 9 degraus).
>
> **Preço de canal, custo por unidade e margem NÃO entram aqui.** Eles ficam no
> `PLANO-CONTAINER-ELETROPOSTO.md`, que é interno e não está versionado no git.
> Este repositório é público.

---

## 1. O nome que isso já tem

A rede de integradores descrita no documento é a **Trilha 2, Ponto Autorizado, fora do
Triângulo**, do plano do container. Ela, por sua vez, é o **Degrau 5 (Supply)** do
ecossistema, crescido e reprecificado quando o estoque passou a ser próprio.

Ou seja: a estratégia já foi adotada, tem trilha, tem preço fechado e tem limite de unidades.
O documento a redescreve por fora, com vocabulário de canal. Ele acerta a lógica
(Nexus ganha no equipamento, o integrador ganha na obra dele, ninguém paga comissão)
e é exatamente por isso que vale tratar como reforço, não como decisão nova.

## 2. O preço do exemplo não é o preço de canal

O documento usa R$ 80 mil para o carregador vendido ao integrador, e avisa que é
"exemplo apenas para entender o modelo". Lido ao pé da letra, esse número inverte a oferta:
ele fica acima do piso de mercado do concorrente, e aí o parceiro não tem negócio nenhum,
porque ele compraria mais barato de um importador maior.

O preço de canal já está fixado na Parte 4 do plano do container, junto do teto que o
concorrente impõe. **A premissa do documento sobrevive, o número não.**

## 3. A regra que o documento não tem, e é a mais importante

**O carregador nunca sai sozinho.** Nenhuma unidade deixa o estoque sem contrato de
plataforma de 24 meses assinado, com preço do equipamento condicionado a essa adesão e
claw-back proporcional se o parceiro sair antes.

O documento resolve recorrência com **recompra de carregador**. Recompra é o pior tipo de
recorrência que existe: depende do capital do parceiro, é irregular e não compõe.
A recorrência que compõe é **assinatura por ponto ativo**, e é ela que leva ao estágio 3 do
Degrau 7 (camada própria, white label), que só abre por volta de 50 pontos.

Dito de outro jeito: a rede de parceiros é o caminho mais barato que existe para chegar aos
pontos ativos que a bandeira exige. Esse é o argumento mais forte a favor do modelo, e ele
não está no documento.

## 4. O primeiro pedido é AC, não DC de 80 kW

O CTA do documento é "quer vender carregadores de 80 kW?". Essa é a pergunta errada para
abrir a relação, por três motivos:

1. O estoque destinado à trilha tem poucas unidades DC e muitas AC. A conta de
   "20 parceiros x 1 carregador por mês" quebra no inventário antes de quebrar em premissa
   de mercado.
2. O DC de 80 kW passa de 75 kW e sai da ND-5.1 da CEMIG, o que sobe a barra técnica do
   parceiro e alonga a homologação (ver memória `eletroposto-80kw-passa-de-75kw-cemig`).
3. O ciclo de venda do DC é de 90 a 120 dias e exige capital do parceiro. A wallbox AC leva
   o parceiro ao primeiro pedido em semanas, prova que ele sabe vender e instalar, e **cada
   unidade AC também é um ponto na plataforma.**

Régua de ativação: AC primeiro, DC depois do primeiro AC comissionado.

## 5. O portão do lead é geográfico, e ele não está ligado

O documento acerta ao dizer que o lead é benefício, não produto. Falta o portão.

Dentro do Triângulo, entregar um lead a um parceiro troca a margem de um turnkey pela margem
de uma caixa. É a Trava 1 do ecossistema, e ela já proíbe isso. **Lead da Nexus vai só para
fora do raio.**

Dependência de execução, corrigida depois de olhar o código: metade do caminho já existe.
O `GET /io/eletroposto/parceria/pares` resolve cidade em latitude e longitude com uma tabela
de municípios no servidor e já cruza por distância com um teto em km. O que falta não é a
resolução geográfica, é a UF vir estruturada na entrada e existir a regra de dentro/fora do
raio para o lado integrador. Enquanto essa regra não existir, nenhuma promessa de lead deve
ir para um parceiro, porque a distribuição continua dependendo de alguém olhando ficha a
ficha. A página nova já manda a UF em seleção, que é o lado da entrada.

## 6. PARTNER PRO e MASTER precisam ficar do lado certo da linha

Escalonar por volume de compra é distribuição normal. O risco aparece nos benefícios que o
documento lista junto: co-marketing, campanhas conjuntas, bandeira.

As três negativas do contrato continuam valendo, e são elas que separam licença de franquia
de fato (Lei 13.966/2019, que dispararia COF obrigatória):

- Sem exclusividade de território. Não se promete cidade a ninguém.
- Sem royalty sobre a obra do parceiro. Cobra-se equipamento (produto) e plataforma (serviço),
  nada sobre o faturamento dele.
- Sem imposição de método e sem a marca na fachada como bandeira. "Ponto Autorizado" é selo
  de plataforma.

E as exclusões da Trava 3 seguem por escrito: sem ART da Nexus, sem representação na
concessionária, sem garantia de obra. Garantia é de fábrica.

## 7. A plataforma não precisa ser construída

O documento diz "eu não criaria aplicativo agora". Está certo, e dá para ser literal:
o teste de 90 dias roda inteiro no que já está no ar.

| O que o parceiro precisa | Onde já existe |
|---|---|
| Orçamento, estudo, deck, contrato, recibo, proposta bancária | `/gerador`, já branco NEXUS no eletroposto |
| Simulador de retorno | `/gerador` e a LP `/io/eletroposto` |
| Página de captura de parceiro | `/nexus/partner`, construída em 25/09. A porta antiga continua em `/io/eletroposto/parceria` |
| Gravação do cadastro e aviso à equipe | `POST /io/eletroposto/parceria` com `lado: integrador`, que **já existia** com as colunas `integrador_*` |
| Login e entrega de treinamento | SolarDoc, módulo de cursos, conta criada por webhook |
| CRM do parceiro e do lead | `agendamentos` mais as etiquetas dinâmicas de origem no `/admin` |
| WhatsApp de relacionamento | Central das Agentes |
| Catálogo público e preço | `/nexus` |

O que falta é configuração e conteúdo, não software.

**Descoberta que encurta o teste:** a terceira porta da `/io/eletroposto/parceria` já é o
integrador, e o backend já aceita `lado: 'integrador'` com colunas próprias
(`integrador_atuacao`, `integrador_interesse`, `integrador_experiencia`, `integrador_equipe`),
upsert por telefone e aviso interno no WhatsApp. Não faltava cadastro de parceiro, faltava
uma página que vendesse a relação de canal em vez de convidar o integrador a executar a obra
dos outros. É isso que a `/nexus/partner` faz, reusando o mesmo endpoint, sem migration.

Os campos que não têm coluna hoje (empresa, projetos por mês, região atendida e o perfil A,
B ou C calculado na página) entram no texto de `obs`, que é onde a equipe já lê antes de
ligar. Criar coluna para isso só vale depois que o teste provar que a lista merece.

## 7-bis. Depois do cadastro não existe nada, e esse é o buraco real

Conferido no `POST /io/eletroposto/parceria`: quando alguém se cadastra, o que acontece é
gravar a linha, carimbar a ficha do funil e mandar **um aviso interno** para os dois números
da casa. **Nada chega no parceiro.** Sem WhatsApp, sem e-mail, sem login, sem material.
O comentário na própria rota diz isso com todas as letras desde 17/08: "ninguém recebe
mensagem por se cadastrar".

Para o funil de investidor isso era decisão consciente. Para uma rede de canal é o furo
principal, porque é exatamente a Etapa 4 do documento (onboarding) e é o momento em que o
integrador está mais quente que vai estar nos próximos trinta dias.

**O que já foi feito, e é de graça:** a tela de sucesso da `/nexus/partner` deixou de ser um
"recebido" e virou próximo passo. Diz o que vem na ordem (olham a região, mandam a tabela,
perguntam o primeiro projeto) e entrega um WhatsApp já preenchido com nome, empresa, região
e atuação, para quem não quer esperar tomar a iniciativa sem digitar nada de novo. Isso
tapa o vácuo sem tocar em produção.

**O que ainda falta, e é decisão sua, não minha:**

| Peça | O que resolve | Por que não fiz sozinho |
|---|---|---|
| Boas-vindas automática no WhatsApp | Tira o parceiro do vácuo sem depender de alguém lembrar | Manda mensagem de verdade, passa pelo teto da linha, pela janela diurna e pela regra de 1 toque 1 mensagem. Mexer nisso sem você é risco de banimento da linha |
| Entrega da tabela e do treinamento | É a promessa da página, e hoje é manual | Precisa decidir se é login no SolarDoc (rails já existem) ou PDF por e-mail |
| Etiqueta de origem `nexus_partner` | Separa esses cadastros dos outros dois lados no `/admin` | Uma linha, mas é banco de produção |

A ordem que eu faria: etiqueta, depois entrega da tabela por login, e boas-vindas automática
só por último, quando já houver o que entregar do outro lado da mensagem.

## 8. Onde encontrar os 20 primeiros parceiros sem gastar em anúncio

A lista mais barata já está dentro de casa: os usuários do `/gerador` e os compradores da
isca de R$ 27 do Kit do Integrador são integradores solares e de elétrica, que é exatamente
o perfil A e B do documento. Anúncio frio é o caminho caro, e é o segundo, não o primeiro.

## 9. Quem assina

Marketing e tudo que o parceiro vê é NEXUS. O instrumento jurídico do eletroposto
(contrato de fornecimento, recibo, proposta de banco) sai em nome da **AIOROS GROUP
LTDA, CNPJ 63.636.043/0001-88**, sede em Uberlândia/MG — é ela que os documentos da
aba Eletroposto do `/gerador` emitem. Entre 29/09 e 30/09/2026 essa emitente foi a
IMPORTADORA ARAGUARI LTDA; o dono desfez a troca em 30/09 e a AIOROS voltou, então
agora é o mesmo CNPJ do Pix, do Asaas, da conta bancária e do SolarDoc.
Ver a memória `gerador-eletroposto-marca-nexus`.

Risco que cresce junto com o sucesso da rede: em 15/09 havia 4 ou mais pedidos anteriores com
NEXUS na classe 37 do INPI. Selo de plataforma em painel de parceiro é uma exposição pequena.
Marca em fachada, Brasil inteiro, é outra. É a terceira negativa do item 6, e agora ela tem
motivo comercial além do jurídico.

## 10. O indicador

O documento propõe "quantos parceiros compram Nexus todo mês", que já é muito melhor que
"quantas pessoas estão na comunidade". Ainda é possível melhorar uma casa:

**Pontos ativos na plataforma.** É o número que compõe, que sobrevive a um mês sem pedido de
equipamento e que destrava o estágio 3 do Degrau 7. Nos primeiros 18 meses, esse é o placar.

## 11. O teste de 90 dias, corrigido

Mantém os 20 integradores e o desenho de medição do documento (CAC, ativação, ticket,
recompra, LTV, margem, custo de suporte, ROI). Muda quatro coisas:

1. Preço de canal é o da Parte 4 do plano do container, não os R$ 80 mil do exemplo.
2. Primeiro pedido é AC. DC entra depois do primeiro AC comissionado.
3. Contrato de plataforma de 24 meses sai grudado em toda unidade, sem exceção.
4. Nenhum lead prometido antes de o campo de cidade virar seleção. Até lá, distribuição na
   mão e sem promessa no material.

E a meta do teste não é faturamento. É descobrir quantos dos 20 chegam ao segundo pedido,
porque é isso que diz se existe canal ou se existem 20 compras avulsas.
