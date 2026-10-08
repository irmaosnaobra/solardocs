// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — CLASSES: quem é cada robô que fala pela linha 5040.
//
// A classe NUNCA é declarada por quem chama nem pelo operador: ela sai daqui
// [crítica]. Foi a classe autodeclarada que derrubou a linha em 02/10 (o
// reagenda perguntava o teto do frio e carimbava como agenda).
//
// Só entram robôs VIVOS no HEAD (origin/main 2c67eaff, depois da limpeza). Os
// que a limpeza apagou ou que vão ser apagados ficaram de fora (broadcastTick,
// Luma, repescagem, convite investidor, grupo frio, estudo e top pontos do
// eletroposto, MCP e test-send, script de 1º de maio). Os prefixos que eles
// deixaram no lineThrottle continuam contando: estão em PREFIXOS_LEGADOS_FRIOS,
// para a troca futura não mudar a conta.
//
// AGENDA NUNCA BLOQUEIA [memória agenda-nunca-bloqueia.md, regra do dono de
// 07/10/2026]. Agenda é marca do ROBÔ (campo `agenda`), não classe: confirmação,
// bom dia e diário, lembrete de 1h e de 5 min (ep_agenda, giovanna_agenda), a
// cobrança do SIM (ep_cobra_sim), o alerta de 10 min ao consultor da equipe
// (ep_alerta_10min), a resposta a quem pediu para remarcar (ep_remarcar_reativo)
// e a remarcação do NÃO ATENDEU (ep_reagenda_auto). O pedido é de agenda quando
// o robô é de agenda e a classe efetiva não caiu para frio (o alerta mandado a
// lead vira frio e deixa de ser agenda). As boas-vindas do solar NÃO são agenda:
// são o recibo do cadastro, não falam de horário (solarBoasVindas.ts:20-24).
//
// Arquivo PURO: só dado e função de dado.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * As classes, da mais urgente para a menos.
 *
 * - evento_p0: nasce de um evento e não volta sozinho (compra, ativação, D0,
 *   recuperado, convite pedido, comprovante). NUNCA recebe 'adiar': sai agora
 *   como P0 ou vai para a caixa de saída [crítica].
 * - reativo_p1: resposta a quem escreveu nos últimos 15 min. Atrasou, vira frio.
 * - lembrete_p1: transacional com prazo em menos de 90 min (lembrete de 5 min e
 *   de 1h, ficha com menos de 30 min, reunião em menos de 2h). Não é classe de
 *   robô: é a classe EFETIVA de um P3 de agenda quando o prazo chega perto. O
 *   prazo vem de quem chama, então o lembrete ainda mora na janela do
 *   transacional e numa rajada própria [revisão].
 * - aviso_interno_p2: destino da equipe. Destino interno vira esta classe,
 *   seja qual for o robô. E SÓ destino interno: robô de aviso pedindo para quem
 *   não é da equipe (nem grupo da lista) vira frio [revisão].
 * - transacional_agenda_p3: transacional do dia (confirmação de backlog, bom
 *   dia, diário, cobrança do SIM, boas-vindas, remarcação do NÃO ATENDEU). A
 *   pessoa marcou, pagou ou pediu.
 * - frio_receita_p4: frio que traz receita (recuperação de checkout, dunning D1
 *   em diante, Pix VIP). Passa na frente do resto do frio.
 * - frio_p5: todo o resto do frio. Quem começa a conversa é frio. A exceção é a
 *   remarcação do NÃO ATENDEU, que o dono pôs na agenda em 07/10/2026: a pessoa
 *   tinha reunião marcada.
 */
export type Classe =
  | 'evento_p0'
  | 'reativo_p1'
  | 'lembrete_p1'
  | 'aviso_interno_p2'
  | 'transacional_agenda_p3'
  | 'frio_receita_p4'
  | 'frio_p5';

export const CLASSES: readonly Classe[] = Object.freeze([
  'evento_p0', 'reativo_p1', 'lembrete_p1', 'aviso_interno_p2',
  'transacional_agenda_p3', 'frio_receita_p4', 'frio_p5',
]);

/** Prioridade da classe: menor sai primeiro. */
export const PRIORIDADE: Readonly<Record<Classe, number>> = Object.freeze({
  evento_p0: 0,
  reativo_p1: 1,
  lembrete_p1: 1,
  aviso_interno_p2: 2,
  transacional_agenda_p3: 3,
  frio_receita_p4: 4,
  frio_p5: 5,
});

