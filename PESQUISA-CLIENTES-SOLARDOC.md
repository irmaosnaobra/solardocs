# Pesquisa com os 10 clientes mais contínuos — WhatsApp

**Status: LIGADA em 18/08/2026.** Depois do deploy, o master cron horário manda UMA mensagem por
hora, das 9h às 20h, até falar com os 10. Para parar no meio: `PESQUISA_WHATSAPP_OFF=1` na Vercel.

## Quem entra: os mais atuantes, medidos por continuidade

A régua não é volume, é **dia útil trabalhado**: dias distintos com documento ÷ dias úteis
disponíveis desde que a pessoa entrou (teto de 30 dias). Quem fez 300 documentos em 3 dias e sumiu
não é uso contínuo; quem faz 5 por dia, todo dia, é.

Dois pisos, por motivos opostos: **≥5 dias ativos** derruba quem entrou anteontem e marcaria 100%
com 2 dias de amostra (Junior Moraes, 100% com 4 dias de casa, ficou de fora por isso); **usou nos
últimos 3 dias** derruba quem foi contínuo e parou — leoimplant marca 36% e está 11 dias sumido, e
esse é caso de winback, não de pesquisa.

| # | Quem | Documentos / dias (30d) | Dias úteis | Telefone | Fonte | Abre com |
|---|---|---|---|---|---|---|
| 1 | *(sem nome)* — obras@alya.srv.br | 128 / 24 | 20 de 22 · **91%** | 5543999345490 | sales | Oi, |
| 2 | MT Energia Solar | 22 / 8 | 6 de 7 · **86%** | 5588999809326 | sales | Oi, |
| 3 | Alessandro Madruga Goulart & Cia | 111 / 25 | 18 de 22 · **82%** | 5551999944150 | company | Oi, |
| 4 | Átomo Energia Solar | 9 / 5 | 5 de 7 · **71%** | 5567996651568 | sales | Oi, |
| 5 | Ronailson Klesley Cardoso Vieira | 53 / 20 | 15 de 22 · **68%** | 5563984404428 | company | Oi, |
| 6 | VFF Energia Solar | 52 / 14 | 11 de 17 · **65%** | 5519988288802 | users | Oi, |
| 7 | American Energy Solar | 32 / 14 | 13 de 22 · **59%** | 5566999984955 | company | Oi, |
| 8 | Juliano Silvério Grilo | 34 / 11 | 7 de 12 · **58%** | 5519996264359 | users | **Oi Juliano,** |
| 9 | Max Oliveira de Sousa | 29 / 13 | 12 de 22 · **55%** | 5521998357829 | users | **Oi Max,** |
| 10 | GSI Soluções | 31 / 15 | 11 de 22 · **50%** | 5538999569898 | company | Oi, |

Ficaram de fora do corte de 10, na ordem: Sunwise (41%), Lucas da Luz Energy (41%), Carlos Jesse da
OnGrid (36%), Rômulo (36%) e New Energy RS (27%). Estão prontos — subir `TOP_N` no serviço convida
eles sem mexer em mais nada.

Os números foram conferidos um a um: todos com 13 dígitos e 9 na frente, ou seja, celular — nenhum
fixo, que receberia a mensagem no vazio e ainda contaria como enviada. Só dois dos 10 abrem com nome
próprio (Juliano e Max): o resto tem razão social no cadastro, e "Oi American," ou "Oi 67.010.604,"
entrega o robô na primeira linha. "Oi," resolve — no WhatsApp isso é como gente escreve.

**Cobertura de telefone: 10 de 10.** Em `users.whatsapp` a maioria não tinha número — o resto veio de
`sales.phone` (confirmado no checkout) ou `company.whatsapp` (o que eles imprimem nos próprios
documentos). Sem cruzar as três fontes, a pesquisa por WhatsApp perderia os dois primeiros da lista.

Max (9) já cancelou uma vez e continua usando todo dia. Quando ele responder, vale você entrar na
conversa pessoalmente.

## A mensagem

