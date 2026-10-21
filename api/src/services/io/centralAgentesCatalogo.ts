// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DA CENTRAL DAS AGENTES — quem é cada robô da casa, em que área mora,
// o que faz em uma linha e COMO o código dele liga e desliga.
//
// Arquivo PURO: só dado e função de dado, sem banco, sem cliente de WhatsApp e
// sem IA. É por isso que o teste dele roda sem mock nenhum e que a Central pode
// importar daqui sem arrastar o Anthropic nem a Z-API.
//
// A FONTE DA VERDADE É O CÓDIGO. Cada entrada cita o arquivo do robô (`fonte`) e
// a chave que ele mesmo lê. Robô apagado do código sai daqui (o teste confere que
// o arquivo existe). Robô novo em `chefe/classes.ts` (CLASSE_POR_ROBO e
// ROBOS_META) tem que cair em algum cartão `robos` ou na lista IGNORADOS: o teste
// também confere.
//
// CADA ROBÔ DESLIGA DO JEITO DELE. Não existe padrão: a maioria é `_OFF` valendo
// só com o texto '1', as de Instagram, Facebook e prospecção valem só com 'true',
// e as de opt-in (semente, curso, retomada, confiança, Bia, Instagram) só ligam
// com 'true'. Aceitar os dois textos num lugar só (como a Central fazia) acende
// "Desligado" para um robô que segue rodando. Por isso a regra mora na entrada,
// copiada do serviço, e o teste prova que o valor errado não vira o selo.
//
// PRIVACIDADE: aqui só entra o NOME da variável de ambiente, nunca o valor.
// ─────────────────────────────────────────────────────────────────────────────

export type AreaId = 'atendimento' | 'solar' | 'eletroposto' | 'prospeccao' | 'instagram' | 'avisos' | 'solardoc';
export type Selo = 'ligado' | 'pausado' | 'desligado';
export type CanalCartao = 'whatsapp' | 'instagram' | 'email' | 'painel';

/** Ordem em que as áreas aparecem na tela. */
export const AREAS: ReadonlyArray<{ id: AreaId; nome: string }> = Object.freeze([
  { id: 'atendimento', nome: 'Atendimento da 5040' },
  { id: 'solar', nome: 'Solar' },
  { id: 'eletroposto', nome: 'Eletroposto' },
  { id: 'prospeccao', nome: 'Prospecção' },
  { id: 'instagram', nome: 'Instagram e Facebook' },
  { id: 'avisos', nome: 'Avisos internos' },
  { id: 'solardoc', nome: 'SolarDoc e LimpaPro' },
]);

/**
 * Como o código do robô decide se roda.
 *
 * - `sempre`: não existe chave. Roda sempre que o cron chama.
 * - `desliga`: roda, salvo se a variável tiver EXATAMENTE `valor` (`'1'` ou `'true'`).
 * - `liga`: não roda, salvo se a variável tiver EXATAMENTE `valor` (sempre `'true'`).
 * - `interruptor`: peça da Fase A dos agentes 5040 (ficha, sentinela). Liga pela env
 *   AGENTES5040_<NOME>=1 OU pela chave ag5040_interruptores do banco; a env `0` desliga e
 *   sobrescreve. Mesma lógica do `ligado()` de services/agentes5040/interruptores.ts.
 * - `banco_recepcao` e `banco_helena`: a chave vive em `system_state` (vale em 1
 *   minuto, sem deploy) e a variável de ambiente é o freio de mão.
 *
 * `trim` e `minusculas` repetem o que o serviço faz com o texto antes de comparar.
 */
export interface ChaveDeEnv { env: string; valor: '1' | 'true'; trim?: boolean; minusculas?: boolean }

export type RegraDaChave =
  | { tipo: 'sempre' }
  /** `tambem`: outras chaves que também param o robô INTEIRO (ex.: o recado do solar para com o
   *  SOLAR_BOASVINDAS_OFF). `parcial`: chave que para só uma parte; vira Pausado, não Desligado. */
  | ({ tipo: 'desliga'; tambem?: readonly ChaveDeEnv[]; parcial?: ChaveDeEnv & { motivo: string } } & ChaveDeEnv)
  /** `exige`: variáveis que o robô também precisa ter preenchidas (só o NOME, nunca o valor). */
  | { tipo: 'liga'; env: string; valor: 'true' | '1'; trim?: boolean; minusculas?: boolean; exige?: readonly string[] }
  | { tipo: 'interruptor'; nome: 'ensaio' | 'replay' | 'ficha' | 'sentinela' }
  | { tipo: 'banco_recepcao' }
  | { tipo: 'banco_helena' };

export interface EntradaDoCatalogo {
  id: string;
  nome: string;
  area: AreaId;
  /** O que faz, em uma linha. Até 60 caracteres. */
  resumo: string;
  /** O texto longo, que abre em "Detalhes". */
  papel: string;
  canal: CanalCartao;
  linha: 'io' | 'solardoc' | null;
  regra: RegraDaChave;
  /** Arquivo do robô, relativo a `api/src`. É de onde a regra e o texto saíram. */
  fonte: string;
  /** Nomes de `CLASSE_POR_ROBO` e `ROBOS_META` que este cartão cobre. */
  robos: readonly string[];
}

/** Nomes de `CLASSE_POR_ROBO` que não são robô: mensagem avulsa de gente ou de lote. */
export const IGNORADOS: Readonly<Record<string, string>> = Object.freeze({
  manual_crm: 'Mensagem que uma pessoa digita no CRM. Quem fala é gente.',
  zapi_admin_lote: 'Rota de lote do admin. Passa pelo CHEFE como frio, mas não é um robô com rotina.',
  webhook_audio_falhou: 'Resposta avulsa do webhook quando um áudio não abre. Não tem rotina nem chave.',
  // Fase 1 das redes (14/10/2026): tudo sai por clique de gente da equipe na tela
  // de Redes, um item por clique. Não há rotina que dispare sozinha.
  status_5040: 'Status em vídeo da 5040, um por clique de gente da equipe.',
  ig_publicar: 'Reel publicado por clique na tela de Redes.',
  fb_publicar: 'Reel publicado por clique na tela de Redes.',
  ig_resposta_manual: 'Resposta que uma pessoa digita a um comentário do Instagram.',
  fb_resposta_manual: 'Resposta que uma pessoa digita a um comentário do Facebook.',
});