/** P0 e P1: fora do teto da linha e da rampa; só espaçamento curto e emergência [crítica]. O lembrete_p1 ainda tem janela e rajada própria [revisão]. */
export const CLASSES_URGENTES: readonly Classe[] = Object.freeze(['evento_p0', 'reativo_p1', 'lembrete_p1']);
/** P2 a P5: as proativas. Contam no teto da linha, na rajada de 10 min e no espaçamento entre proativas. */
export const CLASSES_PROATIVAS: readonly Classe[] = Object.freeze(['aviso_interno_p2', 'transacional_agenda_p3', 'frio_receita_p4', 'frio_p5']);
/** P3 a P5: o que a rampa de reconexão segura e o que conta no volume sustentado sem conversa. */
export const CLASSES_RAMPA: readonly Classe[] = Object.freeze(['transacional_agenda_p3', 'frio_receita_p4', 'frio_p5']);
/** P4 e P5: dividem o orçamento do frio (6/h e 30/24h). */
export const CLASSES_FRIAS: readonly Classe[] = Object.freeze(['frio_receita_p4', 'frio_p5']);

export const ehUrgente = (c: Classe): boolean => CLASSES_URGENTES.includes(c);
export const ehProativa = (c: Classe): boolean => CLASSES_PROATIVAS.includes(c);
export const ehFria = (c: Classe): boolean => CLASSES_FRIAS.includes(c);
export const naRampa = (c: Classe): boolean => CLASSES_RAMPA.includes(c);

/** Janela de horário do robô: livre (24h), transacional (7h–21h) ou frio (9h–20h, sem domingo). O lembrete_p1 usa a do transacional. */
export type JanelaRobo = 'livre' | 'transacional' | 'frio';

/** Como o lineThrottle.ts do HEAD conta o prefixo hoje. */
export type ContaHoje = 'frio' | 'agenda';

export interface Carimbo {
  /** Prefixo da chave em system_state, com o ':' do fim. */
  prefixo: string;
  /** Balde em que o HEAD conta: frio (prefixosFrios) ou agenda (PREFIXOS_AGENDA). */
  contaHoje: ContaHoje;
  /** Só conta na linha IO quando o desvio ZAPI_SOLARDOC_VIA_IO=1 está ligado (lineThrottle.ts:176-177). */
  soComDesvio?: boolean;
}

export interface MetaRobo {
  classe: Classe;
  /** Ordem dentro da classe (1 sai primeiro). */
  subprioridade: number;
  /** Bolhas de TEXTO por chamada, sem contar o Pix (que sempre vai em bolha própria). */
  maxBolhas: number;
  maxCaracteres: number | null;
  janela: JanelaRobo;
  /** Prefixos que o lineThrottle do HEAD conta para este robô. Vazio = fora da conta hoje. */
  carimbos: readonly Carimbo[];
  /** Linha pedida. 'solardoc' sai pela 5040 com o desvio ligado. */
  linha: 'io' | 'solardoc';
  /**
   * Pausa humana: segue o HEAD robô a robô (quem chama podeFalarComLead,
   * carregarPausas ou sendFrio hoje respeita; quem não chama, passa). Todo frio
   * respeita, inclusive o da linha solardoc que hoje não confere (aperto novo,
   * registrado em DIVERGENCIAS).
   */
  respeitaPausa: boolean;
  /** Envio que nasce de evento não volta se for adiado: vai para a caixa de saída, nunca para 'adiar'. */
  nasceDeEvento: boolean;
  /** Só robô de agenda pode virar P1 pelo prazo. Frio nunca. */
  podeTerPrazo: boolean;
  /** Aviso ao time que não entra em cartão (lead novo, alerta de 10 min). */
  urgente: boolean;
  /** Onde o envio mora hoje, relativo a api/src. É a semente do mapa arquivo → robôs da guarda. */
  arquivos: readonly string[];
  /**
   * Robô de UM destino por chamada (o humano digitando no CRM). Chamada com
   * mais de um destino é lote, e lote só sai pelo robô de lote nomeado aqui,
   * que é frio [revisão]. null = o robô não tem esse limite.
   */
  roboDeLote: string | null;
  /**
   * Robô de grupo (o cartão de agendamento do sendToGroup): para ele, destino
   * grupo é interno. Para os outros, grupo só é interno na lista explícita
   * [revisão]: a linha é membro do grupo do eletroposto, onde entra lead.
   */
  roboDeGrupo: boolean;
  /**
   * Classe de um robô de AVISO quando o destino não é da equipe. null = frio.
   * Nenhum robô de hoje declara: todo aviso vai para equipe, dono ou consultor.
   * Se um dia declarar, é transacional ou frio, nunca urgente nem aviso.
   */
  classeComLead: Classe | null;
  /**
   * Robô de AGENDA [regra do dono, 07/10/2026]: nenhum freio de volume o
   * segura (teto total da hora, teto da linha, volume sustentado, rampa e o
   * teto próprio do lembrete). Ele só pode ser ordenado e espaçado DENTRO da
   * janela útil (Pedido.validoAte), e quando falta vaga o frio cede. O que
   * ainda o para: a linha caída (freio), a chave repetida, a pausa humana do
   * HEAD, a janela do transacional para destino de fora e a cadência própria. A
   * rajada por robô NÃO o para (rodada 4). A linha caída segura, mas não
   * descarta: o toque que ela segurou sai atrasado na volta
   * (agendaRepresadaPelaLinha, no decidir).
   */
  agenda: boolean;
  /**
   * No máximo 1 envio deste robô a cada `cadenciaPropriaMs` do regulamento
   * (15 min). É a remarcação do NÃO ATENDEU: sai sempre, espaçada, nunca em
   * rajada (a de 02/10 foi 39 em 55 min) e nunca cortada.
   */
  cadenciaPropria: boolean;
}