Uma bolha, sem link e sem botão — link em mensagem não pedida é o que faz o WhatsApp marcar como
spam. Exemplo real, como chega para o primeiro da lista:

> Oi, aqui é o Thiago do SolarDoc.
>
> Você é um dos que mais usam a plataforma — 128 documentos em 24 dias diferentes só nesse último mês. Queria muito te ouvir sobre 3 coisas:
>
> 1) O que o SolarDoc mais te ajuda no dia a dia?
> 2) Antes dele, você fazia isso como? Planilha, Word, outra plataforma?
> 3) O que ainda falta ou te irrita aqui dentro?
>
> Pode responder por áudio, do jeito que for mais fácil. A 3 é a que mais me interessa — pode ser sincero.
>
> E se a sua resposta ficar boa, posso publicar ela na página do SolarDoc com seu nome e o da sua empresa? É só me falar.

A pergunta 2 não pergunta "o que é melhor que as outras plataformas" de propósito: isso assume que a
pessoa usou outra, e quem veio de planilha trava. Você recebe a comparação igual e ainda descobre
quantos vieram do zero. A pergunta 3 é a que paga a conta — CAC ~R$154 contra ~R$110 de valor de
vida, cancelamento mediano em 12 dias. E o pedido de autorização existe porque sem ele você junta
depoimentos ótimos que não pode publicar.

## A cadência (o ponto do bloqueio)

A campanha **não tem cadência própria**. Ela pede vez no mesmo orçamento anti-ban da Carla, que é o
teto único da linha solardoc — o mesmo que já foi estourado antes. Na prática:

- no máximo **4 mensagens/hora** somando pesquisa + follow-ups da Giovanna;
- **10 a 15 minutos** entre uma mensagem e a seguinte, com jitter sorteado (régua fixa é padrão
  detectável tanto quanto rajada);
- só entre **9h e 20h**, nunca no domingo;
- **uma pessoa = uma mensagem**, sem sequência, sem segundo toque;
- cada chamada do cron manda **uma** e vai embora.

Com o master cron de hora em hora, os 10 escorrem em **um dia útil**. É devagar de propósito: 10
mensagens numa hora é assinatura de robô, 10 espalhadas ao longo do dia é gente trabalhando.

## Acompanhar e parar

Ver a lista e quem já recebeu (o segredo vai no header, como em todas as rotas `/cron`):

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://api.solardoc.app/cron/pesquisa-satisfacao"
```

Isso devolve os 10, os telefones, quem já recebeu e o texto exato da mensagem.

Para **parar**: `PESQUISA_WHATSAPP_OFF=1` na Vercel — vale no próximo tick, sem deploy. O que já saiu
não repete (`users.pesquisa_sent_at`).

Para adiantar uma mensagem sem esperar a hora cheia:

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://api.solardoc.app/cron/pesquisa-satisfacao?enviar=1"
```

## O que foi construído

| Peça | Onde |
|---|---|
| Seleção por continuidade + telefone de 3 fontes + envio | [pesquisaSatisfacao.ts](api/src/services/pesquisaSatisfacao.ts) |
| Rota de preview e disparo | [cron.ts](api/src/routes/cron.ts) → `/cron/pesquisa-satisfacao` |
| Entrada no master cron (inerte sem a env) | [cron.ts](api/src/routes/cron.ts) |
| Cliente não cai mais como lead no robô de vendas | [sdrAgentService.ts](api/src/services/agents/sdr/sdrAgentService.ts) |
| Colunas `pesquisa_sent_at` / `pesquisa_respondida_em` | migration aplicada no solardoc-pro |
| Versão por e-mail, pronta e não usada | [mailer.ts](api/src/utils/mailer.ts) → `sendPesquisaSatisfacaoEmail` |

**Correção que veio junto:** o poller do robô de vendas só pulava quem tinha o número em
`users.whatsapp`. Como 10 desses 15 têm o telefone só em `company`, um cliente pagante que
respondesse ia cair como lead novo e receber pitch de venda da plataforma que ele já assina. Agora o
poller também consulta `company.whatsapp` — mas **só para quem recebeu a pesquisa, e só por 14 dias**.
Silenciar todo `company.whatsapp` calaria o agente em 78 conversas já existentes; conserto grande
demais para entrar de carona nesta tarefa.

