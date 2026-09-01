# WhatsApp oficial: a resposta

## 1. A RESPOSTA CURTA

**Parcialmente. Migrar acaba com o motivo que derrubou a linha três vezes, mas não acaba com a punição, e por isso a migração é a quinta coisa a fazer, não a primeira.**

Acaba com o vetor real: a Z-API é WhatsApp Web pilotado por robô, e isso sozinho já é motivo de bloqueio. Na oficial esse motivo deixa de existir, e a punição vira uma escada publicada, avisada com antecedência e apelável, no lugar de um desligamento instantâneo e mudo.

Não acaba com a causa: o insumo das duas escadas da Meta (a do número, e a do template, que pausa 3h, depois 6h, depois desativa, disparada só por baixa taxa de leitura, sem ninguém denunciar nada) é o mesmo comportamento de hoje. Nos últimos 30 dias, 56% dos contatos nunca responderam e mesmo assim receberam 6,5 mensagens cada.

Por isso a ordem. Quatro coisas cortam mais risco que a migração, custam quase nada e valem mesmo se a migração não acontecer: abrir a verificação, tirar o aviso interno do WhatsApp, rodar o anúncio como Click to WhatsApp, e parar a cadência pra quem nunca respondeu. Isso não é paliativo. É o que faz a linha oficial nascer com taxa de leitura defensável, em vez de importar o motor do bloqueio pra dentro dela em forma de template aprovado.

## 2. O QUE DEPENDE DE VOCÊ

**Passo 1. Abrir a Business Verification hoje. Grátis.** No Business Manager que já existe. Documento aceito: cartão CNPJ ou contrato social, com razão social e endereço batendo exatamente com o cadastro. A Meta recusa documento auto preenchido sem assinatura ou selo. Prazo: não existe SLA publicado. O "1 a 5 dias úteis" que circula não é da Meta, e no fórum oficial há casos parados 12 dias ou mais. Onde trava: endereço divergente e documento gerado por você mesmo. É o primeiro passo porque é grátis, reversível, não toca em nada que está rodando, e a resposta dele resolve as duas incógnitas que travam o resto: se o histórico de ADS_INTEGRITY das duas contas desabilitadas atrapalha, e se a verificação é portão de acesso ou só portão de tier.

**Passo 2. Quitar os saldos em aberto. R$ 2.751,12** (R$ 2.742 numa conta e R$ 9,12 na outra). **Custa dinheiro.** Não achei página da Meta dizendo que saldo em aberto bloqueia criar ativo novo, então não trate como bloqueio comprovado. É tirar uma variável da mesa antes de submeter, por preço baixo.

**Passo 3. Chip novo, não o número atual. Custa o chip.** Registrar um número existente na Cloud API tira ele do app WhatsApp pra sempre, e hoje humano assume conversa nas duas linhas (o estado `human_takeover` aparece em 18 arquivos). Fora isso, o lead do eletroposto nunca viu o número da IO: o próprio comentário no código diz que a marca vai na primeira frase porque é "a estreia da linha IO na conversa, de um número que o lead nunca viu". Não há relacionamento pra preservar. E coexistência (app e API no mesmo número) não é opção: a Meta exige ser Solution Partner ou Tech Provider, o que não é o caso.

O desenho de linhas que sai disso: uma **oficial nova**, começando só com o eletroposto; a **linha IO 34998165040 fica na Z-API sem data pra sair** (prospecção fria, fornecedor, humano digitando fora da janela, grupo da Luma, LimpaPro); e o **aviso interno sai do WhatsApp de vez**. Existe ainda a linha B2B do SolarDoc no código, mas as 9.408 saídas dos últimos 30 dias aparecem todas com uma instância só, o que sugere que o desvio `ZAPI_SOLARDOC_VIA_IO` está ligado e ela está muda hoje. Confiro isso antes de contar com ela.

**Passo 4. Escolher o provedor. Grátis, e a recomendação é Cloud API direta, sem BSP.** O BSP entrega caixa de entrada pronta e cobra 10% a 30% de markup em cima de cada mensagem, pra sempre. A caixa de entrada aqui é menor do que parece: o `conversa_wa` já espelha as conversas, o `human_takeover` já é estado, o /gerador já é PWA. Falta uma tela e um endpoint, e só na fase 3.

**Passo 5. Definir o display name. Grátis.** "Irmãos na Obra". Detalhe que morde depois: o review de nome só começa **depois** da verificação, e a partir dali toda troca de nome precisa de aprovação.

**Passo 6. Aprovar os 4 textos de template antes de eu submeter.** Já estão escritos em `c:\Users\55349\Desktop\CLAUDE\api\whatsapp-cloud\templates.eletroposto.json`. Isso não é formalidade: depois de aprovado, mudar uma vírgula custa até 24h de fila.

