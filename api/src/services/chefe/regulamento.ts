// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — REGULAMENTO: todos os números da régua, num lugar só.
//
// Este arquivo é PURO: não lê banco, não loga, não lê process.env sozinho. Quem
// quer os números com a env aplicada chama `lerRegulamento(process.env)` e loga
// a lista `ignorados` que volta. O núcleo (decidir.ts) recebe o regulamento
// pronto, então o mesmo estado dá sempre a mesma decisão.
//
// Cada número carrega a origem num colchete:
//   [código arquivo.ts:NN]  valor padrão que o código do HEAD (origin/main
//                           2c67eaff) usa hoje; NN é a linha nesse commit
//   [memória arquivo.md]    regra escrita na memória do projeto
//   [proposta]              número novo do desenho do CHEFE, a calibrar na sombra
//   [crítica]               correção dos críticos, que vale sobre a especificação
//
// REGRA DE CONFLITO: quando a memória e o lineThrottle.ts do HEAD discordam, vale
// o HEAD, e a divergência fica escrita no comentário do número (ver também a
// lista DIVERGENCIAS no fim do arquivo).
//
// ENV SÓ APERTA. Teto (hora, dia, rajada) só aceita valor MENOR que o padrão.
// Espaçamento, reserva, janela de pausa e início da janela só aceitam valor
// MAIOR. O resto é ignorado e volta em `ignorados`, para quem chamou logar.
// Os interruptores do HEAD que afrouxam (JANELA_DIURNA_OFF, JANELA_DOMINGO_ON,
// ESPACAMENTO_OFF) também são ignorados aqui: no CHEFE o botão de emergência é o
// modo (off/sombra/valendo), não uma env que solta a régua para sempre.
// Afrouxar espaçamento só com data de expiração escrita no código
// [código lineThrottle.ts:312-321; memória de 25/08].
//
// NADA AQUI ESTÁ LIGADO A ENVIO. É a régua que o decidir() usa; quem ainda manda
// mensagem hoje continua passando pelo lineThrottle.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type Env = Readonly<Record<string, string | undefined>>;

const MIN = 60 * 1000;
const HORA = 60 * MIN;

/** Degrau da rampa de reconexão. `frioHora`/`frioDia` valem para o frio; os de
 *  linha valem para P3 a P5 (o P0, o P1 e o aviso ao time ficam fora da rampa). */
export interface DegrauRampa {
  frioHora: number;
  /** Teto do DIA da rampa, antes de descontar a reserva (o frio usa dia − reserva). */
  dia: number;
  linhaHora: number;
  linhaDia: number;
}

export interface JanelaHorario {
  /** Hora de Brasília em que abre (inclusive). */
  inicioH: number;
  /** Hora de Brasília em que fecha (exclusive). */
  fimH: number;
  /** Abre no domingo? */
  domingo: boolean;
}

export interface Regulamento {
  // ── Frio ──
  frioPorHora: number;
  linhaDiaBase: number;
  reservaTransacionalDia: number;
  /** Derivado: linhaDiaBase − reservaTransacionalDia (no mínimo 1). */
  frioPorDia: number;

  // ── Janelas ──
  janelaFrio: JanelaHorario;
  janelaTransacional: JanelaHorario;

  // ── Espaçamento ──
  espacoFrioMs: number;
  jitterFrioMs: number;
  espacoFrioAposOutroMs: number;
  espacoProativaMs: number;
  jitterProativaMs: number;
  espacoUrgenteMs: number;
  esperaMaxEmProcessoMs: number;

  // ── Rajada e volume sustentado ──
  rajadaJanelaMs: number;
  rajadaMaxProativas: number;
  rajadaMaxLembrete: number;
  rajadaMaxPorRobo: number;
  lembreteHora: number;
  lembreteDia: number;
  sustentado3h: number;
  sustentado6h: number;

  // ── Agenda nunca bloqueia ──
  agendaMargemUtilMs: number;
  cadenciaPropriaMs: number;

  // ── Linha física ──
  linhaHora: number;
  linhaDia: number;
  totalProativoHora: number;
  emergenciaHora: number;
  emergenciaDia: number;
  reservaEmergenciaHora: number;
  reservaFrioHora: number;
  avisoHora: number;

  // ── Rampa de reconexão ──
  rampa: readonly DegrauRampa[];

  // ── Freio de erro ──
  freioErros: number;
  freioMs: number;
  freioSondaUrgenteMs: number;

  // ── Pausa humana, conversa e prazo ──
  pausaSilencioMs: number;
  reativoJanelaMs: number;
  reativoEsperaMaxMs: number;
  conversaVivaMs: number;
  prazoP1AntesMs: number;
  prazoP1ToleranciaMs: number;

  // ── Idempotência e adiar ──
  chaveJanelaMs: number;
  adiarJitterMs: number;
  adiarPisoMs: number;

  // ── 1 toque = 1 mensagem ──
  bolhasFrio: number;
  bolhasTransacional: number;
  bolhasReativo: number;
  bolhasAviso: number;
  bolhasEvento: number;
  bolhaExtraPix: number;
  caracteresFrio: number;
  caracteresTransacional: number;