**Código não usado:** a versão por e-mail (`sendPesquisaSatisfacaoEmail`) ficou pronta antes da troca
de canal e não é chamada por ninguém. Deixei no lugar caso você queira um segundo toque por e-mail
para quem não responder — mas hoje ela está inerte, não é um segundo canal ligado.

## Depois que as respostas chegarem

Elas caem na linha solardoc. Me peça pra tabular — leio a conversa pelo `conversa_wa()` no banco,
separo em "o que ajuda" / "com o que comparou" / "o que falta" e entrego os depoimentos autorizados
prontos pra entrar na página.

## Deploy

Serviço novo, rota/master cron, poller do SDR e o mailer foram num commit só (`cron.ts` sozinho não
compila). `tsc` limpo. A primeira mensagem sai no primeiro tick do master cron depois do build ficar
READY, se estiver dentro da janela de 9h–20h.

## Fora do assunto, mas sério

O aviso do Supabase de hoje: `users`, `sales`, `documents` e mais 36 tabelas do solardoc-pro estão
com RLS desligada — quem tiver a chave anon lê e escreve tudo. Mesmo problema que provei no gerador
em 18/08. Não mexi.

---

# Resultado da 2ª rodada — lido em 21/08/2026

**22 pessoas já receberam** (10 na 1ª rodada, 12 desde 20/08). `TOP_N` está em 20: o número passou
porque a lista é **re-rankeada a cada tick** — quem esfria cai do top e abre vaga pra quem entrou
usando. Não é bug, mas tem um efeito colateral: o **cimigno@gmail.com** recebeu *"você é um dos que
mais usam a plataforma — 5 propostas para 4 clientes"*. Com 5 propostas a frase deixou de ser
verdade. Se a régua não subir, a próxima leva abre com um elogio que o cliente sabe que é falso.

**Chegaram 4 respostas novas aproveitáveis** desde a última leitura (19/08): Vicente, Antônio
Henrique, Eduardo Boso e o Max. Outras 3 foram **robô de recepção do próprio cliente** respondendo
ao nosso robô (Luz Energy, EJB, RC Projetos) e 1 foi áudio de intermediário.

## 1) O que mais ajuda

| Quem | Fala |
|---|---|
| **Vicente** · VFF Energia Solar (Campinas/SP) | *"A praticidade do sistema: fazendo o download da fatura, ele calcula o consumo médio. E a agilidade de editar contrato, recibo, procuração."* |
| **Antônio Henrique** · Exxel Solar (Xique-Xique/BA) | *"Praticidade na confecção das propostas."* |
| **Eduardo Boso** · Eclipse Solar (Sarandi/PR) | *"Agilidade."* |
| **Max** · GreenMax Solar (Maricá/RJ) | *"Pra mim tá ótimo."* |

Nenhuma palavra sobre aparência, de novo. É velocidade e é a proposta — o mesmo que a base já disse
em 19/08.

## 2) Com o que comparou — os 3 vieram de plataforma paga

| Quem | De onde veio |
|---|---|
| **Vicente** | *"Uso a iSales, plataforma muito boa também, mas **o custo é alto pelo que oferecem**."* |
| **Antônio Henrique** | *"Tinha outro CRM. **O custo benefício dessa proposta me fez optar**."* |
| **Eduardo Boso** | *"Plataforma da Reonic."* |

**3 de 3 trocaram uma plataforma paga pela nossa, e 2 disseram "custo" sem serem perguntados.** O
ângulo de [COPY-SOLARDOC-DOR-MENSALIDADE.md](COPY-SOLARDOC-DOR-MENSALIDADE.md) ganhou duas
testemunhas novas — e agora são **três marcas concorrentes citadas espontaneamente** (Azume, iSales,
Reonic) por clientes diferentes.

## 3) O que falta — e o pedido que 3 pessoas fizeram com 3 nomes diferentes