**Passo 7. Trocar o anúncio de link pra LP por Click to WhatsApp. Grátis, é no gerenciador, não é código.** Medido: 0 de 868 leads desde 22/04 têm `ctwa_clid` preenchido, porque o anúncio manda pra landing e a landing manda pro `wa.me`, e `wa.me` não é entrada gratuita. CTWA abre janela legítima, dá 72h de mensagem grátis e mata na origem a categoria mais cara e mais arriscada, que é abordar quem não pediu. Funciona hoje na Z-API e funciona depois na oficial. É a maior alavanca disponível e não depende da migração acontecer.

## 3. O QUE EU FAÇO

**Nada disso exige parada.** A operação roda inteira durante toda a obra. O corte é por variável de ambiente (`EP_AGENDA_VIA_META=1`) e o rollback é apagar a variável, sem deploy. O que existe é espera de terceiro, de dois tipos: a verificação (sem prazo publicado) e o review de cada template (até 24h, com rejeição possível em pt-BR).

Em paralelo, e vale mesmo se a migração não acontecer:

1. **`notificarEquipe()`, 1 dia.** Cerca de 20 call sites. Tira 29% do volume da linha (2.717 mensagens em 30 dias pra 4 telefones; o Diego respondeu 1 de 971). Vai pro push do PWA, que já existe no /gerador, mais e-mail, que já carrega o alerta de fila.
2. **Corte de cadência pra quem nunca respondeu, 1 dia.** Hoje 2.515 mensagens vão pra 384 pessoas que nunca abriram a boca, 6,5 cada. Quem não responde ao primeiro toque para de receber o terceiro e o quarto. Reduz risco agora, na Z-API, e é o que faz os templates nascerem com leitura defensável.

Depois, a migração:

3. **Transporte `'meta'` atrás das assinaturas atuais do `zapiClient`, 2 dias.** Os 61 arquivos que importam `sendHuman`, `sendFrio` e `sendWhatsApp` não são tocados.
4. **Parser do webhook, 2 dias.** Formato aninhado, lote de mensagens, `statuses` na mesma URL, assinatura `X-Hub-Signature-256`, demux por `phone_number_id`. A primeira coisa que quebra é o GET: hoje as três rotas respondem `{status:'webhook online'}` e a Meta exige o `hub.challenge` cru de volta, senão o webhook nunca ativa.
5. **Estado da janela de 24h, 2 dias.** É o maior item e é invisível: hoje nenhuma linha do código sabe se a janela está aberta. Sem isso, os toques de 1h e 5min ou pagam sempre, ou falham com erro 131047 em silêncio.
6. **Mídia, 3 dias.** A Meta não entrega URL, entrega um id que exige duas chamadas e um bearer, com link válido por 5 minutos. Encaminhar mídia pro consultor vira baixar, subir de novo e enviar por id. É a parte que mais quebra em produção, porque só falha com arquivo real.
7. **Monitor de qualidade e de template, 1 dia.** Lê o `quality_rating` do número e o status dos 4 templates, e avisa por e-mail quando qualquer um sair de GREEN ou entrar em Paused. Sem isso você troca um apagão que descobre pelo cliente reclamando por outro apagão que descobre pelo cliente reclamando.
8. **Piloto do eletroposto, 1 a 2 dias.** A escada não queima nenhum lead: primeiro `opts.dry`, que já existe e registra o que sairia sem mandar nada; depois test number da Meta mais os 4 telefones da equipe; depois 3 fichas falsas com telefone da equipe, pra rodar o cron ponta a ponta incluindo o botão de remarcar; só então ao vivo.

**Total: 13 a 14 dias de código, sem parada.**

Um aviso de cronograma que não é técnico. Nos últimos 30 dias houve 24 commits que mudaram texto de mensagem proativa, um a cada 1,25 dia, e o `eletropostoAgenda.ts` sozinho teve 25 commits. Durante a obra você vai querer mexer na copy umas 10 vezes, e a partir do primeiro template aprovado a fila de 24h passa a competir com esse hábito no meio do caminho, não depois. É exatamente por isso que o piloto tem 4 templates e uma frente só.

## 4. QUANTO CUSTA POR MÊS

Correção de premissa antes da conta: **a cobrança não é mais por conversa.** Desde 01/07/2025 a Meta cobra **por mensagem entregue**, e só quando é template. Fora da janela de 24h, cada bolha é um template cobrado, o que transforma o hábito de quebrar frase por frase em multiplicador de fatura. Medido: 3,49 bolhas por toque fora da janela.