  // ── Portão dos robôs (não é decidido aqui, mas o número mora aqui) ──
  toquesMudo: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PADRÕES
// ─────────────────────────────────────────────────────────────────────────────

/** Rampa de 72h depois de reconectar, por dia corrido desde a volta. */
const RAMPA_PADRAO: readonly DegrauRampa[] = Object.freeze([
  // [código lineThrottle.ts:53-56] frio 2/h, 3/h, 4/h e dia 10, 20, 30. Com a
  // reserva de 10 descontada (lineThrottle.ts:236-238) o frio fica com 1, 10 e
  // 20 por dia, e é esse o valor que vale. A especificação queria o frio da rampa
  // sem descontar a reserva (10, 20, 30): NÃO adotado, vale o HEAD.
  // [proposta] linha de P3 a P5 em 40%, 60% e 80% de 24/h e 200/dia. Hoje os
  // pisos por robô passam POR CIMA da rampa (lineThrottle.ts:246); aqui a rampa
  // segura o transacional que não é agenda e o frio, e deixa o P0, o P1 e a
  // agenda de fora [crítica; regra do dono, 07/10].
  Object.freeze({ frioHora: 2, dia: 10, linhaHora: 10, linhaDia: 80 }),
  Object.freeze({ frioHora: 3, dia: 20, linhaHora: 14, linhaDia: 120 }),
  Object.freeze({ frioHora: 4, dia: 30, linhaHora: 19, linhaDia: 160 }),
]);

export const REGULAMENTO_BASE: Readonly<Regulamento> = Object.freeze({
  // [código lineThrottle.ts:31] LINHA_MAX_HORA, padrão 6. Nunca afrouxa
  // [memória chefe-antiban-da-linha.md, linha-io-antiban-1-toque-1-msg.md].
  // A queda de 30/08 foi a 18/h de frio [memória linha-io-bloqueio-30-ago.md].
  frioPorHora: 6,
  // [código lineThrottle.ts:32] LINHA_MAX_DIA, padrão 40.
  // DIVERGÊNCIA: a memória linha-io-orcamento-frio-30.md chama a LINHA_MAX_DIA de
  // "botão que acelera". No CHEFE a env só aperta: subir o dia por env é ignorado.
  linhaDiaBase: 40,
  // [código lineThrottle.ts:39] LINHA_RESERVA_TRANSACIONAL, padrão 10. Aqui ela
  // vale em dois lugares: (1) frio = 40 − 10 = 30 por 24h, igual ao HEAD; (2) o
  // frio para quando a linha de P2 a P5 chega a linhaDia − 10 = 190 em 24h.
  // DIVERGÊNCIA: a especificação pedia 180 (reserva de 20); fica 10, valor do HEAD.
  reservaTransacionalDia: 10,
  frioPorDia: 30,

  // [código lineThrottle.ts:279-291] frio das 9h às 20h de Brasília, sem domingo.
  // DIVERGÊNCIA: a memória janela-diurna-linha-whatsapp.md (06/08) diz 08h–21h;
  // o código fechou para 09h–20h em 07/08 e o próprio comentário de
  // lineThrottle.ts:282 ficou com o texto velho. Vale o código.
  janelaFrio: Object.freeze({ inicioH: 9, fimH: 20, domingo: false }),
  // [proposta] transacional proativo (P3) das 7h às 21h, todo dia. Hoje cada robô
  // tem a sua (agenda 7–20 eletropostoAgenda.ts:292-293, cobrança 8–20
  // eletropostoCobraSim.ts:151-152, bom dia da Giovanna 7–11 solarAgendaGiovanna.ts:128,
  // boas-vindas nenhuma solarBoasVindas.ts:514) e continua tendo: esta é a moldura
  // de fora. O lembrete com prazo (P1 pelo prazo) para destino de fora também
  // mora nela [revisão]: o prazo vem de quem chama, então não pode virar passe
  // livre para a madrugada. O alerta de 10 min ao consultor (destino interno) não
  // tem janela: reunião confirmada às 21h30 é avisada. Não corta nada que a
  // agenda manda hoje: o eletroposto só fala das 7h às 20h (eletropostoAgenda.ts:
  // 290-293), o bom dia da Giovanna das 7h às 11h (solarAgendaGiovanna.ts:128), e
  // a remarcação do NÃO ATENDEU das 9h às 19h (eletropostoReagendaAuto.ts:613).
  // Para a agenda a janela é DURA, e é a moldura de fora das janelas dos robôs.
  janelaTransacional: Object.freeze({ inicioH: 7, fimH: 21, domingo: true }),

  // [código lineThrottle.ts:325] 10 min de base, MAIS
  // [código lineThrottle.ts:330] sorteio de 0 a 5 min. Contado contra o último
  // envio de robô CARIMBADO (frio ou agenda), como o respeitaEspacamentoLinha do
  // HEAD (lineThrottle.ts:337, que olha prefixosDaLinha, agenda inclusive: "um
  // follow-up nunca sai colado num lembrete", lineThrottle.ts:202-205).
  // DIVERGÊNCIA: no HEAD só Bia, avisos e carlaThrottle chamam o espaçamento; no
  // CHEFE ele vale para TODO frio. Isso aperta semente, oferta fria, carlaRetomada
  // e convite IG. FOME MEDIDA no controle de agenda cheia do chefeQuedas: o frio
  // entrega bem menos que os 30 do dia (o número está cravado lá). Afrouxar só
  // depois de medir na sombra, e só com data de expiração no código, nunca em env.
  espacoFrioMs: 10 * MIN,
  jitterFrioMs: 5 * MIN,
  // [proposta] frio contra QUALQUER outra mensagem física que o HEAD não conta
  // (resposta, aviso ao time, evento): 2 min. É aperto, porque hoje essas
  // mensagens não entram em espaçamento nenhum.
  espacoFrioAposOutroMs: 2 * MIN,
  // [proposta] entre proativas (P2 a P5) para destinos diferentes: 25 s mais
  // sorteio de 0 a 35 s. 06/08 01h13: curso19 + Carla mandaram 4 em 37 s
  // [memória janela-diurna-linha-whatsapp.md]; isto impede o "4 em 37 s".
  espacoProativaMs: 25 * 1000,
  jitterProativaMs: 35 * 1000,
  // [crítica] P0 e P1 só obedecem a um espaçamento curto, 10 a 20 s entre
  // destinos diferentes. Fica 10 s, o piso do intervalo, porque é também a
  // espera máxima em processo: assim o urgente nunca precisa de 'adiar' por
  // espaçamento, só de alguns segundos de espera.
  espacoUrgenteMs: 10 * 1000,
  // [crítica] "reativo nunca espera mais de 10 s em processo".
  esperaMaxEmProcessoMs: 10 * 1000,

  // [proposta] no máximo 6 proativas físicas em qualquer janela de 10 min. A
  // queda de 02/10 foi cerca de 21 mensagens em 10 min, a de 01/08 cerca de 10
  // [memória linha-io-queda-02-out-reagenda.md, linha-io-5040-bloqueio-e-travas.md].
  rajadaJanelaMs: 10 * MIN,
  rajadaMaxProativas: 6,
  // [revisão] rajada PRÓPRIA do lembrete com prazo: no máximo 6 lembrete_p1 em
  // qualquer janela de 10 min. O prazo é declarado por quem chama; sem isto, um
  // robô pedindo com prazo=agora+60min mandava 39 em 6 min. A resposta a quem
  // escreveu e o evento continuam fora dela.
  // AGENDA NUNCA BLOQUEIA [regra do dono, 07/10]: para a agenda ela só ESPAÇA,
  // dentro da janela útil (até validoAte menos agendaMargemUtilMs); no último
  // momento útil a agenda sai assim mesmo. Para o lembrete que não é agenda (as
  // boas-vindas com a ficha fresca), segura.
  rajadaMaxLembrete: 6,
  // [revisão] rajada POR ROBÔ: o mesmo robô não passa de 6 mensagens em 10 min
  // somando o lembrete com prazo e as proativas dele. Sem isto, metade dos
  // pedidos com prazo e metade sem dava 11 em 10 min para o mesmo ep_agenda.
  // Vale para a agenda também, e DURO (não cai no último momento útil): é a
  // defesa de volume contra robô frio pedindo com o nome de um robô de agenda,
  // ao lado da guarda arquivo → robôs. Os controles de agenda cheia do
  // chefeQuedas (eletroposto nas duas faixas, e com as carteiras do solar na
  // mesma linha) provam que ela não segura agenda legítima além da janela útil.
  rajadaMaxPorRobo: 6,
  // [revisão] teto PRÓPRIO do lembrete com prazo: 28/h e 150/24h. Desde 07/10 só
  // vale para o lembrete que NÃO é agenda (hoje, só as boas-vindas do solar com
  // a ficha fresca): a regra do dono tirou a agenda legítima dele. Ele fora da
  // agenda deixa o ataque do prazo inventado (sondas A, A2 e A3 do chefeQuedas)
  // limitado só pela rajada por robô e pela guarda; números cravados lá.
  lembreteHora: 28,
  lembreteDia: 150,
  // [crítica da ÍRIS] volume sustentado para quem NÃO escreveu nas últimas 24h:
  // 40 em 3h ou 60 em 6h, de P3 a P5 que não são agenda. Segura o pico de 3h e
  // de 6h, não a hora. A agenda fica fora [regra do dono, 07/10]: no dia de
  // agenda densa com bom dia sem prazo, ele segurava bom dia legítimo.
  // NÃO pega a classe errada, e nenhum volume pega: o frio pedindo como agenda
  // tem o mesmo formato de uma agenda cheia legítima (dívida cravada no
  // chefeQuedas). A defesa contra classe errada é a guarda arquivo → robôs
  // permitidos (chefeGuarda, regra robo), mais a rajada por robô. A guarda
  // reprova o pedido com o nome de um robô de OUTRO arquivo, mas não separa a
  // classe dentro de um arquivo que pode pedir uma classe mais urgente que a do
  // próprio robô (os 8 arquivos de classe máxima evento, os de lembrete): ali o
  // passaporte por chamada precisa provar a classe. Dívida declarada.
  sustentado3h: 40,
  sustentado6h: 60,

  // [regra do dono, 07/10] AGENDA NUNCA BLOQUEIA: margem antes do fim da janela
  // útil (Pedido.validoAte). Até lá, o que só espaça (rajadas globais, espaço
  // entre proativas, emergência) pode adiar a agenda; passado o limite, ela sai
  // na hora. 3 min = o tick de 2 min do pg_cron mais folga, para o robô voltar
  // ainda dentro da janela. [proposta]
  agendaMargemUtilMs: 3 * MIN,
  // [memória agenda-nunca-bloqueia.md; código eletropostoReagendaAuto.ts:586]
  // a remarcação do NÃO ATENDEU sai no máximo 1 a cada 15 min por robô: espaçada,
  // nunca em rajada, nunca cortada.
  cadenciaPropriaMs: 15 * MIN,

  // [proposta] teto da LINHA para P2 a P5 (aviso ao time, transacional do dia e
  // frio): 24/h e 200 em 24h corridas, em mensagem física. A AGENDA conta nele
  // (o frio vê a linha ocupada e cede) mas não é segurada por ele [regra do
  // dono, 07/10]. 24/h é o maior piso
  // por hora que o HEAD já autoriza (eletropostoCobraSim.ts:149, liberação) e
  // 200/24h é o pisoDia de todo transacional do HEAD (eletropostoAgenda.ts:127,
  // :150, :201; eletropostoCobraSim.ts:140; solarAgendaGiovanna.ts:141;
  // solarBoasVindas.ts:447). Os pisos por robô somem: a ordem passa a ser por
  // prioridade e prazo, não pelo tamanho do piso [crítica; memória de 03/10].
  linhaHora: 24,
  linhaDia: 200,
  // [código linhaSaudeMonitor.ts:44] picoAtencao 40/h. Interpretação da crítica
  // ("o teto de 24/h vale para P2 a P5 sobre o que sobra depois do P0 e do P1"):
  // proativa nenhuma empurra o TOTAL da linha, urgente incluído, acima de 40 na
  // hora. Assim a hora movimentada de resposta espaça o proativo em vez de calar
  // o urgente, e o proativo nunca leva a linha ao nível de atenção do monitor.
  // A agenda fica fora dele [regra do dono, 07/10].
  totalProativoHora: 40,
  // [código linhaSaudeMonitor.ts:45] picoCritico 60/h e [:50] envios24h 450:
  // teto de EMERGÊNCIA, o único que vale para P0 e P1 [crítica: "teto de
  // emergência alto, por exemplo 60/h"]. Para a agenda ele só espaça dentro da
  // janela útil [regra do dono, 07/10].
  emergenciaHora: 60,
  emergenciaDia: 450,
  // [regra do dono, 07/10] dentro dos 60/h da emergência, as últimas vagas da
  // hora ficam para o evento e a agenda: quem cede é o frio e o resto proativo.
  // O frio e a proativa comum já param em 40; com esta reserva o resto (o
  // lembrete que não é agenda) para em 50. NÃO cedem, por medida: a resposta
  // (com a reserva valendo para ela, no pico de conversa em cima da agenda cheia
  // ela esperava até 379 min e 12 viravam frio; sem, no máximo 82 min e nenhuma
  // vira frio) e o aviso urgente ao time, de lead novo (com a reserva, esperava
  // 104 min na caixa no dia real do solar, com a agenda pondo a linha em 59/h
  // das 8h às 10h; ele vai só para contato salvo da equipe). [proposta]
  reservaEmergenciaHora: 10,
  // [proposta] o frio não pega as 4 últimas vagas da hora da linha (ou o número
  // de prioridades maiores esperando, se for maior).
  reservaFrioHora: 4,
  // [proposta] sublimite do aviso ao time: 12/h físicos. Hoje é isento
  // (ioEletroposto.ts:30) e sai em leque de 2 a 3 destinos.
  avisoHora: 12,

  rampa: RAMPA_PADRAO,

  // [memória linha-io-bloqueio-30-ago.md] régua pós-bloqueio: "dois erros
  // seguidos param" (eram três). [proposta] por 15 min. Conta só erro de LINHA
  // (instância fora, desconectado, 5xx, timeout, 429), nunca número inválido
  // [crítica]. Hoje o HEAD só tem o cooldown de 60 s em memória
  // (zapiClient.ts:69), que trata qualquer 4xx como linha.
  freioErros: 2,
  freioMs: 15 * MIN,
  // [proposta] durante o freio, o urgente (resposta e lembrete com prazo) vira a
  // SONDA da linha: tenta no máximo 1 vez a cada 5 min. Sem isto, o lembrete
  // batia na linha caída a cada tick (o replay de 04/08 deu 24 falhas numa hora);
  // com isto a volta da linha aparece em até 5 min e o lembrete ainda cabe na
  // janela dele. A proativa espera os 15 min inteiros.
  freioSondaUrgenteMs: 5 * MIN,

  // [código pausaHumana.ts:65] PAUSA_HUMANA_JANELA_H, padrão 24.
  pausaSilencioMs: 24 * HORA,
  // [crítica] reativo só quando o destino escreveu nos últimos 15 min.
  reativoJanelaMs: 15 * MIN,
  // [revisão] os 15 min contam até o NASCIMENTO do pedido (Pedido.nascidoEm),
  // não até agora, enquanto o pedido tiver até 2h: a espera que o próprio CHEFE
  // impõe (a hora cheia de agenda) não pode rebaixar a resposta a frio e jogá-la
  // para a fila do frio, horas depois. Medido: com 30 min, no pico de conversa
  // em cima da agenda cheia, respostas viravam frio e saíam até 326 min depois;
  // com 2h, a pior espera é 82 min e nenhuma vira frio. Passadas 2h, conta até
  // agora, para um lote não se passar por resposta com nascimento inventado
  // (o alcance fica em quem escreveu nas últimas 2h15). [proposta]
  reativoEsperaMaxMs: 2 * HORA,
  // [crítica da ÍRIS] conversa viva = o destino escreveu nas últimas 24h.
  conversaVivaMs: 24 * HORA,
  // [proposta] transacional com prazo em menos de 90 min vira P1 (lembrete de
  // 5 min e de 1h, reunião em menos de 2h, ficha com menos de 30 min).
  prazoP1AntesMs: 90 * MIN,
  // [código eletropostoAgenda.ts:104, solarAgendaGiovanna.ts:136] o toque de
  // 5 min ainda sai até 3 min DEPOIS do início (MIN_5MIN de −3 a 12 e de −2 a
  // 10). 5 min de tolerância para o prazo não rebaixar esse toque para P3.
  prazoP1ToleranciaMs: 5 * MIN,

  // [proposta] mesma chave de toque com enviar_agora nos últimos 15 min = já
  // reservado. Segura os 4 relógios chamando o mesmo tick.
  chaveJanelaMs: 15 * MIN,
  // [proposta] 'adiar para X' = instante em que a regra libera, mais sorteio de
  // 0 a 90 s, e nunca menos de 60 s à frente.
  adiarJitterMs: 90 * 1000,
  adiarPisoMs: 60 * 1000,

  // 1 TOQUE = 1 MENSAGEM [memória linha-io-antiban-1-toque-1-msg.md]:
  // [código zapiClient.ts:295] frio em 1 bolha de até 900 caracteres;
  // [código eletropostoAgenda.ts:1241, eletropostoReagendaAuto.ts:1368] agenda em 1
  // bolha de até 1200; [código bolhas.ts:53] MAX_BOLHAS_PADRAO 2 para conversa
  // viva. DIVERGÊNCIA: a memória ia-msg-frase-por-frase.md fala em "teto de 5
  // bolhas"; o código usa 2. Vale o código.
  bolhasFrio: 1,
  bolhasTransacional: 1,
  bolhasReativo: 2,
  // [proposta] aviso ao time: 1 por destino.
  bolhasAviso: 1,
  // [crítica] envio de evento sai em 1 bolha.
  bolhasEvento: 1,
  // EXCEÇÃO DO PIX [crítica; código bolhas.ts:145-157]: o copia-e-cola (começa
  // com 000201) sai SEMPRE em bolha própria, mesmo no frio. Vale 1 toque e até 2
  // mensagens. O Pix vai no FIM do texto: no meio ele vira 3 bolhas, porque o
  // emBolhas nunca funde bloco intocável. O maxBolhas vale por chamada.
  bolhaExtraPix: 1,
  caracteresFrio: 900,
  caracteresTransacional: 1200,

  // [código silenciar.ts:105] ANTIBAN_TOQUES_MUDO, padrão 3: quem levou 3 toques
  // em 60 dias sem responder sai de todo proativo que usa o portão. Fica no
  // portão do robô (carregarBloqueioProativo), não no decidir().
  toquesMudo: 3,
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTAGRAM E FACEBOOK — números do canal Meta. Documentados aqui para a régua
// ser uma só; o decidir() desta fase cobre só a linha de WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

export const REGRAS_META = Object.freeze({
  instagramFrio: Object.freeze({
    // [memória chefe-antiban-da-linha.md, instagram-bloqueio-conversa-nova.md]
    // de 5 a 12 abordagens por dia e por conta, +1 por dia cheio sem bloqueio,
    // volta a 5 no bloqueio. Mais que 12 por dia sai de mais contas.
    porDiaMin: 5,
    porDiaMax: 12,
    sobePorDiaCheio: 1,
    // piso de 45 min entre abordagens, só das 8h às 21h de Brasília.
    pisoEntreMs: 45 * MIN,
    janela: Object.freeze({ inicioH: 8, fimH: 21, domingo: true }) as JanelaHorario,
    // respiro de 5 a 10 min depois de um perfil que não abre; para com 3 perfis
    // DISTINTOS que não abrem.
    respiroMinMs: 5 * MIN,
    respiroMaxMs: 10 * MIN,
    paraComPerfisDistintos: 3,
    // DIVERGÊNCIA: o worker-prospeccao/worker.mjs do origin/main usa piso de 4
    // min, janela 0–24h e "3 seguidos" (último commit 14/09). A regra da memória
    // roda no disco do PC, sem versão. Vale a memória; versionar o worker.
  }),
  instagramReativo: Object.freeze({
    // [código igEngine.ts:48-49] fila até 180/h e 15 por tick.
    porHora: 180,
    porTick: 15,
    // [proposta] sorteio de 2 a 6 s entre envios no lugar dos 500 ms fixos
    // (igEngine.ts:50). A resposta de prospecção cai de 3 para 2 mensagens.
    esperaMinMs: 2000,
    esperaMaxMs: 6000,
    prospeccaoMaxMensagens: 2,
  }),
  facebook: Object.freeze({
    // [código fbComentarios.ts:38, fbMensagens.ts:32] 10 e 12 por varredura;
    // 1 resposta privada por comentário (a Meta recusa a 2ª).
    comentariosPorVarredura: 10,
    inboxPorVarredura: 12,
    // [proposta] 60/h por página e de 3 a 8 s entre envios.
    porHoraPorPagina: 60,
    esperaMinMs: 3000,
    esperaMaxMs: 8000,
  }),
  // [memória prospeccao-whatsapp-segunda-identidade.md] WhatsApp de prospecção
  // nunca pela 5040: 10 por chip por dia.
  whatsappProspeccaoPorChipDia: 10,
});

// ─────────────────────────────────────────────────────────────────────────────
// ENV — só aperta
// ─────────────────────────────────────────────────────────────────────────────

/** Envs que no HEAD AFROUXAM a régua. No CHEFE são ignoradas (com registro). */
const INTERRUPTORES_QUE_AFROUXAM = ['JANELA_DIURNA_OFF', 'JANELA_DOMINGO_ON', 'ESPACAMENTO_OFF'] as const;

export interface LeituraRegulamento {
  reg: Regulamento;
  /** Envs presentes que foram IGNORADAS, com o porquê. Quem chama loga. */
  ignorados: string[];
}

/**
 * Regulamento com a env aplicada, sem afrouxar nada.
 *
 * `teto` aceita só valor menor (e positivo); `piso` aceita só valor maior.
 * Valor inválido, maior num teto ou menor num piso volta em `ignorados`.
 */
export function lerRegulamento(env: Env = {}): LeituraRegulamento {
  const ignorados: string[] = [];
  const bruto = (nome: string): number | null => {
    const raw = env[nome];
    if (raw === undefined || String(raw).trim() === '') return null;
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) {
      ignorados.push(`${nome}=${raw} ignorado: não é número`);
      return null;
    }
    return n;
  };
  const teto = (nome: string, padrao: number): number => {
    const n = bruto(nome);
    if (n === null) return padrao;
    if (n < 1) { ignorados.push(`${nome}=${n} ignorado: teto precisa ser 1 ou mais`); return padrao; }
    if (n > padrao) { ignorados.push(`${nome}=${n} ignorado: env só aperta (padrão ${padrao})`); return padrao; }
    return Math.floor(n);
  };
  const piso = (nome: string, padrao: number, maximo = Infinity): number => {
    const n = bruto(nome);
    if (n === null) return padrao;
    if (n < padrao) { ignorados.push(`${nome}=${n} ignorado: env só aperta (padrão ${padrao})`); return padrao; }
    if (n > maximo) { ignorados.push(`${nome}=${n} ignorado: acima do máximo ${maximo}`); return padrao; }
    return n;
  };

  for (const nome of INTERRUPTORES_QUE_AFROUXAM) {
    const v = env[nome];
    if (v !== undefined && String(v).trim() !== '' && String(v).trim() !== '0') {
      ignorados.push(`${nome}=${v} ignorado: no CHEFE env não afrouxa (o botão é o modo)`);
    }
  }

  const b = REGULAMENTO_BASE;
  const linhaDiaBase = teto('LINHA_MAX_DIA', b.linhaDiaBase);
  const reservaTransacionalDia = piso('LINHA_RESERVA_TRANSACIONAL', b.reservaTransacionalDia, linhaDiaBase - 1);
  const inicioH = piso('JANELA_INICIO_H', b.janelaFrio.inicioH, b.janelaFrio.fimH - 1);
  const fimHBruto = teto('JANELA_FIM_H', b.janelaFrio.fimH);
  const fimH = fimHBruto > inicioH ? fimHBruto : b.janelaFrio.fimH;
  if (fimH !== fimHBruto) ignorados.push(`JANELA_FIM_H=${fimHBruto} ignorado: fecharia antes de abrir`);

  const reg: Regulamento = {
    ...b,
    frioPorHora: teto('LINHA_MAX_HORA', b.frioPorHora),
    linhaDiaBase,
    reservaTransacionalDia,
    frioPorDia: Math.max(1, linhaDiaBase - reservaTransacionalDia),
    janelaFrio: { inicioH, fimH, domingo: false },
    janelaTransacional: { ...b.janelaTransacional },
    espacoFrioMs: piso('ESPACAMENTO_MIN_MS', b.espacoFrioMs),
    jitterFrioMs: piso('ESPACAMENTO_JITTER_MS', b.jitterFrioMs),
    linhaHora: teto('CHEFE_LINHA_HORA', b.linhaHora),
    linhaDia: teto('CHEFE_LINHA_DIA', b.linhaDia),
    totalProativoHora: teto('CHEFE_TOTAL_PROATIVO_HORA', b.totalProativoHora),
    emergenciaHora: teto('CHEFE_EMERGENCIA_HORA', b.emergenciaHora),
    emergenciaDia: teto('CHEFE_EMERGENCIA_DIA', b.emergenciaDia),
    rajadaMaxProativas: teto('CHEFE_RAJADA_10MIN', b.rajadaMaxProativas),
    rajadaMaxLembrete: teto('CHEFE_RAJADA_LEMBRETE_10MIN', b.rajadaMaxLembrete),
    rajadaMaxPorRobo: teto('CHEFE_RAJADA_ROBO_10MIN', b.rajadaMaxPorRobo),
    lembreteHora: teto('CHEFE_LEMBRETE_HORA', b.lembreteHora),
    lembreteDia: teto('CHEFE_LEMBRETE_DIA', b.lembreteDia),
    sustentado3h: teto('CHEFE_SUSTENTADO_3H', b.sustentado3h),
    sustentado6h: teto('CHEFE_SUSTENTADO_6H', b.sustentado6h),
    avisoHora: teto('CHEFE_AVISO_HORA', b.avisoHora),
    reservaFrioHora: piso('CHEFE_RESERVA_FRIO_HORA', b.reservaFrioHora),
    reservaEmergenciaHora: piso('CHEFE_RESERVA_EMERGENCIA_HORA', b.reservaEmergenciaHora, b.emergenciaHora - 1),
    cadenciaPropriaMs: piso('CHEFE_CADENCIA_PROPRIA_MIN', b.cadenciaPropriaMs / MIN) * MIN,
    pausaSilencioMs: piso('PAUSA_HUMANA_JANELA_H', b.pausaSilencioMs / HORA) * HORA,
    toquesMudo: teto('ANTIBAN_TOQUES_MUDO', b.toquesMudo),
  };
  return { reg, ignorados };
}

/** Regulamento sem env nenhuma. É o que o decidir() usa quando ninguém passa outro. */
export const REGULAMENTO_PADRAO: Readonly<Regulamento> = Object.freeze(lerRegulamento({}).reg);

/**
 * Força da rampa pela env LINHA_RECONECTADA_EM, do mesmo jeito do HEAD
 * [código lineThrottle.ts:60-65]: data curta vira meia-noite de Brasília.
 * Devolve epoch ms ou null. Puro: recebe a env.
 */
export function rampaForcadaDaEnv(env: Env = {}): number | null {
  const raw = env.LINHA_RECONECTADA_EM?.trim();
  if (!raw) return null;
  const t = Date.parse(raw.length <= 10 ? `${raw}T00:00:00-03:00` : raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Degrau da rampa que vale agora, ou null se a linha já aqueceu.
 * Mesmo corte do HEAD [código lineThrottle.ts:50-58]: env no futuro conta como
 * dia 0; passados 3 dias corridos a rampa some sozinha.
 */
export function degrauDaRampa(reg: Regulamento, desde: number | null | undefined, agora: number): DegrauRampa | null {
  if (desde === null || desde === undefined || !Number.isFinite(desde)) return null;
  const dias = (agora - desde) / (24 * HORA);
  const i = dias < 1 ? 0 : Math.floor(dias);
  return i < reg.rampa.length ? reg.rampa[i]! : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUSO E JANELA — Brasília fixo (UTC−3, sem horário de verão)
// [memória relogio-local-e-utc-nao-brt.md; código lineThrottle.ts:285]
// ─────────────────────────────────────────────────────────────────────────────

const BRT_MS = 3 * HORA;

/** A janela está aberta neste instante? */
export function dentroDaJanela(j: JanelaHorario, agora: number): boolean {
  const brt = new Date(agora - BRT_MS);
  if (brt.getUTCDay() === 0 && !j.domingo) return false;
  const h = brt.getUTCHours();
  return h >= j.inicioH && h < j.fimH;
}

/**
 * Próximo instante (epoch ms) em que a janela abre. Se já está aberta, devolve
 * `agora`. Pula domingo quando a janela não abre no domingo.
 */
export function proximaAbertura(j: JanelaHorario, agora: number): number {
  if (dentroDaJanela(j, agora)) return agora;
  const brt = new Date(agora - BRT_MS);
  // Meia-noite de Brasília do dia corrente, em epoch.
  let dia = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + BRT_MS;
  for (let i = 0; i < 8; i++) {
    const abre = dia + j.inicioH * HORA;
    const domingo = new Date(dia - BRT_MS + 12 * HORA).getUTCDay() === 0;
    if (abre > agora && (j.domingo || !domingo)) return abre;
    dia += 24 * HORA;
  }
  return agora + 24 * HORA; // inalcançável com janela válida; não trava ninguém para sempre
}

// ─────────────────────────────────────────────────────────────────────────────
// DIVERGÊNCIAS registradas (memória × HEAD × especificação). Também servem de
// checklist para a sombra: cada uma é um ponto a medir antes do valendo.
// ─────────────────────────────────────────────────────────────────────────────

export const DIVERGENCIAS: readonly string[] = Object.freeze([
  'Janela do frio: memória janela-diurna (06/08) 08h–21h; HEAD 09h–20h desde 07/08. Vale o HEAD.',
  'Espaçamento: memória de 06/08 5 min; HEAD 10 min + 0–5 min desde 07/08. Vale o HEAD, agora para todo frio.',
  'Régua pós-bloqueio de 31/08 (15 min, 20/dia só transacional, 8h–20h) nunca foi para o código; vale o HEAD (6/h, 30/dia de frio, 9h–20h). Fica dela o freio de 2 erros.',
  'Rampa do frio: HEAD dá 1, 10 e 20 por dia (dia da rampa menos a reserva); a especificação pedia 10, 20 e 30. Vale o HEAD.',
  'Reserva do transacional: HEAD 10; a especificação pedia o frio parando em 180/24h (reserva 20). Vale 10 (frio para em 190).',
  'Bolhas: memória ia-msg-frase-por-frase fala em 5; HEAD bolhas.ts usa 2. Vale o HEAD (2 só para conversa viva).',
  'Unidade: o HEAD conta carimbo (1 por toque); o CHEFE conta mensagem física. O toque frio com Pix vale 2 na conta do frio.',
  'LINHA_MAX_DIA e LINHA_MAX_HORA: no HEAD a env subia o teto; no CHEFE só aperta.',
  'JANELA_DIURNA_OFF, JANELA_DOMINGO_ON e ESPACAMENTO_OFF afrouxam no HEAD; no CHEFE são ignoradas.',
  'Pisos por robô (6, 10, 14, 18, 20 e 24/h) somem. No lugar: prioridade por classe e teto de 24/h e 200/24h para P2–P5.',
  'P0 (evento) e a resposta (P1) ficam fora do teto da linha e da rampa, só com espaçamento de 10 s e teto de emergência de 60/h e 450/24h [crítica]. O lembrete com prazo (P1 pelo prazo) para destino de fora mora na janela do transacional (7h–21h) e numa rajada própria de 6 em 10 min, e o mesmo robô não passa de 6 em 10 min somando lembrete e proativa, porque o prazo vem de quem chama [revisão]. O teto próprio de 28/h e 150/24h só vale para o lembrete que não é agenda (as boas-vindas): a regra do dono de 07/10 o tirou da agenda.',
  'AGENDA NUNCA BLOQUEIA [regra do dono, 07/10/2026; memória agenda-nunca-bloqueia.md]. Agenda = robô de agenda (ep_agenda, giovanna_agenda, ep_cobra_sim, ep_alerta_10min para a equipe, ep_remarcar_reativo, ep_reagenda_auto) com a classe efetiva fora do frio. Ela conta em todos os freios (o frio vê a linha ocupada e cede) mas nenhum freio de volume a segura: teto total da hora (40), teto da linha (24/h e 200/24h), vaga guardada, volume sustentado, rampa e o teto próprio do lembrete. O que só espaça (rajada global de proativas e de lembrete, espaço entre proativas, emergência) adia só até o fim da janela útil (Pedido.validoAte) menos 3 min; no último momento útil ela sai. Ainda param a agenda: a linha caída (freio), a chave repetida, a pausa humana do HEAD, a janela do transacional para lead e a rajada por robô (6 em 10 min, a defesa contra robô frio pedindo como agenda). DÍVIDA: o prazo inventado e o frio pedindo como agenda pioraram (chefeQuedas); a defesa é a guarda arquivo → robôs e a rajada por robô. LIMITE MEDIDO: com o dobro das carteiras do solar (62 ligações) em cima das duas faixas, a linha fica no teto físico das 8h ao meio-dia e a rajada por robô corta 5 itens que vencem até as 12h.',
  'A remarcação do NÃO ATENDEU (ep_reagenda_auto) era frio [especificação]; desde 07/10 é agenda por ordem do dono: transacional do dia, 1 envio a cada 15 min (cadência própria, a do HEAD), sem prazo e sem pausa (como no HEAD), na janela do transacional. Sai toda no mesmo dia, nunca em rajada, nunca cortada. O carimbo ep_agenda_sent:ID:reagendado deixou de ser divergência.',
  'Emergência: as últimas 10 vagas da hora (reservaEmergenciaHora) são do evento e da agenda; cede o resto (o lembrete que não é agenda; o frio e a proativa comum já param em 40). A resposta e o aviso de lead novo ao time não cedem, por medida (chefeQuedas e regulamento).',
  'Resposta segurada pelo CHEFE: a janela de 15 min conta até o nascimento do pedido (Pedido.nascidoEm) enquanto ele tiver até 2h [revisão]; antes contava até agora, e no pico a resposta virava frio e saía horas depois.',
  'Pausa humana na agenda: a memória pausa-humana-linha-io diz que confirmação e lembrete de reunião que o próprio lead marcou passam com humano dentro, e a regra do dono de 07/10 diz que só a linha caída para agenda. O HEAD segura a Giovanna, a cobrança do SIM e as boas-vindas (podeFalarComLead e sendFrio). Vale o HEAD robô a robô até o dono decidir; o CHEFE só espelha o que o robô já faz.',
  'Ordem da fila: por prioridade e, dentro dela, pelo fim da janela útil (quem vence antes vai antes), como cada robô de agenda ordena a própria fila por horário. Entre robôs diferentes isso depende da espera viva do CHEFE ligado (fase do livro); hoje cada robô pergunta na ordem do tick.',
  'Reativo atrasado (o destino não escreveu nos últimos 15 min) vira FRIO, com ou sem conversa nas últimas 24h [crítica; revisão]. A versão anterior o rebaixava a P3 com conversa viva, e um lote do CRM para quem escreveu ontem saía a 24/h, fora do orçamento do frio. O manual_crm é de 1 destino por chamada; chamada com mais de um é lote e é decidida como o zapi_admin_lote (frio).',
  'Pausa humana no lembrete da Giovanna: a memória pausa-humana-linha-io diz que confirmação e lembrete de reunião que o próprio lead marcou passam com humano dentro; o HEAD segura (solarAgendaGiovanna.ts:320 e solarBoasVindas.ts:506 chamam podeFalarComLead sem {transacional}, e a cobrança do SIM manda por sendFrio, que confere a pausa por dentro, zapiClient.ts:280-291). Vale o HEAD, robô a robô, inclusive quando o prazo vira P1.',
  'Pausa humana no frio da linha solardoc: hoje curso19, Carla (sem CNPJ e inativo), confiança, Pix VIP, dunning, recuperação de checkout, whatsappFollowup e a pergunta do CNPJ mandam pelo zapiClient (sendHuman, sendImage, sendWhatsApp, sendZAPI) sem passar pelo sendFrio nem pelo podeFalarComLead. No CHEFE todo frio respeita. Aperto novo, que o HEAD não faz.',
  'Rampa: no HEAD os pisos passam por cima dela; no CHEFE ela segura P3–P5 (10, 14 e 19 por hora) e deixa P0, P1 e o aviso ao time de fora.',
  'Instagram frio: worker.mjs do origin/main usa 4 min e 0–24h; vale a memória (45 min, 8h–21h).',
  'Espaçamento do frio contra agenda (10–15 min) mantido do HEAD; a especificação queria 2 min contra qualquer mensagem. Os 2 min ficam só contra o que o HEAD não contava (resposta, aviso, evento).',
  'Teto da linha "sobre o que sobra depois do P0 e do P1" [crítica] lido assim: P2–P5 com 24/h e 200/24h próprios, e a proativa não leva o total da hora acima de 40 (picoAtencao do monitor). O aviso urgente ao time (lead novo) fica fora desses 40 [interpretação].',
  'Freio de erro: a especificação deixava a resposta tentar sempre; aqui, durante o freio, resposta e lembrete tentam no máximo 1 vez a cada 5 min (o replay de 04/08 deu 24 falhas numa hora sem isso).',
  'Aviso ao time para destino de fora da equipe vira frio [revisão]: o aviso não tem janela, pausa, orçamento do frio nem rampa, então só vale para a equipe. A lista da equipe, quando o CHEFE for ligado, tem de trazer o dono e todo consultor que recebe aviso; telefone que faltar aparece na sombra como aviso rebaixado.',
  'Guarda arquivo → robôs permitidos (chefeGuarda): reprova o pedido com o nome de um robô de outro arquivo (literal, as const, satisfies, const do arquivo, atalho { robo }). Não separa a classe dentro de um arquivo que pode pedir classe mais urgente que a do próprio robô: os 8 arquivos de classe máxima evento (dunningService, whatsappAgentService, webhook, pixComprovante, ioIndicacoes, authController, paymentsController, trafegoController) e os de agenda. Ali o passaporte por chamada precisa provar a classe. Dívida declarada: um lote pedindo como evento sai a 60 em 10 min.',
  'Grupo não é destino interno por padrão [revisão]: só o grupo da lista explícita (o do cartão de agendamento, ZAPI_IO_GROUP_ID) ou o robô de grupo (sdr_grupo_interno). A linha é membro do grupo do eletroposto, onde entra lead.',
]);
