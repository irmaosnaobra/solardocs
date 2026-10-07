// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — CLASSES: quem é cada robô que fala pela linha 5040.
//
// A classe NUNCA é declarada por quem chama nem pelo operador: ela sai daqui
// [crítica]. Foi a classe autodeclarada que derrubou a linha em 02/10 (o
// reagenda perguntava o teto do frio e carimbava como agenda).
//
// Só entram robôs VIVOS no HEAD (e2a225db). Os da limpeza ficaram de fora
// (gerador_seq, broadcastTick, Luma, repescagem, convite investidor, grupo frio,
// estudo e top pontos do eletroposto, MCP e test-send, script de 1º de maio).
// Os prefixos que eles deixaram no lineThrottle continuam contando: estão em
// PREFIXOS_LEGADOS_FRIOS, para a troca futura não mudar a conta.
//
// Arquivo PURO: só dado e função de dado.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * As classes, da mais urgente para a menos.
 *
 * - evento_p0: nasce de um evento e não volta sozinho (compra, ativação, D0,
 *   recuperado, convite pedido, comprovante). NUNCA recebe 'adiar': sai agora
 *   como P0 ou vai para a caixa de saída [crítica].
 * - reativo_p1: resposta a quem escreveu nos últimos 15 min.
 * - lembrete_p1: transacional com prazo em menos de 90 min (lembrete de 5 min e
 *   de 1h, ficha com menos de 30 min, reunião em menos de 2h). Não é classe de
 *   robô: é a classe EFETIVA de um P3 de agenda quando o prazo chega perto.
 * - aviso_interno_p2: destino da equipe. Destino interno vira esta classe,
 *   seja qual for o robô.
 * - transacional_agenda_p3: transacional do dia (confirmação de backlog, bom
 *   dia, diário, cobrança do SIM, boas-vindas). A pessoa marcou, pagou ou pediu.
 * - frio_receita_p4: frio que traz receita (recuperação de checkout, dunning D1
 *   em diante, Pix VIP). Passa na frente do resto do frio.
 * - frio_p5: todo o resto do frio. Quem começa a conversa é frio, mesmo sendo de
 *   agenda.
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

/** P0 e P1: fora do teto da linha e da rampa; só espaçamento curto e emergência [crítica]. */
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

/** Janela de horário do robô: livre (24h), transacional (7h–21h) ou frio (9h–20h, sem domingo). */
export type JanelaRobo = 'livre' | 'transacional' | 'frio';

/** Como o lineThrottle.ts do HEAD conta o prefixo hoje. */
export type ContaHoje = 'frio' | 'agenda';

export interface Carimbo {
  /** Prefixo da chave em system_state, com o ':' do fim. */
  prefixo: string;
  /** Balde em que o HEAD conta: frio (prefixosFrios) ou agenda (PREFIXOS_AGENDA). */
  contaHoje: ContaHoje;
  /** Só conta na linha IO quando o desvio ZAPI_SOLARDOC_VIA_IO=1 está ligado (lineThrottle.ts:177). */
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
  /** Semântica de hoje (pausaHumana.ts): frio respeita; transacional que a pessoa marcou, pagou ou pediu passa. */
  respeitaPausa: boolean;
  /** Envio que nasce de evento não volta se for adiado: vai para a caixa de saída, nunca para 'adiar'. */
  nasceDeEvento: boolean;
  /** Só robô de agenda pode virar P1 pelo prazo. Frio nunca. */
  podeTerPrazo: boolean;
  /** Aviso ao time que não entra em cartão (lead novo, alerta de 10 min). */
  urgente: boolean;
  /** Onde o envio mora hoje, relativo a api/src. É a semente do mapa arquivo → robôs da guarda. */
  arquivos: readonly string[];
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