Volume de 30 dias (03/08 a 01/09): 9.408 saídas, 760 contatos. Tirando os 2.717 avisos internos, sobram 6.691 pra cliente, das quais 5.224 fora da janela. Dessas, 819 toques leem como Marketing e 369 como Utility.

| | Hoje | A partir de 01/10/2026 |
|---|---|---|
| Marketing, 819 toques | R$ 254 a R$ 311 | R$ 254 a R$ 311 |
| Utility, 369 toques | R$ 15 a R$ 33 | R$ 15 a R$ 33 |
| Serviço (resposta livre na janela) | grátis | R$ 26 a R$ 58 |
| **Total Meta direto** | **R$ 269 a R$ 344** | **R$ 294 a R$ 402** |

**Pior caso**, com tudo reclassificado como Marketing no teto de R$ 0,55: **R$ 824 hoje e R$ 956 depois de outubro.** O piso é bem defendido: se os 369 toques de Utility virarem Marketing, entram só R$ 99 a mais.

**Se migrar sem mexer em nada** (3,49 bolhas por toque, aviso interno junto, tudo no teto): **R$ 2.233 por mês.** É a diferença entre migrar e simplesmente portar.

Contra hoje: a Z-API custa cerca de R$ 100 de mensalidade e R$ 0 por mensagem. O delta é de R$ 170 a R$ 250 por mês. Um único mês com a linha caída custa mais que um ano dessa diferença: na queda de 04 a 06 de agosto foram 41 horas fora do ar e cerca de 100 pessoas perderam mensagem.

Duas ressalvas de procedência: o preço de Marketing (US$ 0,0625 por mensagem) vem de fontes de fornecedor, não de tabela publicada pela Meta, que só divulga CSV e PDF; e a Meta publica as tarifas finais de mensagem de serviço no Brasil até 01/09, então o número de outubro é estimativa em cima da tarifa de utility.

Sobre o limite de 250: medido na unidade certa, que é destinatários únicos fora da janela em 24 horas, o pico foi 133 por dia e a média 52,8, com zero dias acima de 250 em 28 dias. Cabe com quase o dobro de folga.

## 5. O QUE SE PERDE

**O que sai de vez.** A prospecção fria não cabe, e não é área cinzenta: a política exige que a pessoa tenha dado o número **e** tenha dado opt-in, e lista raspada do Maps não satisfaz nenhuma das duas. Não há categoria de template nem redação que salve. Junto com ela saem o grupo (a Groups API existe, mas exige o selo de Official Business Account e tem teto de 8 participantes, e o grupo da IO onde os consultores comandam a Luma não cabe em 8 assentos), apagar mensagem (não existe na Cloud API, então o card atualizável do grupo é imigrável), ler a inbox (não existe endpoint, e o `sdrIoPolling` de 1.112 linhas existe justamente porque a linha caiu 41h; o substituto é a reentrega de webhook da Meta), a conversa com fornecedor (a linha pedindo maquininha, perguntando do Pix da InfinitePay: a empresa como cliente de outra empresa não é caso de uso de WABA), e o humano digitando livre pra quem está fora da janela, que na Cloud API simplesmente não é possível. Nada disso morre de fato, tudo isso continua na linha Z-API, que segue viva.

**O que fica mais lento, e é a perda mais cara.** Hoje você edita a string, dá push e está no ar em minutos. Medido: 24 commits mudaram texto de mensagem proativa nos últimos 30 dias, e o `eletropostoAgenda.ts` sozinho teve 25. Com template, cada mudança dessas vira submeter, esperar até 24h, e reescrever se for rejeitado. Não existe branch de template: ou o aprovado está no ar, ou não está. E um bug de copy vira incidente de um dia inteiro, o commit que corrigiu "14:00 virando 14h0 na mensagem do lead" foi resolvido em minutos, e como template o lead receberia "14h0" por até 24 horas depois de você descobrir. Na minha leitura, esse é o custo real da migração, não os R$ 300 por mês.

**O que degrada mas continua funcionando.** O `humanizar()` com Haiku morre fora da janela, porque template é texto fixo aprovado e reescrever no envio é exatamente o que não passa; dentro da janela continua idêntico. O "digitando" só aparece na primeira bolha, porque o indicador da Meta precisa do id de uma mensagem recebida pra existir e some sozinho em 25 segundos. E a escassez ("a procura está alta") saiu dos dois templates de maior volume, porque um elemento promocional em qualquer lugar do template reclassifica ele inteiro como Marketing, cerca de 9 vezes o preço. Ela volta a ser dita dentro da janela, em texto livre e de graça, que é onde ela sempre convenceu mais mesmo, porque ali é resposta a alguém e não aviso.