| Quem | O que pediu | Rodada |
|---|---|---|
| **Melque** | *"Colocar o preço individual das placas, inversor e estrutura"* | 1ª |
| **Max** | *"Poder montar os kit, já deixar o kit montado, pra eu não ter que fazer tudo novamente"* | 2ª |
| **Antônio Henrique** | *"A integração da precificação com o gerador de proposta"* | 2ª |

**É o mesmo pedido.** Três pessoas, três formas de dizer: *o preço dos itens tem que morar dentro da
proposta, e o conjunto tem que ficar salvo pra reusar.* Nenhum deles pediu documento novo.

**A ironia que dói:** a **Precificação já existe** — e virou exclusiva do plano anual em 17/08. O
Antônio é `pro`. O pedido nº 1 da base é ligar uma ferramenta que quem pede **não consegue abrir**.
Duas saídas, e as duas são decisão do Thiago: ou a Precificação volta a aparecer (mesmo capada) pra
quem é `pro`, ou isso vira o argumento do upgrade — *"você pediu; está no anual"*.

Pedidos avulsos, sem repetição ainda:

- **Eduardo Boso**: *"Falta uma capa na proposta."*
- **Melque** (1ª rodada): kanban de projetos por etapa, com anexo.
- **GSI** (1ª rodada): quantidade de baterias some no PDF da proposta; geração estimada devia entrar
  no contrato. **Esse é bug, não pedido.**
- **American Energy** (1ª rodada): logo maior na proposta com gráfico; e não consegue baixar pela
  nuvem, no celular, uma proposta já gerada.

## 4) Depoimentos

**No ar desde hoje:** o **Vicente (VFF Energia Solar)** entrou como 7º card em
`dashboard/src/components/Landing/Landing.tsx`. Autorização por escrito, na linha, 20/08 — *"Pode
sim"*, mandou o nome da empresa e depois corrigiu o próprio nome. Está em
`conversa_wa('19988288802')`, é o **segundo** com prova (o primeiro é a GSI).

**Parado esperando uma frase:** o **Antônio Henrique** respondeu as 3 perguntas e mandou *"Antônio
Henrique, Exxel Solar, Xique-Xique-Bahia"* logo em seguida. Isso é ele **atendendo** o pedido de
nome e empresa, **não é um "pode publicar"**. Fica fora do `Landing.tsx` — nem com `liberado:
false`, que já vazou uma vez. Uma pergunta na conversa resolve.

## 5) Quatro clientes responderam e ninguém respondeu de volta

Sem drama, mas está aberto:

| Quem | Quando respondeu | Por que ficou mudo |
|---|---|---|
| American Energy | 20/08, 00h53 | fora da janela diurna (9h–20h) |
| Max · GreenMax | 20/08, 07h56 | fora da janela diurna |
| **Antônio Henrique** | 21/08, 09h09 | **mordaça de 14 dias** |
| **Eduardo Boso** | 21/08, 10h51 | **mordaça de 14 dias** |

Os dois de baixo são o preço da correção de 18/08 e ela **está funcionando como foi desenhada**: o
telefone deles só existe em `company.whatsapp`, então o robô de vendas foi calado pra não empurrar
pitch em cliente pagante. Só que o atendimento (`whatsappAgentService.ts:691`) procura o dono da
conta **só** por `users.whatsapp` — não acha, e também não fala. Resultado: protegido do pitch,
órfão de resposta.

**Não é conserto de uma linha.** `company.whatsapp` é texto livre (tem `11-93962-2890` na base), e
tratar todo `company.whatsapp` como dono de conta é justamente o que se decidiu não fazer em 18/08
(calaria 78 conversas). O caminho honesto é casar por **8 últimos dígitos**, no banco, e só isso já é
uma tarefa própria.

**Enquanto isso, são 4 mensagens na mão** — e uma delas destrava um depoimento.

## 6) Áudio do New Energy RS: não era feedback

Transcrito (7 s): *"Fala Thiago, beleza? É Saul aqui. Ela já é sua cliente aí de vocês, cara."*
É intermediário confirmando que a conta é de outra pessoa. **A resposta do dono ainda não veio.**