  // ── P1 · reativo (rebaixa sozinho se o destino não escreveu em 15 min) ─────
  // A vendedora é ela: não respeita a pausa (whatsappAgentService.ts).
  giovanna_reativa: robo('reativo_p1', ['services/agents/whatsapp/whatsappAgentService.ts'], { linha: 'solardoc' }),
  carla_b2b_reativa: robo('reativo_p1', ['services/agents/sdr/sdrB2bAgentService.ts'], { linha: 'solardoc' }),
  // A Duda cala quando um humano entrou (recepcaoIo.ts).
  duda_recepcao: robo('reativo_p1', ['services/io/recepcaoIo.ts'], { respeitaPausa: true }),
  bia_inbound: robo('reativo_p1', ['services/agents/whatsapp/biaInboundService.ts']),
  // Resposta a quem PEDIU para remarcar. O HEAD conta o carimbo como agenda
  // (lineThrottle.ts:209): divergência conhecida, ver DIVERGENCIAS_DE_CARIMBO.
  ep_remarcar_reativo: robo('reativo_p1', ['services/io/eletropostoRemarcar.ts', 'services/io/eletropostoRespostas.ts'], {
    carimbos: [agenda('ep_remarcar_sent:')],
  }),
  webhook_audio_falhou: robo('reativo_p1', ['routes/webhook.ts']),
  // Humano digitando no CRM. Sem conversa nos últimos 15 min, rebaixa como qualquer reativo.
  manual_crm: robo('reativo_p1', ['routes/admin.ts']),

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
  pix_comprovante_dono: robo('aviso_interno_p2', ['services/agents/whatsapp/pixComprovanteService.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  giovanna_aviso_dono: robo('aviso_interno_p2', ['services/agents/whatsapp/whatsappAgentService.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  venda_aviso: robo('aviso_interno_p2', ['services/vendaAviso.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  asaas_aviso: robo('aviso_interno_p2', ['services/asaas/asaasWebhookService.ts'], { nasceDeEvento: true, linha: 'solardoc' }),
  // Alerta de 10 min antes da reunião: tem hora marcada, então vira P1 pelo prazo.
  ep_alerta_10min: robo('aviso_interno_p2', ['services/io/eletropostoAlerta10min.ts'], { urgente: true, podeTerPrazo: true }),
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
  sdr_grupo_interno: robo('aviso_interno_p2', ['services/agents/sdr/sdrGroupAgent.ts', 'services/agents/sdr/sdrAgentService.ts']),
  resumo_dia: robo('aviso_interno_p2', ['routes/cron.ts'], { linha: 'solardoc' }),
  fila_alerta: robo('aviso_interno_p2', ['services/agents/whatsapp/filaAlerta.ts'], { linha: 'solardoc' }),

  // ── P3 · transacional do dia (agenda; vira P1 com prazo perto) ─────────────
  // Confirmação de backlog, bom dia, diário; e os lembretes de 1h e 5 min e a
  // ficha fresca, que chegam aqui com prazo e saem como P1. Hoje sem pausa.
  ep_agenda: robo('transacional_agenda_p3', ['services/io/eletropostoAgenda.ts'], {
    carimbos: [agenda('ep_agenda_sent:')], podeTerPrazo: true,
  }),
  ep_cobra_sim: robo('transacional_agenda_p3', ['services/io/eletropostoCobraSim.ts'], {
    carimbos: [agenda('ep_cobra_sim:')], podeTerPrazo: true, respeitaPausa: true,
  }),
  giovanna_agenda: robo('transacional_agenda_p3', ['services/io/solarAgendaGiovanna.ts'], {
    carimbos: [agenda('solar_giovanna_sent:')], podeTerPrazo: true, respeitaPausa: true,
  }),
  // Hoje 5 bolhas sem janela (solarBoasVindas.ts:147, :514); aqui 1 bolha e,
  // passada a ficha fresca, a janela do transacional.
  solar_boas_vindas: robo('transacional_agenda_p3', ['services/io/solarBoasVindas.ts'], {
    carimbos: [agenda('solar_boasvindas_sent:')], podeTerPrazo: true, respeitaPausa: true,
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
  // No-show de agosto é campanha: frio [especificação]. Mas o HEAD ainda carimba
  // ep_agenda_sent:<id>:reagendado, que conta como agenda: é o defeito de 02/10
  // pela metade. Divergência conhecida; a migração dá a ele prefixo frio.
  ep_reagenda_auto: robo('frio_p5', ['services/io/eletropostoReagendaAuto.ts'], {
    carimbos: [agenda('ep_agenda_sent:')], subprioridade: 2,
  }),
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
  // As rotas de lote passam pelo CHEFE como frio, sempre [crítica]. A de
  // zapiAdmin é a da queda de 30/08.
  manual_lote_admin: robo('frio_p5', ['routes/admin.ts'], { subprioridade: 6 }),
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
  'gerador_seq:',        // drip da Central (geradorAutomacaoService): ainda no process-messages, na limpeza
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

/** Todos os prefixos da linha (o prefixosDaLinha do HEAD, lineThrottle.ts:177). */
export function prefixosDaLinhaDerivados(opts: { solardocViaIo: boolean }): string[] {
  return unicos([...carimbosVivos(opts).map(c => c.prefixo), ...PREFIXOS_LEGADOS_FRIOS]);
}

/** Os prefixos de agenda (o PREFIXOS_AGENDA do HEAD, lineThrottle.ts:207). */
export function prefixosAgendaDerivados(): string[] {
  return unicos(carimbosVivos({ solardocViaIo: true }).filter(c => c.contaHoje === 'agenda').map(c => c.prefixo));
}

/** Os prefixos do frio (o prefixosFrios do HEAD, lineThrottle.ts:216). */
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