/** Padrões por classe. Cada robô só escreve o que foge deles. */
function base(classe: Classe): Omit<MetaRobo, 'arquivos'> {
  const frio = classe === 'frio_p5' || classe === 'frio_receita_p4';
  return {
    classe,
    subprioridade: 1,
    maxBolhas: classe === 'reativo_p1' ? 2 : 1,
    maxCaracteres: frio ? 900 : classe === 'transacional_agenda_p3' ? 1200 : null,
    janela: frio ? 'frio' : classe === 'transacional_agenda_p3' ? 'transacional' : 'livre',
    carimbos: [],
    linha: 'io',
    respeitaPausa: frio,
    nasceDeEvento: classe === 'evento_p0',
    podeTerPrazo: false,
    urgente: false,
    roboDeLote: null,
    roboDeGrupo: false,
    classeComLead: null,
    agenda: false,
    cadenciaPropria: false,
  };
}

function robo(classe: Classe, arquivos: readonly string[], extra: Partial<Omit<MetaRobo, 'classe' | 'arquivos'>> = {}): MetaRobo {
  return Object.freeze({ ...base(classe), ...extra, arquivos: Object.freeze([...arquivos]) });
}

const frio = (prefixo: string): Carimbo => Object.freeze({ prefixo, contaHoje: 'frio' as const });
const agenda = (prefixo: string): Carimbo => Object.freeze({ prefixo, contaHoje: 'agenda' as const });
const carlaSent: Carimbo = Object.freeze({ prefixo: 'carla_sent:', contaHoje: 'frio' as const, soComDesvio: true });

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE_POR_ROBO — fonte única. Nomes estáveis: viram o `robo` do passaporte.
// ─────────────────────────────────────────────────────────────────────────────