**O que não se perde, e é a maior parte da personalidade.** O `bolhas.ts` não muda uma linha. Dentro da janela de 24 horas não há template, não há aprovação e não há teto de bolhas, e Carla, Bia, Luma, Giovanna, o atendimento do LimpaPro e o inbound do gerador só existem em resposta a mensagem de lead. Sobrevivem byte a byte o `emBolhas`, o teto de 2, o `BOLHAS_CARLA` de 3, a proteção do intocável (Pix EMV nunca fundido), o `slow` com 8 a 15 segundos de digitação e o intervalo sorteado de 2 a 5 segundos. A regra de falar frase por frase continua valendo palavra por palavra, porque ela vive no transporte e o transporte dela é sempre inbound.

**E duas coisas que se ganham.** O "responde SIM" vira botão embaixo da mensagem, `[Confirmado]` e `[Preciso remarcar]`, alavanca contra no-show muito mais forte que pedir pra digitar (e os títulos foram escolhidos pra casar com as regex que já existem no `eletropostoRespostas` e no `eletropostoRemarcar`). E o webhook de status traz sent, delivered, read e failed: é a primeira telemetria de entrega real que esse sistema já teve, porque a Z-API não diz se a mensagem chegou.

## 6. E SE DER ERRADO

**Se a verificação for negada.** Primeiro, ler o motivo no Business Support Home, porque a recusa costuma ser específica e corrigível: documento auto preenchido sem assinatura ou selo, ou razão social e endereço divergentes do cadastro. Corrige e apela.

Segundo, e preciso dizer com clareza: **não está confirmado se a verificação é portão de acesso ou só portão de tier.** A documentação de Messaging Limits diz apenas que portfolio novo começa com 250 destinatários únicos por 24 horas, e não afirma que a verificação seja pré requisito pra mandar mensagem pra cliente real. Se for só portão de tier, uma negativa custa folga e o selo azul. Se for portão de acesso, mata o projeto. Não vou chutar qual é, e é exatamente por isso que abrir a verificação é o passo 1: é grátis, é reversível, e a resposta dela é a única forma de saber, junto com a resposta sobre o histórico de ADS_INTEGRITY.

Terceiro, se for portão de acesso mesmo e a apelação não resolver: abrir a WABA num **business portfolio novo, com CNPJ e e-mail administrador diferentes.** Alerta importante: a WABA pertence a um único portfolio e **não migra** entre eles. Essa decisão é irreversível e tem que ser tomada antes de submeter, não depois de ser negado.

**Se o número cair de tier na oficial.** A diferença em relação a hoje é que você vê antes. O webhook `phone_number_quality_update` avisa, o status vai de Connected pra Flagged, e há 7 dias pra reagir antes de o limite cair um nível. Com verificação, a queda de 2.000 pra 250 ainda comporta o pico de 133 por dia; sem verificação, uma queda de 250 leva pro tier de 50 e aí não cabe. A reação é a mesma nos dois casos: cortar a cadência pra quem não responde, que é a população que produz bloqueio silencioso, e parar o template de pior leitura. E Restricted, quando bate o limite, não é apagão: para de mandar proativo por 24 horas, mas continua respondendo quem iniciou, então Carla e Bia ficam de pé.

**O modo de falha novo, que hoje não existe.** Template pausado. Se um template chegar a "Active, low quality", a escada é pausa de 3 horas, depois 6, depois desativado. E o gatilho inclui baixa taxa de leitura sozinha, sem denúncia nenhuma. Ou seja: a agenda do eletroposto pode parar de sair com a linha 100% saudável. Os dois mais expostos são justamente `eletroposto_1h` e `eletroposto_5min`, porque no desenho eles só vão pra quem nunca respondeu (quem responde abre a janela e recebe texto livre de graça). É por isso que o monitor do item 7 não é opcional.

**O plano B é o próprio desenho.** A linha IO fica na Z-API permanentemente. Se a oficial cair, o eletroposto volta pra ela apagando `EP_AGENDA_VIA_META`, sem deploy. Isso não é migração com data de corte, é separação permanente.

**E o furo que precisa ficar escrito.** Não houve post-mortem de nenhum dos três bloqueios, então ninguém sabe qual comportamento derrubou a linha. Medindo as 2.515 mensagens que foram pra quem nunca respondeu, a prospecção fria são cerca de 20. O volume não solicitado pra gente muda é o eletroposto (442), o curso de R$ 19 (276) e o boas vindas do solar (139), que são exatamente as frentes que a gente quer mudar pra oficial. Se foi isso que derrubou a linha, deixar a lista fria na Z-API compra pouco, e a migração transporta o motor do bloqueio pra dentro da linha oficial em forma de template aprovado. É o argumento mais forte pra fazer o corte de cadência **antes** de migrar, e não depois.