const e = (x: EntradaDoCatalogo): EntradaDoCatalogo => Object.freeze({ ...x, robos: Object.freeze([...x.robos]) });
const off1 = (env: string, trim = true): ChaveDeEnv & { tipo: 'desliga' } => ({ tipo: 'desliga', env, valor: '1', trim });
const offTrue = (env: string): ChaveDeEnv & { tipo: 'desliga' } => ({ tipo: 'desliga', env, valor: 'true', trim: true });
const onTrue = (env: string, trim = true, minusculas = true, exige?: readonly string[]): RegraDaChave =>
  ({ tipo: 'liga', env, valor: 'true', trim, minusculas, ...(exige ? { exige } : {}) });

export const CATALOGO: readonly EntradaDoCatalogo[] = Object.freeze([
  // ── Atendimento da 5040 ────────────────────────────────────────────────────
  e({
    id: 'cora', nome: 'Cora', area: 'atendimento', canal: 'whatsapp', linha: 'io',
    resumo: 'Escuta e registra tudo que chega na 5040',
    papel: 'Registra as mensagens que entram na linha 5040 e transforma a resposta de campanha em recado para a equipe. Ela não conversa. Quem responde é gente, a Duda (recepção) ou a Helena (investidores). O número abaixo é de mensagens recebidas.',
    regra: { tipo: 'sempre' }, fonte: 'services/agents/sdr/sdrIoPolling.ts',
    robos: ['sdr_io_aviso', 'webhook_aviso_equipe'],
  }),
  e({
    id: 'duda_recepcao', nome: 'Duda, recepção da 5040', area: 'atendimento', canal: 'whatsapp', linha: 'io',
    resumo: 'Atende quem chega sozinho e chama o humano certo',
    papel: 'Responde na hora quem escreve na 5040 sem ter conversa com a casa, descobre o motivo e o produto, registra a origem e chama o consultor certo com a ficha pronta. Não dá preço, não agenda e não vende. Cala quando um humano entra na conversa. Liga e desliga pela chave recepcao_io:ativa no banco, que vale em 1 minuto, e RECEPCAO_IO_OFF é o freio de mão.',
    regra: { tipo: 'banco_recepcao' }, fonte: 'services/io/recepcaoIo.ts',
    robos: ['duda_recepcao', 'duda_ficha_consultor'],
  }),
  e({
    id: 'entrada_io_digest', nome: 'Resumo da entrada da 5040', area: 'atendimento', canal: 'whatsapp', linha: 'io',
    resumo: 'Manda às 12h e 18h quem escreveu na 5040 hoje',
    papel: 'Duas vezes por dia, às 12h e às 18h (Brasília), o Thiago e o Diego recebem a lista de quem escreveu na 5040, separando quem já está no CRM de quem é gente nova. É recibo, não resposta. Cada turno sai uma vez por dia.',
    regra: { tipo: 'sempre' }, fonte: 'services/io/entradaIoDigest.ts',
    robos: ['entrada_io_digest'],
  }),

  // ── Solar ──────────────────────────────────────────────────────────────────
  e({
    id: 'solar_boas_vindas', nome: 'Boas-vindas do solar', area: 'solar', canal: 'whatsapp', linha: 'io',
    resumo: 'Recibo do cadastro: quem atende e a pergunta do consumo',
    papel: 'Assim que alguém se cadastra em energia solar (LP, /simular ou Lead Ads), fala com o cliente: diz quem é o consultor dele, passa o WhatsApp desse consultor, avisa que NÓS entramos em contato e faz UMA pergunta: o consumo atual. Não fala de horário, de propósito.',
    regra: off1('SOLAR_BOASVINDAS_OFF'), fonte: 'services/io/solarBoasVindas.ts',
    robos: ['solar_boas_vindas'],
  }),
  e({
    id: 'duda_quiz', nome: 'Duda, quiz solar', area: 'solar', canal: 'whatsapp', linha: 'io',
    resumo: 'Chama quem fez o quiz e responde quem escreve de volta',
    papel: 'Manda a primeira mensagem ao curioso e a quem fez o simulador e não marcou horário (quem marcou recebe as boas-vindas), responde quem escreve de volta nos 15 minutos seguintes e passa para o consultor quando precisa. Cala quando um humano entra na conversa. A fila da primeira mensagem também respeita SOLAR_BOASVINDAS_OFF.',
    // A fila da primeira mensagem (solarBoasVindas.ts:794) obedece SOLAR_BOASVINDAS_OFF; a conversa, só SOLAR_AGENTE_OFF.
    regra: { ...off1('SOLAR_AGENTE_OFF'), parcial: { env: 'SOLAR_BOASVINDAS_OFF', valor: '1', trim: true, motivo: 'SOLAR_BOASVINDAS_OFF está armada: a primeira mensagem parou, só a conversa segue' } },
    fonte: 'services/io/solarAgenteQuiz.ts',
    robos: ['solar_agente_quiz', 'solar_agente_recado'],
  }),
  e({
    id: 'solar_respostas', nome: 'Recado das respostas do solar', area: 'solar', canal: 'whatsapp', linha: 'io',
    resumo: 'Cliente respondeu: vira recado para o consultor dono',
    papel: 'Quando o cliente responde as boas-vindas, o recado com o que ele escreveu vai para o consultor dono da ficha, com cópia para o Thiago. Foto da conta de luz, áudio e vídeo são encaminhados para o WhatsApp do consultor, não só contados.',
    // solarRespostas.ts:284 também para com SOLAR_BOASVINDAS_OFF (importa o `desligado` dele).
    regra: { ...off1('SOLAR_RESPOSTAS_OFF'), tambem: [{ env: 'SOLAR_BOASVINDAS_OFF', valor: '1', trim: true }] },
    fonte: 'services/io/solarRespostas.ts',
    robos: ['solar_respostas_aviso', 'encaminha_midia'],
  }),
  e({
    id: 'solar_giovanna', nome: 'Giovanna, régua das 7h', area: 'solar', canal: 'whatsapp', linha: 'io',
    resumo: 'Bom dia às 7h e um oi 5 min antes da ligação',
    papel: 'Na carteira da Giovanna e da Nilce, manda um bom dia às 7h e um oi 5 minutos antes da ligação marcada. Tem teto por hora e por dia e cala quando um humano entra na conversa.',
    regra: off1('SOLAR_GIOVANNA_OFF'), fonte: 'services/io/solarAgendaGiovanna.ts',
    robos: ['giovanna_agenda'],
  }),
  e({
    id: 'reagenda_solar', nome: 'Reagenda do solar', area: 'solar', canal: 'painel', linha: null,
    resumo: 'Quem não atendeu volta para a agenda no dia seguinte',
    papel: 'Todo card do solar marcado como não atendeu volta sozinho para a agenda no dia seguinte. Card da Giovanna ou da Nilce passa para a outra consultora. SOLAR_NAO_ATENDEU_TROCA_OFF desfaz só a troca de consultora, e SOLAR_REAGENDA_OFF desliga o robô.',
    regra: off1('SOLAR_REAGENDA_OFF'), fonte: 'services/agenda/reagendaSolarNaoAtendido.ts',
    robos: [],
  }),
  e({
    id: 'semente', nome: 'Semente do solar', area: 'solar', canal: 'whatsapp', linha: 'io',
    resumo: 'Um toque por mês para quem orçou e não fechou',
    papel: 'Nutrição de quem pediu orçamento de solar e não fechou. No máximo 4 toques, 1 a cada 30 dias, com ângulo novo a cada vez e saída em toda mensagem (responde PARAR). Janela de 9h às 19h, uma pessoa a cada 15 minutos. Opt-in: só liga com SEMENTE_ON=true.',
    regra: onTrue('SEMENTE_ON'), fonte: 'services/io/sementeSolarService.ts',
    robos: ['semente'],
  }),
  e({
    id: 'roteamento_solar', nome: 'Roteamento do solar', area: 'solar', canal: 'painel', linha: null,
    resumo: 'Decide quem atende cada lead pelo tamanho da conta',
    papel: 'Não fala com ninguém: é a regra que decide QUEM fala. Escolhe o consultor de cada lead de solar pelo consumo respondido e avisa a equipe da ficha nova.',
    regra: { tipo: 'sempre' }, fonte: 'routes/ioSolar.ts',
    robos: ['solar_aviso_ficha'],
  }),

  // ── Eletroposto ────────────────────────────────────────────────────────────
  e({
    id: 'eletroposto', nome: 'Ficha da landing do eletroposto', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Classifica o lead em nota 1 a 3 e avisa a equipe',
    papel: 'Classifica o lead da LP em nota 1 a 3: nota 1 vai pro grupo na hora, nota 2 e 3 viram ficha e aviso pros consultores. Quem pede o convite do grupo também passa por aqui.',
    regra: { tipo: 'sempre' }, fonte: 'routes/ioEletroposto.ts',
    robos: ['ep_aviso_ficha', 'convite_grupo_pedido'],
  }),
  e({
    id: 'agenda_eletroposto', nome: 'Agenda do eletroposto', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Confirma ao marcar e lembra antes da reunião',
    papel: 'Assim que alguém marca na LP, confirma o horário no WhatsApp. Quem marcou com dias de antecedência recebe um bom dia no dia, depois o aviso de 1 hora antes e o chamado de 5 minutos antes. Existe por causa de quem marca e some. EP_DIARIO_OFF desliga só o lembrete diário da véspera.',
    regra: off1('EP_LEMBRETES_OFF'), fonte: 'services/io/eletropostoAgenda.ts',
    robos: ['ep_agenda', 'ep_desmarcacao_aviso'],
  }),
  e({
    id: 'ep_cobra_sim', nome: 'Régua do SIM', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Cobra o SIM e devolve o horário de quem não responde',
    papel: 'Quem marcou e não respondeu nada leva duas cobranças (a segunda diz a hora exata em que o horário vai embora) e, na terceira, perde o horário: a ficha vira cancelado, o horário volta para a vitrine da LP e a pessoa entra no Curioso. Quem escreve qualquer coisa sai da régua na hora.',
    regra: off1('EP_COBRA_SIM_OFF'), fonte: 'services/io/eletropostoCobraSim.ts',
    robos: ['ep_cobra_sim'],
  }),
  e({
    id: 'ep_remarcar', nome: 'Remarcação sozinha', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Oferece 3 horários a quem pede para remarcar',
    papel: 'Quando o lead diz que não vai dar, oferece os 3 próximos horários livres DO MESMO consultor, espera a pessoa escolher o número e troca na hora, liberando o horário antigo. Nunca cancela, nunca muda de consultor e nunca move sem escolha explícita. Quem pede para CANCELAR continua indo para o humano.',
    regra: off1('EP_REMARCAR_OFF'), fonte: 'services/io/eletropostoRemarcar.ts',
    robos: ['ep_remarcar_reativo'],
  }),
  e({
    id: 'ep_reagenda_auto', nome: 'Vermelho quente volta sozinho', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Reagenda o lead quente que faltou, até 2 vezes',
    papel: 'Só lead QUENTE (nota 3) que não apareceu: 45 minutos depois do horário perdido o robô MARCA o próximo dia útil, no mesmo horário ou no primeiro livre, com o mesmo consultor, e a régua de avisos recomeça. Duas vezes; na segunda a mensagem diz que é a última. Morno e frio ficam vermelhos para a equipe.',
    regra: off1('EP_REAGENDA_AUTO_OFF'), fonte: 'services/io/eletropostoReagendaAuto.ts',
    robos: ['ep_reagenda_auto'],
  }),
  e({
    id: 'ep_nao_atendido', nome: 'Não atendeu: chamadas de volta', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Chama de volta quem não atendeu, com horários na mesa',
    papel: 'Quando o consultor marca NÃO ATENDIDO, a pessoa recebe três chamadas de volta com horários para remarcar (19h do dia, manhã seguinte e D+3, a terceira avisa que é a última). Sem reagendar nenhuma vez, cai na lista de Cadastros em D+4 para o time trabalhar. Quem o ROBÔ marcou de ausente não entra.',
    regra: off1('EP_FUP_NAOATENDIDO_OFF'), fonte: 'services/io/eletropostoNaoAtendidoFup.ts',
    robos: ['ep_oferta_fria'],
  }),
  e({
    id: 'ep_retorno', nome: 'Retorno de quem perdeu o horário', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Chama de volta quem perdeu o horário na régua do SIM',
    papel: 'Quem perdeu o horário na régua do SIM é chamado de volta com horário na mesa, 2 vezes. É o follow-up de retorno de quem deixou a agenda por silêncio.',
    regra: off1('EP_RETORNO_OFF'), fonte: 'services/io/eletropostoRetorno.ts',
    robos: [],
  }),
  e({
    id: 'ep_respostas', nome: 'Recado das respostas do eletroposto', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Resposta do lead vira recado para Thiago e Diego',
    papel: 'Quando o lead responde alguma mensagem da automação, o recado com o que ele escreveu, a hora da reunião e de quem ele é vai para o Thiago e o Diego em até 5 minutos. Não é mensagem para o lead.',
    regra: off1('EP_RESPOSTAS_OFF'), fonte: 'services/io/eletropostoRespostas.ts',
    robos: ['ep_respostas_aviso'],
  }),
  e({
    id: 'ep_alerta_10min', nome: 'Alerta de 10 minutos', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Avisa o consultor 10 min antes da reunião confirmada',
    papel: 'Entre 13 e 8 minutos antes da reunião, só de reunião confirmada, cai no WhatsApp do consultor dono da reunião. É o único toque da régua que não vai para o lead. Uma vez por reunião; remarcou, alerta de novo.',
    regra: off1('EP_ALERTA_10MIN_OFF'), fonte: 'services/io/eletropostoAlerta10min.ts',
    robos: ['ep_alerta_10min'],
  }),
  e({
    id: 'ep_card_ping', nome: 'Card de volta no repasse', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Reenvia o card ao novo dono quando o repasse de 12h troca',
    papel: 'Quando o repasse de 12h troca o dono de um card, o card chega de novo no WhatsApp de quem está com ele.',
    regra: off1('EP_CARD_PING_OFF'), fonte: 'services/io/eletropostoCardPing.ts',
    robos: ['ep_card_ping'],
  }),
  e({
    id: 'ep_ig_convite', nome: 'Convite da landing (Instagram)', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Convida quem veio do Instagram a marcar na landing',
    papel: 'Lead que veio da DM do Instagram não marca agenda direto: recebe UM convite com o link da LP para simular e escolher o horário lá. Sai na vez dele na fila, de 9h às 19h, um a cada 10 minutos.',
    regra: off1('EP_IG_CONVITE_OFF'), fonte: 'services/io/eletropostoIgConvite.ts',
    robos: ['ep_ig_convite'],
  }),
  e({
    id: 'ep_estudo', nome: 'Estudo do local', area: 'eletroposto', canal: 'painel', linha: null,
    resumo: 'Monta o estudo do terreno antes da reunião',
    papel: 'A cada reunião com endereço, acha o terreno no Google, o entorno, os carregadores e o município, calcula as notas e pede o texto à IA. Estudo pronto vira um aviso só, para o dono da reunião. Nunca fala com o lead. EP_ESTUDO_AVISO_OFF desliga só o aviso.',
    regra: off1('EP_ESTUDO_OFF'), fonte: 'services/io/eletropostoEstudo.ts',
    robos: [],
  }),
  e({
    id: 'ep_top_pontos', nome: 'Top 20 pontos do dia', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Manda ao meio-dia os 20 melhores pontos para a equipe',
    papel: 'Ao meio-dia de Brasília ranqueia todo ponto com endereço (reunião, parceria e nota 1) e manda a lista para o Thiago e o Diego.',
    regra: off1('EP_TOP_OFF'), fonte: 'services/io/eletropostoTopPontos.ts',
    robos: [],
  }),
  e({
    id: 'avisos_pauta', nome: 'Avisos para a base de parceria', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Manda a pauta da tela Avisos, um contato por vez',
    papel: 'Manda a pauta escrita na tela Avisos (Eletroposto) para a base de parceria, UM contato por tick, com janela diurna, espaçamento e teto da linha. Não é disparo em massa: a base leva dias de propósito.',
    regra: off1('AVISOS_OFF'), fonte: 'services/io/avisosTickService.ts',
    robos: ['avisos_pauta'],
  }),
  e({
    id: 'helena', nome: 'Helena, investidores', area: 'eletroposto', canal: 'whatsapp', linha: 'io',
    resumo: 'Chama quem declarou investimento e marca a reunião',
    papel: 'Chama, uma pessoa por vez, quem preencheu o formulário do eletroposto e declarou quanto pretende investir, confirma se o plano continua de pé e marca a reunião com o consultor. Quem respondeu é atendido por ela, que lê a conversa inteira. Cala quando um humano entra. Liga e desliga pela chave inv_agente_off no banco, e INVESTIDOR_AGENTE_OFF é o freio de mão.',
    regra: { tipo: 'banco_helena' }, fonte: 'services/io/investidorAgente.ts',
    robos: ['investidor_agente_abertura', 'investidor_agente_respostas', 'investidor_agente_recado'],
  }),

  // ── Prospecção ─────────────────────────────────────────────────────────────
  e({
    id: 'prospeccao', nome: 'Prospecção fria', area: 'prospeccao', canal: 'painel', linha: null,
    resumo: 'Monta listas de empresas pelo Google Maps e Receita',
    papel: 'Roda as buscas pedidas na tela Prospecção (Google Maps e Receita Federal pela Apify) e devolve a lista pronta. O toque é MANUAL, um por vez: nada dispara sozinho. Tem teto de leads por busca e de buscas por dia.',
    regra: offTrue('PROSPECCAO_APIFY_OFF'), fonte: 'services/io/prospeccaoApifyService.ts',
    robos: [],
  }),
  e({
    id: 'prospeccao_aviso', nome: 'Aviso da prospecção', area: 'prospeccao', canal: 'whatsapp', linha: null,
    resumo: 'Avisa quando um prospecto chega ao checkout ou compra',
    papel: 'Quando alguém que veio da prospecção entra no checkout ou compra, o dono recebe um aviso na hora com o nome da empresa. Cada checkout e cada venda avisam uma vez.',
    regra: offTrue('PROSPECCAO_AVISO_OFF'), fonte: 'services/io/prospeccaoAviso.ts',
    robos: ['prospeccao_aviso'],
  }),
  e({
    id: 'prospeccao_ig', nome: 'Prospecção no Instagram', area: 'prospeccao', canal: 'instagram', linha: null,
    resumo: 'Responde quem respondeu a DM de prospecção',
    papel: 'A primeira DM sai pelo navegador. Da resposta em diante é este robô: a Meta entrega a mensagem no webhook, ele descobre de quem é, monta o histórico, chama a IA e devolve pela API oficial. Com PROSPECCAO_IA_OFF=true ele guarda a mensagem e não responde.',
    regra: offTrue('PROSPECCAO_IA_OFF'), fonte: 'services/io/prospeccaoConversaIg.ts',
    robos: ['ig_prospeccao'],
  }),

  // ── Instagram e Facebook ───────────────────────────────────────────────────
  e({
    id: 'instagram', nome: 'Comentário vira DM', area: 'instagram', canal: 'instagram', linha: null,
    resumo: 'Responde comentário com DM e entrega o link certo',
    papel: 'Responde comentário no @irmaosnaobra__ com DM automática e entrega o link certo por produto. Quem parou no "me segue" recebe o lembrete de 1 hora. Quem nunca respondeu não recebe, porque DM exige janela de 24h aberta. IG_LEMBRETE_1H_OFF desliga só o lembrete.',
    regra: onTrue('IG_AUTOMACAO_ENABLED', true, false), fonte: 'services/instagram/igEngine.ts',
    robos: ['ig_fila', 'ig_aviso_equipe'],
  }),
  e({
    id: 'fb_comentarios', nome: 'Facebook: comentários', area: 'instagram', canal: 'instagram', linha: null,
    resumo: 'Responde em privado quem comenta no post ou anúncio',
    papel: 'Comentário em post ou anúncio da Página do Facebook vira resposta privada.',
    regra: offTrue('FB_COMENTARIOS_OFF'), fonte: 'services/instagram/fbComentarios.ts',
    robos: ['fb_comentarios'],
  }),
  e({
    id: 'fb_inbox', nome: 'Facebook: Messenger', area: 'instagram', canal: 'instagram', linha: null,
    resumo: 'Responde o inbox, manda o menu e chama o humano',
    papel: 'Atende o inbox do Messenger da Página: responde, manda o menu e chama o humano quando precisa, avisando a equipe.',
    regra: offTrue('FB_INBOX_OFF'), fonte: 'services/instagram/fbMensagens.ts',
    robos: ['fb_inbox', 'fb_aviso_equipe'],
  }),

  // ── Avisos internos ────────────────────────────────────────────────────────
  e({
    id: 'sentinela_vacuo', nome: 'Sentinela do vácuo', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Cobra o dono quando alguém escreve e fica sem resposta',
    papel: 'Quem escreveu para a linha e ficou sem resposta vira UM resumo para o dono do produto, com três níveis de cobrança. Não fala com cliente nenhum: cobra a equipe.',
    regra: off1('VACUO_OFF'), fonte: 'services/io/sentinelaVacuo.ts',
    robos: ['sentinela_vacuo'],
  }),
  e({
    id: 'sentinela_ferramentas', nome: 'Sentinela das ferramentas', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Avisa o dono antes de ferramenta paga vencer ou zerar',
    papel: 'Toda manhã às 7h20 (Brasília) confere as ferramentas pagas (Meta, Z-API, Anthropic, OpenAI) e o calendário de vencimentos que o sócio mantém. Manda UMA mensagem ao dono só quando algo vence em até 7 dias (30 para domínio), já venceu ou falhou, e fica calada quando está tudo em dia. No mesmo aviso vai o resumo da Giovanna em dia útil. Não fala com cliente nenhum.',
    regra: { tipo: 'interruptor', nome: 'sentinela' }, fonte: 'services/io/sentinelaEnvio.ts',
    robos: ['sentinela_ferramentas'],
  }),
  e({
    id: 'lembrete_followup', nome: 'Lembrete de follow-up', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Manda a cada consultor o card parado mais urgente',
    papel: 'Acha o card parado mais urgente de CADA consultor e manda "liga agora nesse cliente" no celular dele. Um por pessoa a cada 30 minutos, das 10h às 20h, sem domingo e sem feriado. Não fala com cliente nenhum.',
    regra: off1('LEMBRETE_OFF'), fonte: 'services/io/lembreteFollowupService.ts',
    robos: ['lembrete_followup'],
  }),
  e({
    id: 'placar_giovanna', nome: 'Placar da 5040', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Manda a cada 2h quantas conversas esperam resposta',
    papel: 'De 2 em 2 horas, de segunda a sexta, manda o placar da linha inteira: quantas conversas estão com a última palavra do cliente, e o delta contra o placar anterior. Não sai nome nenhum. Foi pedido para a Giovanna saber quanta gente espera retorno.',
    regra: off1('PLACAR_OFF'), fonte: 'services/io/placarGiovanna.ts',
    robos: ['placar_giovanna'],
  }),
  e({
    id: 'ficha_consultor_5040', nome: 'Ficha ao consultor', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Manda ao consultor o resumo do cliente que agendou',
    papel: 'Todo cliente agendado de solar e eletroposto gera um resumo de contexto, gravado no card e mandado no celular do consultor dono dele, com o link da conversa. Substitui os avisos de lead novo que ele já recebia pelo mesmo evento: um aviso só por lead. Não fala com cliente nenhum. Nasce desligada: o dono liga pelo interruptor da ficha (AGENTES5040_FICHA=1 ou a chave ag5040_interruptores).',
    regra: { tipo: 'interruptor', nome: 'ficha' }, fonte: 'services/agentes5040/fichaEnvio.ts',
    robos: ['ficha_consultor_5040'],
  }),
  e({
    id: 'agenda_proxima', nome: 'Próxima agenda', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Manda 3 vezes ao dia a agenda do próximo dia útil',
    papel: 'Às 9h, 16h e 20h (Brasília) o Thiago e o Diego recebem a lista geral dos clientes marcados no próximo dia que tem agenda. Hoje nunca entra.',
    regra: { tipo: 'sempre' }, fonte: 'services/agenda/agendaProximaDigest.ts',
    robos: ['agenda_proxima_digest'],
  }),
  e({
    id: 'reagendar_digest', nome: 'Reagendar do dia', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Às 17h manda a cada consultor quem precisa reagendar',
    papel: 'Todo dia às 17h (Brasília) cada consultor recebe a lista dos clientes dele que estão parados precisando ser reagendados, com um link que abre o CRM já filtrado.',
    regra: { tipo: 'sempre' }, fonte: 'services/agenda/reagendarDigest.ts',
    robos: ['reagendar_digest'],
  }),
  e({
    id: 'resumo_dia', nome: 'Resumo do dia', area: 'avisos', canal: 'whatsapp', linha: 'solardoc',
    resumo: 'Às 23h55 manda o saldo de seguidores e os cliques',
    papel: 'Às 23h55 manda ao dono o saldo do dia de seguidores do Instagram e quantos cliques nossos foram para o perfil. É saldo, não origem: a API do Instagram não entrega quem seguiu.',
    regra: { tipo: 'sempre' }, fonte: 'services/instagram/resumoDoDia.ts',
    robos: ['resumo_dia'],
  }),
  e({
    id: 'indicacao', nome: 'Indicação', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Quem indica cai no WhatsApp do Thiago e vira card',
    papel: 'Quem indica alguém cai direto no WhatsApp do Thiago e o indicado vira card no CRM. Quem indicou recebe a confirmação.',
    regra: { tipo: 'sempre' }, fonte: 'routes/ioIndicacoes.ts',
    robos: ['indicacao_confirmacao', 'indicacao_aviso_equipe'],
  }),
  e({
    id: 'aviso_lead_novo', nome: 'Aviso de lead novo', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Avisa o consultor de lead do ManyChat e do Meta',
    papel: 'Lead quente que chega do ManyChat (DM do Instagram) ou do Lead Ads do Meta cai no CRM, roteado para o consultor da vez, com aviso no WhatsApp dele.',
    regra: { tipo: 'sempre' }, fonte: 'services/agenda/manychatLeadService.ts',
    robos: ['manychat_aviso', 'leads_meta_alerta'],
  }),
  e({
    id: 'proposta_aberta', nome: 'Aviso de proposta aberta', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Avisa o consultor quando o cliente abre a proposta',
    papel: 'Quando o cliente abre a proposta, clica no botão de falar no WhatsApp ou cai numa proposta vencida, o consultor dono recebe o aviso na hora, com a cidade de quem abriu.',
    regra: { tipo: 'sempre' }, fonte: 'controllers/trackingGeradorController.ts',
    robos: ['tracking_gerador_aviso'],
  }),
  e({
    id: 'nexus_portal_aviso', nome: 'Aviso do Portal do Parceiro NEXUS', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Avisa o comercial do que o parceiro NEXUS faz',
    papel: 'Cadastro de parceiro, pedido de conversa, engenharia ou preço, pedido de equipamento, usina indicada e resposta a oportunidade chegam ao número da equipe em uma bolha, no máximo 12 por hora (acima disso o cadastro e a usina vão só por e-mail). Nasce desligado: só roda com NEXUS_AVISO_LIGADO=1 e NEXUS_AVISO_PHONE preenchida.',
    regra: { tipo: 'liga', env: 'NEXUS_AVISO_LIGADO', valor: '1', trim: true, exige: ['NEXUS_AVISO_PHONE'] }, fonte: 'services/nexus/avisoComercial.ts',
    robos: ['nexus_aviso_comercial'],
  }),
  e({
    id: 'grupo_equipe', nome: 'Assistente do grupo da equipe', area: 'avisos', canal: 'whatsapp', linha: 'io',
    resumo: 'Atende comandos do time no grupo, quando chamado',
    papel: 'Dentro do grupo de consultores, atende comandos do time quando alguém a chama pelo nome: buscar lead, assumir a conversa, registrar agendamento manual, descartar. O cartão de agendamento também sai para esse grupo.',
    regra: { tipo: 'sempre' }, fonte: 'services/agents/sdr/sdrGroupAgent.ts',
    robos: ['sdr_grupo_interno'],
  }),
  e({
    id: 'vigias', nome: 'Vigias da linha e da fila', area: 'avisos', canal: 'painel', linha: null,
    resumo: 'Avisa quando a linha cai, a IA para ou o documento falha',
    papel: 'Quatro vigias que só avisam: o monitor da Z-API (linha 5040 caída vira e-mail), a saúde da linha (razão saída por entrada e pico por hora), a sonda de documentos (assinante apanhando no PDF) e o aviso único de apagão da IA quando a fila desiste de várias mensagens juntas.',
    regra: { tipo: 'sempre' }, fonte: 'services/agents/whatsapp/filaAlerta.ts',
    robos: ['fila_alerta'],
  }),

  // ── SolarDoc e LimpaPro ────────────────────────────────────────────────────
  e({
    id: 'bia', nome: 'Bia, recuperação LimpaPro', area: 'solardoc', canal: 'whatsapp', linha: 'io',
    resumo: 'Chama quem largou o checkout do LimpaPro, em 4 toques',
    papel: 'Fala com quem entrou no checkout do LimpaPro e não comprou. Quatro toques, um por vez, e para no instante em que a pessoa responde. Os toques 2, 3 e 4 têm chave própria (RECUP_CUPOM_ENABLED, RECUP_FECHAMENTO_ENABLED e RECUP_GRUPO_ENABLED).',
    regra: onTrue('RECUP_ENABLED', false, false, ['ZAPI_INSTANCE_ID_IO', 'ZAPI_TOKEN_IO']), fonte: 'services/agents/whatsapp/limpaproRecoveryService.ts',
    robos: ['bia_recuperacao', 'bia_inbound'],
  }),
  e({
    id: 'giovanna', nome: 'Giovanna, follow-up da plataforma', area: 'solardoc', canal: 'whatsapp', linha: 'solardoc',
    resumo: 'Cadências para quem se cadastrou sem CNPJ ou sumiu',
    papel: 'Duas cadências pra quem se cadastrou na plataforma: quem não preencheu CNPJ (3 toques em 30 dias) e quem sumiu (5 toques em 60 dias). Quando o cliente responde, é a mesma Giovanna que continua a conversa, e o dono recebe o aviso. Não tem chave própria: o freio é o teto de envios por hora.',
    regra: { tipo: 'sempre' }, fonte: 'services/agents/whatsapp/carlaPlatformFollowupService.ts',
    robos: ['carla_sem_cnpj', 'carla_inativo', 'giovanna_reativa', 'carla_b2b_reativa', 'carla_cnpj_killer', 'whatsapp_followup', 'giovanna_aviso_dono'],
  }),
  e({
    id: 'curso19', nome: 'Campanha do curso R$ 19', area: 'solardoc', canal: 'whatsapp', linha: 'solardoc',
    resumo: 'Oferece o kit de fechamento por R$ 19 à base parada',
    papel: 'Oferece o Kit de Fechamento por R$ 19 (com 30 dias de plataforma) pra base cadastrada. Três toques, e para quando a pessoa responde. Opt-in: só liga com CAMPANHA_CURSO19_ON=true.',
    regra: onTrue('CAMPANHA_CURSO19_ON', false), fonte: 'services/agents/whatsapp/cursoEntradaBroadcast.ts',
    robos: ['curso19'],
  }),
  e({
    id: 'carla_retomada', nome: 'Retomada do 1x1 do SolarDoc', area: 'solardoc', canal: 'whatsapp', linha: 'io',
    resumo: 'Volta em quem ficou sem desfecho no 1x1 do SolarDoc',
    papel: 'Volta em quem conversou no 1x1 do SolarDoc e ficou sem desfecho, no ponto exato onde a conversa parou. Quem engajou recebe até 2 toques, quem só mandou a frase de entrada recebe 1 e nunca mais. Opt-in: só liga com CARLA_RETOMADA_ON=true.',
    regra: onTrue('CARLA_RETOMADA_ON', false), fonte: 'services/agents/sdr/carlaRetomada.ts',
    robos: ['carla_retomada'],
  }),
  e({
    id: 'confianca_email', nome: 'Nutrição do assinante novo (e-mail)', area: 'solardoc', canal: 'email', linha: null,
    resumo: 'Cinco e-mails nos primeiros 30 dias do assinante novo',
    papel: 'Nutrição do assinante novo nos dias 1, 3, 7, 14 e 30, a janela em que metade de quem cancela cancela. Conteúdo útil, sem oferta. Opt-in: só liga com CONFIANCA_ENABLED=true.',
    regra: onTrue('CONFIANCA_ENABLED'), fonte: 'services/confiancaService.ts',
    robos: [],
  }),
  e({
    id: 'confianca_wa', nome: 'Nutrição do assinante novo (WhatsApp)', area: 'solardoc', canal: 'whatsapp', linha: 'solardoc',
    resumo: 'Três cards nos primeiros 25 dias do assinante novo',
    papel: 'Braço de WhatsApp da mesma cadência: 3 toques (dias 5, 12 e 25), uma imagem com legenda curta cada. Divide o teto anti-ban da linha com a Giovanna. Opt-in: só liga com CONFIANCA_WA_ENABLED=true.',
    regra: onTrue('CONFIANCA_WA_ENABLED'), fonte: 'services/confiancaWhatsAppService.ts',
    robos: ['confianca_whatsapp'],
  }),
  e({
    id: 'pesquisa_satisfacao', nome: 'Pesquisa de satisfação', area: 'solardoc', canal: 'whatsapp', linha: 'solardoc',
    resumo: 'Pergunta 3 coisas aos 10 clientes mais contínuos',
    papel: 'Pesquisa de 3 perguntas com os 10 clientes mais contínuos, por WhatsApp, uma por rodada, dentro do teto da linha, até esvaziar. PESQUISA_WHATSAPP_OFF=1 para no meio.',
    regra: { tipo: 'desliga', env: 'PESQUISA_WHATSAPP_OFF', valor: '1' }, fonte: 'services/pesquisaSatisfacao.ts',
    robos: ['pesquisa_satisfacao'],
  }),
  e({
    id: 'compra_cobranca', nome: 'Compra, ativação e cobrança', area: 'solardoc', canal: 'whatsapp', linha: 'solardoc',
    resumo: 'Mensagens de compra, Pix e cobrança do SolarDoc',
    papel: 'Boas-vindas e link de senha de quem acabou de pagar, comprovante do Pix, recuperação de checkout, cobrança falha (D0 a D5), lembrete do VIP por Pix e os avisos de venda para o dono. Nascem de um evento de pagamento. O lembrete do VIP por Pix desliga com PIX_MENSAL_OFF.',
    regra: { tipo: 'sempre' }, fonte: 'services/dunningService.ts',
    robos: [
      'solardoc_boas_vindas', 'solardoc_compra', 'solardoc_ativacao', 'dunning_d0', 'dunning_d5',
      'dunning_lembrete', 'dunning_recuperado', 'pix_comprovante_cliente', 'pix_comprovante_dono',
      'pix_vip_lembrete', 'trafego_confirmacao', 'recuperacao_checkout', 'venda_aviso', 'asaas_aviso',
    ],
  }),
  e({
    id: 'email', nome: 'E-mails automáticos (SolarDoc)', area: 'solardoc', canal: 'email', linha: null,
    resumo: 'Checkout, CNPJ, cobrança e winback por e-mail',
    papel: 'Recuperação de checkout, follow-up de CNPJ, lembrete de inativo, cobrança (dunning D0 a D4) e winback D+7 e D+30. Sem chave: é e-mail e roda no cron mestre.',
    regra: { tipo: 'sempre' }, fonte: 'services/followupService.ts',
    robos: [],
  }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO — o selo de cada cartão, calculado só da regra da chave.
// ─────────────────────────────────────────────────────────────────────────────

/** O que a Central leu do banco (system_state). `null` = não conseguiu ler. */
export interface ChavesDoBanco {
  /** `recepcao_io:ativa` → `value.ativa === true`. */
  recepcaoAtiva: boolean | null;
  /** `inv_agente_off` → desligada. `null` = erro de leitura (o robô trata como desligado). */
  helenaOff: boolean | null;
  /** `inv_agente_disjuntor` aberto (2 erros de envio seguidos, ou 3 pedidos de parada). */
  helenaDisjuntor?: boolean | null;
  /** `ag5040_interruptores`: o que está true/false. `null` = erro de leitura; ausente = não lida (vale desligado). */
  interruptores?: Partial<Record<'ensaio' | 'replay' | 'ficha' | 'sentinela', boolean>> | null;
}

export interface EstadoCalculado {
  selo: Selo;
  /** Por que não está ligado, ou de onde a chave foi lida. Sem valor de variável. */
  motivo?: string;
  /** Nome da chave que decide (só o nome). Ausente = sempre ligado. */
  chave?: string;
}

function textoDaEnv(env: NodeJS.ProcessEnv, nome: string, trim: boolean, minusculas: boolean): string {
  let v = env[nome] ?? '';
  if (trim) v = v.trim();
  if (minusculas) v = v.toLowerCase();
  return v;
}

/** Nome da chave que decide o estado, para a tela. `undefined` = sempre ligado. */
export function chaveDaRegra(regra: RegraDaChave): string | undefined {
  switch (regra.tipo) {
    case 'sempre': return undefined;
    case 'desliga': return [regra.env, ...(regra.tambem ?? []).map(t => t.env)].join(' ou ');
    case 'liga': return regra.env;
    case 'interruptor': return `AGENTES5040_${regra.nome.toUpperCase()} ou ag5040_interruptores`;
    case 'banco_recepcao': return 'recepcao_io:ativa';
    case 'banco_helena': return 'inv_agente_off';
  }
}

/**
 * O selo do cartão. Espelha o `desligado()` ou `ligada()` do serviço do robô.
 *
 * - `desliga`: ligado, salvo se a variável for EXATAMENTE `valor`.
 * - `liga`: desligado, salvo se a variável for EXATAMENTE `valor`.
 * - Duda: o freio de mão vence; sem ele, só liga se o banco disser `ativa: true`.
 *   Sem conseguir ler o banco, o robô fica desligado, e a tela diz o mesmo.
 * - Helena: PAUSADA por qualquer uma das duas chaves (a do banco, que volta com
 *   `?ligar=1` do cron, ou o freio de mão da Vercel), porque é assim que o dono
 *   chama a parada dela (13/10/2026). Só está ligada sem as duas.
 */
export function estadoDaRegra(regra: RegraDaChave, env: NodeJS.ProcessEnv, banco: ChavesDoBanco): EstadoCalculado {
  const chave = chaveDaRegra(regra);
  switch (regra.tipo) {
    case 'sempre':
      return { selo: 'ligado' };
    case 'desliga': {
      const armada = (c: ChaveDeEnv) => textoDaEnv(env, c.env, !!c.trim, !!c.minusculas) === c.valor;
      const parou = [regra, ...(regra.tambem ?? [])].find(armada);
      if (parou) return { selo: 'desligado', chave, motivo: `${parou.env} está armada na Vercel` };
      if (regra.parcial && armada(regra.parcial)) return { selo: 'pausado', chave, motivo: regra.parcial.motivo };
      return { selo: 'ligado', chave };
    }
    case 'liga': {
      const on = textoDaEnv(env, regra.env, !!regra.trim, !!regra.minusculas) === regra.valor;
      if (!on) return { selo: 'desligado', chave, motivo: `Opt-in: só roda com ${regra.env} ligada na Vercel` };
      const falta = (regra.exige ?? []).filter(n => !(env[n] ?? '').trim());
      if (falta.length) return { selo: 'desligado', chave, motivo: `Falta preencher na Vercel: ${falta.join(', ')}` };
      return { selo: 'ligado', chave };
    }
    case 'interruptor': {
      const nomeEnv = `AGENTES5040_${regra.nome.toUpperCase()}`;
      const porEnv = (env[nomeEnv] ?? '').trim();
      if (porEnv === '0') return { selo: 'desligado', chave, motivo: `${nomeEnv}=0 desliga na Vercel` };
      if (porEnv === '1') return { selo: 'ligado', chave };
      if (banco.interruptores?.[regra.nome] === true) return { selo: 'ligado', chave };
      return {
        selo: 'desligado', chave,
        motivo: banco.interruptores === null
          ? 'Não consegui ler a chave no banco: a peça fica desligada nesse caso'
          : `Nasce desligada: liga com ${nomeEnv}=1 ou pela chave ag5040_interruptores no banco`,
      };
    }
    case 'banco_recepcao': {
      if ((env.RECEPCAO_IO_OFF ?? '').trim() === '1') {
        return { selo: 'desligado', chave, motivo: 'RECEPCAO_IO_OFF está armada na Vercel' };
      }
      if (banco.recepcaoAtiva === true) return { selo: 'ligado', chave };
      return {
        selo: 'desligado', chave,
        motivo: banco.recepcaoAtiva === null
          ? 'Não consegui ler a chave no banco: o robô fica desligado nesse caso'
          : 'A chave recepcao_io:ativa no banco não está ligada',
      };
    }
    case 'banco_helena': {
      if ((env.INVESTIDOR_AGENTE_OFF ?? '').trim() === '1') {
        return { selo: 'pausado', chave, motivo: 'Pausada: INVESTIDOR_AGENTE_OFF está armada na Vercel' };
      }
      if (banco.helenaOff === true) {
        return { selo: 'pausado', chave, motivo: 'Pausada pela chave inv_agente_off no banco. Volta com a rota de ligar do cron, sem deploy' };
      }
      if (banco.helenaDisjuntor === true) {
        return { selo: 'pausado', chave, motivo: 'Disjuntor armado (erros de envio seguidos): as aberturas pararam até alguém religar' };
      }
      if (banco.helenaOff === null) {
        return { selo: 'pausado', chave, motivo: 'Não consegui ler a chave no banco: o robô trata como desligado nesse caso' };
      }
      return { selo: 'ligado', chave };
    }
  }
}