export const CLASSE_POR_ROBO: Readonly<Record<string, MetaRobo>> = Object.freeze({
  // ── P0 · evento ────────────────────────────────────────────────────────────
  solardoc_boas_vindas: robo('evento_p0', ['services/agents/whatsapp/whatsappAgentService.ts', 'controllers/authController.ts'], { linha: 'solardoc' }),
  solardoc_compra: robo('evento_p0', ['services/agents/whatsapp/whatsappAgentService.ts', 'controllers/authController.ts', 'controllers/paymentsController.ts'], { linha: 'solardoc' }),
  // Link de definir senha de quem acabou de pagar: sem ele o cliente não entra [crítica].
  solardoc_ativacao: robo('evento_p0', ['services/agents/whatsapp/whatsappAgentService.ts'], { linha: 'solardoc' }),
  dunning_d0: robo('evento_p0', ['services/dunningService.ts'], { linha: 'solardoc' }),
  // Confirmação de que o pagamento entrou: chega pelo webhook a qualquer hora [crítica].
  dunning_recuperado: robo('evento_p0', ['services/dunningService.ts'], { linha: 'solardoc' }),
  // O D5 cancela e grava dunning_last_day_sent=5 ANTES de avisar: adiado, ninguém manda de novo [crítica].
  dunning_d5: robo('evento_p0', ['services/dunningService.ts'], { linha: 'solardoc' }),
  // Convite do grupo que o lead PEDIU. Hoje são 4 bolhas cruas em laço (webhook.ts); aqui, 1.
  convite_grupo_pedido: robo('evento_p0', ['routes/webhook.ts']),
  pix_comprovante_cliente: robo('evento_p0', ['services/agents/whatsapp/pixComprovanteService.ts'], { linha: 'solardoc' }),
  trafego_confirmacao: robo('evento_p0', ['controllers/trafegoController.ts'], { linha: 'solardoc' }),
  indicacao_confirmacao: robo('evento_p0', ['routes/ioIndicacoes.ts']),

  // ── P1 · reativo (vira frio sozinho se o destino não escreveu em 15 min) ───
  // A vendedora é ela: não respeita a pausa (whatsappAgentService.ts).
  giovanna_reativa: robo('reativo_p1', ['services/agents/whatsapp/whatsappAgentService.ts'], { linha: 'solardoc' }),
  carla_b2b_reativa: robo('reativo_p1', ['services/agents/sdr/sdrB2bAgentService.ts'], { linha: 'solardoc' }),
  // A Duda cala quando um humano entrou (recepcaoIo.ts).
  duda_recepcao: robo('reativo_p1', ['services/io/recepcaoIo.ts'], { respeitaPausa: true }),
  // A agente do quiz solar (08/10/2026) responde quem escreveu de volta e cala
  // quando um humano entrou, como a Duda da recepção (solarAgenteQuiz.ts).
  solar_agente_quiz: robo('reativo_p1', ['services/io/solarAgenteQuiz.ts'], { respeitaPausa: true }),
  bia_inbound: robo('reativo_p1', ['services/agents/whatsapp/biaInboundService.ts']),
  // Resposta a quem PEDIU para remarcar: agenda [regra do dono, 07/10]. O HEAD
  // conta o carimbo como agenda (lineThrottle.ts:208): divergência conhecida,
  // ver divergenciasDeCarimbo(). Atrasada (o destino não escreveu nos últimos
  // 15 min) mas com conversa nas últimas 24h, vira transacional de agenda, não
  // frio; sem conversa em 24h, frio (decidir.ts, classeEfetiva). DÍVIDA: os dois
  // arquivos dela hospedam também a oferta fria (ep_oferta_fria), e a guarda não
  // separa robôs do mesmo arquivo; um lote de oferta fria pedindo com este nome
  // sai como agenda (chefeQuedas). Fecha com o passaporte por chamada.
  ep_remarcar_reativo: robo('reativo_p1', ['services/io/eletropostoRemarcar.ts', 'services/io/eletropostoRespostas.ts'], {
    carimbos: [agenda('ep_remarcar_sent:')], agenda: true,
  }),
  webhook_audio_falhou: robo('reativo_p1', ['routes/webhook.ts']),
  // Humano digitando no CRM: POST /admin/sdr-leads/:phone/send-message, 1
  // telefone por chamada. Sem mensagem do destino nos últimos 15 min vira frio,
  // como qualquer reativo. Chamada com mais de um destino é lote e é decidida
  // como o zapi_admin_lote [revisão].
  manual_crm: robo('reativo_p1', ['routes/admin.ts'], { roboDeLote: 'zapi_admin_lote' }),

  // ── P2 · aviso ao time ─────────────────────────────────────────────────────
  ep_aviso_ficha: robo('aviso_interno_p2', ['routes/ioEletroposto.ts'], { nasceDeEvento: true, urgente: true }),
  solar_aviso_ficha: robo('aviso_interno_p2', ['routes/ioSolar.ts'], { nasceDeEvento: true, urgente: true }),
  webhook_aviso_equipe: robo('aviso_interno_p2', ['routes/webhook.ts'], { nasceDeEvento: true }),
  indicacao_aviso_equipe: robo('aviso_interno_p2', ['routes/ioIndicacoes.ts'], { nasceDeEvento: true }),
  manychat_aviso: robo('aviso_interno_p2', ['services/agenda/manychatLeadService.ts'], { nasceDeEvento: true }),
  tracking_gerador_aviso: robo('aviso_interno_p2', ['controllers/trackingGeradorController.ts'], { nasceDeEvento: true }),
  ig_aviso_equipe: robo('aviso_interno_p2', ['services/instagram/igEngine.ts'], { nasceDeEvento: true }),
  // Mídia e documento nunca são juntados num cartão, só atrasados [crítica].
  encaminha_midia: robo('aviso_interno_p2', ['services/io/encaminharMidiaConsultor.ts'], { nasceDeEvento: true }),
  duda_ficha_consultor: robo('aviso_interno_p2', ['services/io/recepcaoIo.ts'], { nasceDeEvento: true }),
  // O recado "a Duda passou para você" no celular de quem atende o lead do quiz.
  solar_agente_recado: robo('aviso_interno_p2', ['services/io/solarAgenteQuiz.ts'], { nasceDeEvento: true }),
  pix_comprovante_dono: robo('aviso_interno_p2', ['services/agents/whatsapp/pixComprovanteService.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  giovanna_aviso_dono: robo('aviso_interno_p2', ['services/agents/whatsapp/whatsappAgentService.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  venda_aviso: robo('aviso_interno_p2', ['services/vendaAviso.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  asaas_aviso: robo('aviso_interno_p2', ['services/asaas/asaasWebhookService.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  // Alerta de 10 min antes da reunião: tem hora marcada, então vira P1 pelo
  // prazo. Agenda quando vai para a equipe; para lead vira frio e deixa de ser.
  ep_alerta_10min: robo('aviso_interno_p2', ['services/io/eletropostoAlerta10min.ts'], { urgente: true, podeTerPrazo: true, agenda: true }),
  ep_respostas_aviso: robo('aviso_interno_p2', ['services/io/eletropostoRespostas.ts']),
  ep_desmarcacao_aviso: robo('aviso_interno_p2', ['services/io/eletropostoAgenda.ts']),
  ep_card_ping: robo('aviso_interno_p2', ['services/io/eletropostoCardPing.ts']),
  solar_respostas_aviso: robo('aviso_interno_p2', ['services/io/solarRespostas.ts']),
  entrada_io_digest: robo('aviso_interno_p2', ['services/io/entradaIoDigest.ts']),
  sdr_io_aviso: robo('aviso_interno_p2', ['services/agents/sdr/sdrIoPolling.ts']),
  lembrete_followup: robo('aviso_interno_p2', ['services/io/lembreteFollowupService.ts']),
  sentinela_vacuo: robo('aviso_interno_p2', ['services/io/sentinelaVacuo.ts']),
  placar_giovanna: robo('aviso_interno_p2', ['services/io/placarGiovanna.ts']),
  leads_meta_alerta: robo('aviso_interno_p2', ['services/agenda/leadsMetaService.ts']),
  fb_aviso_equipe: robo('aviso_interno_p2', ['services/instagram/fbMensagens.ts']),
  prospeccao_aviso: robo('aviso_interno_p2', ['services/io/prospeccaoAviso.ts', 'routes/cron.ts']),
  agenda_proxima_digest: robo('aviso_interno_p2', ['services/agenda/agendaProximaDigest.ts']),
  reagendar_digest: robo('aviso_interno_p2', ['services/agenda/reagendarDigest.ts']),
  // O cartão de agendamento vai para o grupo do time (ZAPI_IO_GROUP_ID): é o único robô de grupo.
  sdr_grupo_interno: robo('aviso_interno_p2', ['services/agents/sdr/sdrGroupAgent.ts', 'services/agents/sdr/sdrAgentService.ts'], { roboDeGrupo: true }),
  resumo_dia: robo('aviso_interno_p2', ['routes/cron.ts'], { linha: 'solardoc' }),
  fila_alerta: robo('aviso_interno_p2', ['services/agents/whatsapp/filaAlerta.ts'], { linha: 'solardoc' }),

  // ── P3 · transacional do dia (agenda; vira P1 com prazo perto) ─────────────
  // Confirmação de backlog, bom dia, diário; e os lembretes de 1h e 5 min e a
  // ficha fresca, que chegam aqui com prazo e saem como P1. A pausa segue o HEAD
  // robô a robô: a agenda do eletroposto não confere; a cobrança do SIM (sendFrio),
  // a Giovanna (solarAgendaGiovanna.ts:320) e as boas-vindas (solarBoasVindas.ts:506)
  // conferem, inclusive quando o prazo vira P1 (ver DIVERGENCIAS). Os três
  // primeiros são AGENDA: nenhum freio de volume os segura [regra do dono].
  ep_agenda: robo('transacional_agenda_p3', ['services/io/eletropostoAgenda.ts'], {
    carimbos: [agenda('ep_agenda_sent:')], podeTerPrazo: true, agenda: true,
  }),
  ep_cobra_sim: robo('transacional_agenda_p3', ['services/io/eletropostoCobraSim.ts'], {
    carimbos: [agenda('ep_cobra_sim:')], podeTerPrazo: true, respeitaPausa: true, agenda: true,
  }),
  giovanna_agenda: robo('transacional_agenda_p3', ['services/io/solarAgendaGiovanna.ts'], {
    carimbos: [agenda('solar_giovanna_sent:')], podeTerPrazo: true, respeitaPausa: true, agenda: true,
  }),
  // Hoje até 7 bolhas (BOLHA_TETO, solarBoasVindas.ts:147) e sem janela (:514);
  // aqui 1 bolha e, passada a ficha fresca, a janela do transacional. NÃO é
  // agenda: é o recibo do cadastro e não fala de horário (solarBoasVindas.ts:20).
  // É o único transacional que continua nos freios de volume.
  solar_boas_vindas: robo('transacional_agenda_p3', ['services/io/solarBoasVindas.ts'], {
    carimbos: [agenda('solar_boasvindas_sent:')], podeTerPrazo: true, respeitaPausa: true,
  }),
  // A remarcação do NÃO ATENDEU (a da queda de 02/10): AGENDA desde 07/10, por
  // ordem do dono. Sai sempre, só espaçada: no máximo 1 a cada 15 min
  // (cadenciaPropria, a mesma cadência do HEAD, eletropostoReagendaAuto.ts:586),
  // nunca em rajada e nunca cortada. Não vira P1 pelo prazo (o 02/10 pedindo com
  // prazo era o pior caso), e não confere a pausa, como no HEAD (sendHuman sem
  // podeFalarComLead). Prioridade abaixo da agenda do dia.
  ep_reagenda_auto: robo('transacional_agenda_p3', ['services/io/eletropostoReagendaAuto.ts'], {
    carimbos: [agenda('ep_agenda_sent:')], subprioridade: 2, agenda: true, cadenciaPropria: true,
  }),

  // ── P4 · frio de receita ───────────────────────────────────────────────────
  recuperacao_checkout: robo('frio_receita_p4', ['services/followupService.ts', 'services/agents/whatsapp/pixRecoveryAgentService.ts'], { linha: 'solardoc', subprioridade: 1 }),
  dunning_lembrete: robo('frio_receita_p4', ['services/dunningService.ts'], { linha: 'solardoc', subprioridade: 2 }),
  pix_vip_lembrete: robo('frio_receita_p4', ['services/agents/whatsapp/pixVipReminderService.ts'], { linha: 'solardoc', subprioridade: 3 }),

  // ── P5 · frio (subordem da especificação: oferta de horário, Bia, pauta,
  //    cadências SolarDoc, semente e lotes manuais) ──────────────────────────
  ep_oferta_fria: robo('frio_p5', [
    'services/io/eletropostoRemarcar.ts', 'services/io/eletropostoRetorno.ts',
    'services/io/eletropostoNaoAtendidoFup.ts', 'services/io/eletropostoRespostas.ts',
  ], { carimbos: [frio('ep_oferta_fria:')], subprioridade: 2 }),
  bia_recuperacao: robo('frio_p5', ['services/agents/whatsapp/limpaproRecoveryService.ts'], {
    carimbos: [frio('limpapro_recovery:'), frio('limpapro_cupom_sent:'), frio('limpapro_fechamento_sent:'), frio('limpapro_grupo_sent:')],
    subprioridade: 3,
  }),
  avisos_pauta: robo('frio_p5', ['services/io/avisosTickService.ts', 'services/io/ioSend.ts'], {
    carimbos: [frio('aviso_sent:')], subprioridade: 4,
  }),
  // Hoje 2 bolhas e 2 contatos por tick (carlaRetomada.ts:54); aqui 1 bolha.
  carla_retomada: robo('frio_p5', ['services/agents/sdr/carlaRetomada.ts'], { carimbos: [frio('carla_retomada:')], subprioridade: 5 }),
  carla_sem_cnpj: robo('frio_p5', ['services/agents/whatsapp/carlaPlatformFollowupService.ts'], { carimbos: [carlaSent], linha: 'solardoc', subprioridade: 5 }),
  carla_inativo: robo('frio_p5', ['services/agents/whatsapp/carlaPlatformFollowupService.ts'], { carimbos: [carlaSent], linha: 'solardoc', subprioridade: 5 }),
  curso19: robo('frio_p5', ['services/agents/whatsapp/cursoEntradaBroadcast.ts'], { carimbos: [carlaSent], linha: 'solardoc', subprioridade: 5 }),
  confianca_whatsapp: robo('frio_p5', ['services/confiancaWhatsAppService.ts'], { carimbos: [carlaSent], linha: 'solardoc', subprioridade: 5 }),
  pesquisa_satisfacao: robo('frio_p5', ['services/pesquisaSatisfacao.ts'], { carimbos: [carlaSent], linha: 'solardoc', subprioridade: 5 }),
  whatsapp_followup: robo('frio_p5', ['services/agents/whatsapp/whatsappFollowupService.ts'], { linha: 'solardoc', subprioridade: 5 }),
  carla_cnpj_killer: robo('frio_p5', ['services/agents/whatsapp/carlaCnpjKillerQuestion.ts'], { linha: 'solardoc', subprioridade: 5 }),
  semente: robo('frio_p5', ['services/io/sementeSolarService.ts'], { carimbos: [frio('semente:')], subprioridade: 6 }),
  // Hoje carimba só a coluna convite_enviado_at: invisível ao teto (eletropostoIgConvite.ts:226).
  ep_ig_convite: robo('frio_p5', ['services/io/eletropostoIgConvite.ts'], { subprioridade: 6 }),
  // As rotas de lote passam pelo CHEFE como frio, sempre [crítica]. Sobrou a de
  // zapiAdmin, a da queda de 30/08: o /admin/io/send-text e os broadcasts do
  // admin.ts saíram na limpeza (bd7be8da), e o manual_lote_admin foi junto. É
  // também o robô de lote do manual_crm.
  zapi_admin_lote: robo('frio_p5', ['routes/zapiAdmin.ts'], { subprioridade: 6 }),
});

/**
 * Robô sem registro: o CHEFE trata como frio, o lado conservador. Robô novo
 * nasce registrado aqui ou nasce frio.
 */
export const ROBO_DESCONHECIDO: MetaRobo = robo('frio_p5', [], { subprioridade: 9 });

export function metaDoRobo(nome: string): MetaRobo | null {
  return Object.prototype.hasOwnProperty.call(CLASSE_POR_ROBO, nome) ? CLASSE_POR_ROBO[nome]! : null;
}

/**
 * O pedido é de AGENDA? Robô de agenda cuja classe efetiva não caiu para frio
 * (o alerta de 10 min para lead e a remarcação para quem não conversa viram frio
 * e deixam de ser agenda). Ver o cabeçalho e MetaRobo.agenda.
 */
export function ehAgendaDoPedido(meta: MetaRobo, classe: Classe): boolean {
  return meta.agenda && !ehFria(classe);
}

/** Os robôs de agenda, pelo nome (o teste fixa a lista). */
export function robosDeAgenda(): string[] {
  return Object.entries(CLASSE_POR_ROBO).filter(([, r]) => r.agenda).map(([n]) => n).sort();
}

/** Prioridade fina: classe × 10 + subprioridade. Menor sai primeiro. */
export function prioridadeFina(classe: Classe, subprioridade = 1): number {
  return PRIORIDADE[classe] * 10 + subprioridade;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canal Meta: inventário (o decidir desta fase cobre só o WhatsApp). Os números
// estão em REGRAS_META, no regulamento.
// ─────────────────────────────────────────────────────────────────────────────

export const ROBOS_META: Readonly<Record<string, { canal: 'instagram' | 'facebook'; arquivos: readonly string[] }>> = Object.freeze({
  ig_fila: { canal: 'instagram', arquivos: ['services/instagram/igEngine.ts'] },
  ig_prospeccao: { canal: 'instagram', arquivos: ['services/instagram/igEngine.ts', 'services/io/prospeccaoConversaIg.ts'] },
  fb_comentarios: { canal: 'facebook', arquivos: ['services/instagram/fbComentarios.ts'] },
  fb_inbox: { canal: 'facebook', arquivos: ['services/instagram/fbMensagens.ts'] },
});

// ─────────────────────────────────────────────────────────────────────────────
// PREFIXOS DERIVADOS — a conta do lineThrottle.ts sai daqui na troca futura.
// O teste chefeClasses prova que são IGUAIS (como conjunto) aos de hoje.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prefixos que o HEAD ainda conta, de robôs que já morreram ou estão na limpeza.
 * Todos no balde frio. Saem daqui JUNTO com a saída do lineThrottle, nunca antes:
 * tirar só daqui deixaria a conta nova mais frouxa que a de hoje.
 */
export const PREFIXOS_LEGADOS_FRIOS: readonly string[] = Object.freeze([
  'gerador_followup:',   // followup do Gerador: ninguém mais carimba
  'ep_repescagem_sent:', // repescagem do eletroposto: ninguém mais carimba
  'ep_convite_sent:',    // convite do grupo garantido: órfão desde antes
  'ep_grupo_frio:',      // grupo frio do eletroposto: ninguém mais carimba
  'ep_convinv_sent:',    // convite ao investidor: ninguém mais carimba
]);

function unicos(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

function carimbosVivos(opts: { solardocViaIo: boolean }): Carimbo[] {
  return Object.values(CLASSE_POR_ROBO)
    .flatMap(r => r.carimbos)
    .filter(c => !c.soComDesvio || opts.solardocViaIo);
}

/** Todos os prefixos da linha (o prefixosDaLinha do HEAD, lineThrottle.ts:176). */
export function prefixosDaLinhaDerivados(opts: { solardocViaIo: boolean }): string[] {
  return unicos([...carimbosVivos(opts).map(c => c.prefixo), ...PREFIXOS_LEGADOS_FRIOS]);
}

/** Os prefixos de agenda (o PREFIXOS_AGENDA do HEAD, lineThrottle.ts:206). */
export function prefixosAgendaDerivados(): string[] {
  return unicos(carimbosVivos({ solardocViaIo: true }).filter(c => c.contaHoje === 'agenda').map(c => c.prefixo));
}

/** Os prefixos do frio (o prefixosFrios do HEAD, lineThrottle.ts:215). */
export function prefixosFriosDerivados(opts: { solardocViaIo: boolean }): string[] {
  const agendaSet = new Set(prefixosAgendaDerivados());
  return prefixosDaLinhaDerivados(opts).filter(p => !agendaSet.has(p));
}

/** Balde que a CLASSE pediria. null = classe que o HEAD não conta (evento, reativo, aviso). */
export function baldeDaClasse(c: Classe): ContaHoje | null {
  if (c === 'frio_p5' || c === 'frio_receita_p4') return 'frio';
  if (c === 'transacional_agenda_p3' || c === 'lembrete_p1') return 'agenda';
  return null;
}

/**
 * Robôs cujo carimbo de hoje cai num balde diferente do que a classe pediria.
 * Cada um é uma dívida da migração: o teste fixa a lista pelo nome, para ela
 * só encolher de propósito.
 */
export function divergenciasDeCarimbo(): Array<{ robo: string; prefixo: string; contaHoje: ContaHoje; classe: Classe }> {
  const out: Array<{ robo: string; prefixo: string; contaHoje: ContaHoje; classe: Classe }> = [];
  for (const [nome, r] of Object.entries(CLASSE_POR_ROBO)) {
    for (const c of r.carimbos) {
      if (baldeDaClasse(r.classe) !== c.contaHoje) out.push({ robo: nome, prefixo: c.prefixo, contaHoje: c.contaHoje, classe: r.classe });
    }
  }
  return out;
}
