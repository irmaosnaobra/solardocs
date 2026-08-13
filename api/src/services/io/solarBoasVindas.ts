// ─────────────────────────────────────────────────────────────────────────────
// BOAS-VINDAS DO SOLAR — o cliente cadastrou, o cliente recebe.
//
// O buraco que isto tapa: hoje quem preenche a LP de energia solar, o formulário
// do /simular ou o Lead Ads do Meta NÃO recebe nada. Só a equipe é avisada
// (ioSolar.ts → card no WhatsApp do Thiago, do Diego e da Nilce). O lead sai da
// página achando que alguém vai falar com ele e fica no escuro até o consultor
// ligar — se ligar. Quem paga anúncio pra gerar esse lead paga de novo pra
// reconquistar o silêncio.
//
// UM toque só, na hora do cadastro. E o que ele faz é o que o dono pediu:
//   • diz QUEM é o consultor dele e passa o WhatsApp desse consultor;
//   • diz que *nós* entramos em contato — a bola nunca fica com o cliente;
//   • abre a porta na hora: "pode escrever aqui agora, estamos aguardando";
//   • pede UMA coisa só: o consumo atual. É o único dado que o estudo não
//     consegue estimar sozinho — e uma pergunta é o que faz voltar resposta.
//     Questionário no primeiro contato não vira conversa, vira formulário.
//
// ── O que ele NÃO faz (de propósito) ──
//   • NÃO fala de horário. Nem dia, nem hora, nem "reunião", nem "vistoria" —
//     mesmo quando a ficha tem um slot (todas as origens de solar gravam um).
//     Decisão do dono: a promessa é "a gente entra em contato", não um encontro
//     marcado que o cliente esqueceu que escolheu. Quem precisa do horário é o
//     consultor, e ele já tem no card e no CRM.
//   • NÃO responde. Se o cliente escrever, quem lê é gente — o solarRespostas.ts
//     leva o recado pro consultor dono da ficha. Robô nenhum conversa nesta linha.
//   • NÃO promete prazo ("em 10 minutos", "ainda hoje"). Prazo que a equipe não
//     cumpre é pior que nenhum prazo.
//
// ── Travas (a linha IO foi bloqueada em 01–03/ago; ela não aguenta rajada) ──
//   • JANELA DE IDADE: só ficha criada nas últimas 24 horas (era 6h até 13/08 —
//     ver JANELA_MS pra medição). Quem cadastrou anteontem não recebe recibo de
//     cadastro, e ligar o kill-switch NÃO dispara pro backlog inteiro de uma vez.
//   • PISO DE DATA: nada anterior a SOLAR_BOASVINDAS_INICIO, nem a
//     SOLAR_ENTREGA_AMPLA_INICIO — este último é a garantia de "daqui pra frente"
//     pedida pelo dono quando a janela e o filtro de status foram afrouxados.
//   • TETO POR RODADA: o sync do Meta insere várias fichas de uma vez; o tick é
//     de 5 min e a fila drena sozinha em vez de estourar na linha.
//   • A flag só é gravada DEPOIS de o envio dar certo → falha vira retry, não
//     buraco. E a flag é uma coluna PRÓPRIA (boas_vindas_at), não a de
//     confirmação do eletroposto — ver MIGRATION_solar_boas_vindas.sql.
//
// Supressão (PARAR) não é consultada, mesma regra do eletroposto: quem acabou de
// preencher um formulário pedindo contato deu um sinal novo, que vale mais que um
// opt-out antigo. Isto é o recibo do cadastro DELE, não abordagem fria. Pelo mesmo
// motivo não há janela de horário: quem cadastra às 23h está esperando resposta.
//
// Kill-switch: SOLAR_BOASVINDAS_OFF=1 (desliga este toque E o solarRespostas).
// Nasceu como opt-in (SOLAR_BOASVINDAS_ON) justamente pra copy nenhuma sair antes
// de o dono ler; aprovada em 04/08, virou switch de desligar — mesma convenção
// dos agentes que já estão no ar (EP_LEMBRETES_OFF, EP_RESPOSTAS_OFF).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { telefoneBonito } from './eletropostoAgenda';

/** Marcador de envio efetivado. É por ele que o teto anti-ban da linha enxerga
 *  este agente — sem isto ele fura o teto em silêncio (ver lineThrottle.ts). */
export const SOLAR_BV_PREFIX = 'solar_boasvindas_sent:';

/** As origens que caem na tabela `agendamentos` como ENERGIA SOLAR.
 *  Mesmo agrupamento do "Leads por Origem" do /admin (admin.ts:200).
 *  `indicacao` fica FORA: indicado não se cadastrou, foi cadastrado por outra
 *  pessoa — recibo de cadastro pra quem não preencheu nada é abordagem fria. */
export const SOLAR_ORIGENS = ['lead-meta', 'leads-meta', 'lp_solar', 'manychat'];

/** Dia em que este agente entrou no ar. Ficha anterior a isto nunca recebe:
 *  é o que impede o backlog de virar rajada no dia em que o switch for ligado. */
export const SOLAR_BOASVINDAS_INICIO = '2026-08-04T00:00:00.000Z';

/**
 * Ficha "nova" o bastante pra receber o recibo do cadastro.
 *
 * Era 1 hora, e 1 hora estava ERRADO. Medido em 04/08 sobre 20 rodadas seguidas:
 * o workflow `process-messages.yml` pede pra rodar a cada 5 minutos, mas o
 * GitHub Actions dispara de **70 a 216 minutos** (mediana ~2h) — ele descarta a
 * maioria das execuções agendadas. Com janela de 1h, o cadastro envelhecia ANTES
 * de qualquer tick olhar pra ele: a pessoa não recebia nada e nada aparecia no
 * log, porque ficha fora da janela nem é lida.
 *
 * 6 horas cobre o pior gap medido (3h36) com folga de 2×. A copy aguenta a
 * defasagem porque nunca diz "agora": "seu cadastro chegou pra mim" continua
 * verdade 4 horas depois. O que segura o volume não é esta janela — é o teto
 * por rodada + a flag no banco.
 */
// [13/08/2026] 6h → 24h. Medição de 30 dias: das 99 fichas do Meta, 12 receberam.
// A janela era o SEGUNDO furo (o primeiro é o status, ver STATUS_QUE_NAO_RECEBEM),
// mas era furo: o tempo médio até o envio nas que deram certo é de 59 minutos —
// o teto da linha é de 6/h COMPARTILHADO, então ficha que cai numa hora cheia
// espera horas, e com 6h de janela algumas caíam da beirada.
//
// 24h é o limite do que a copy aguenta: ela não diz "agora", mas chamar de
// "pré-atendimento" dois dias depois, com o consultor já tendo ligado, é pior que
// não mandar. Como a fila é varrida a cada 5 min, a janela larga JÁ É o retry —
// quem o teto barrou volta a ser candidato no tick seguinte, por 24 horas.
const JANELA_MS = 24 * 60 * 60 * 1000;
const MAX_POR_TICK = 5;

/**
 * PISO DE "DAQUI PRA FRENTE" (ordem do dono, 13/08/2026: "vamos fazer daqui pra
 * frente"). Alargar a janela e afrouxar o status faria 87 pessoas que se
 * cadastraram em julho receberem hoje um "seu pré-atendimento" — gente que já foi
 * atendida, já disse não, ou já esqueceu que preencheu. Este piso é a garantia de
 * que a mudança só vale pra quem entrar a partir dela.
 *
 * NÃO REMOVER pra "recuperar o histórico": recuperar backlog é outra decisão, com
 * outra copy ("faz um tempo que você se cadastrou..."), e precisa do dono.
 */
export const SOLAR_ENTREGA_AMPLA_INICIO = '2026-08-13T22:00:00.000Z';

/**
 * Quem NÃO recebe o recibo do cadastro.
 *
 * O filtro era `status = 'agendado'`, e essa é a causa nº 1 de 87 pessoas não
 * terem recebido nada em 30 dias: a ficha sai de "agendado" em MINUTOS (a triagem
 * é rápida) e some da fila pra sempre. Das 99 do Meta, 71 já não eram elegíveis
 * quando o tick olhou — 40 delas em `sem_interesse`.
 *
 * Invertido: em vez de listar quem pode, lista quem não pode.
 *   · cancelado / sem_interesse — a pessoa disse não. Recibo aqui é insistência.
 *   · fez_orcamento — já recebeu proposta. "Antes de te chamar, a gente monta o
 *     estudo" viraria mentira na cara de quem já viu o estudo.
 * O resto (agendado, em_atendimento, nao_atendeu) RECEBE: são justamente os casos
 * em que a conversa ainda não aconteceu — e `nao_atendeu` é literalmente quem o
 * consultor tentou ligar e não alcançou.
 */
const STATUS_QUE_NAO_RECEBEM = ['cancelado', 'sem_interesse', 'fez_orcamento'];

/** Bolha maior que o padrão (160) de propósito: sem isso as frases longas se
 *  quebram no meio, viram 8+ mensagens seguidas, e o teto de 5 do `emBolhas`
 *  reagrupa tudo de volta em parede de texto. */
const BOLHA_MAX = 260;
const BOLHA_TETO = 7;

export const desligado = () => (process.env.SOLAR_BOASVINDAS_OFF || '').trim() === '1';

/** Segunda rede, em memória: ficha que JÁ recebeu nesta instância não recebe de
 *  novo nem se a gravação da flag falhar. A primeira rede é a coluna no banco —
 *  esta cobre a janela entre o envio dar certo e o banco confirmar. Serverless
 *  recicla o processo, então isto não substitui a coluna: só encurta o estrago. */
const jaTocadas = new Set<number>();

/**
 * Grava a flag e CONFERE o resultado. O supabase-js não lança em falha de
 * escrita — devolve `{ error }`. Engolir esse error é o que transformaria uma
 * falha de rede em rajada: a ficha continuaria sem flag, continuaria dentro da
 * janela de 1 hora, e receberia as 6 bolhas de novo a cada 5 min — até 12 vezes,
 * na mesma linha que foi bloqueada em 01–03/ago.
 */
async function marcarTocada(id: number): Promise<void> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { error } = await supabaseGerador
      .from('agendamentos')
      .update({ boas_vindas_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) return;
    if (tentativa === 2) throw new Error(`gravar boas_vindas_at falhou: ${error.message ?? error}`);
  }
}

function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p.length >= 2 && p.length <= 20 && p.toLowerCase() !== 'lead' ? p : '';
}
const comNome = (n: string) => (n ? `, ${n}` : '');

// ── A MENSAGEM ──────────────────────────────────────────────────────────────
// Nada aqui diz "agora há pouco" com hora, nem cita dia/horário: a mesma copy
// serve pra ficha de 40 segundos e pra ficha de 50 minutos.
export function bolhasBoasVindas(
  nome: string | null | undefined,
  vendedor: string | null | undefined,
  telVendedor?: string | null,
): string[] {
  const n = primeiroNome(nome);
  const quem = String(vendedor || '').trim();
  const tel = telefoneBonito(telVendedor);

  // Sem artigo antes do nome ("é *Nilce*", não "é o *Nilce*") e sem "ele/dela":
  // o rodízio é Thiago→Diego→Nilce e a frase tem que servir pros três sem errar
  // o gênero de ninguém. Ficha sem consultor cai numa frase inteira diferente —
  // encaixar "um consultor nosso" no lugar do nome produzia "é o *um consultor*".
  // "Especialista" também é epiceno, e é justamente a palavra que o dono quer
  // aqui: o lead precisa entender que quem vai atender entende do assunto. Cargo
  // com gênero ("consultor especializado") erraria com a Nilce, que hoje recebe a
  // maior parte do volume.
  // A promessa "nós entramos em contato com você" fica, e fica INTEIRA: é
  // compromisso com o cliente (ele não precisa correr atrás), não enfeite de copy.
  const apresentacao = quem
    ? `Seu projeto fica com *${quem}*, especialista em energia solar — atendimento com gente, do estudo à instalação. *Nós entramos em contato com você*.`
    : 'Seu projeto já está com um dos nossos especialistas em energia solar — atendimento com gente, do estudo à instalação. *Nós entramos em contato com você*.';

  // Sem telefone cadastrado o contato NÃO some — a promessa do dono é "sempre
  // passar nosso contato". O que muda é qual contato: cai na própria linha, que
  // é onde esta mensagem já está e onde alguém lê de verdade.
  const contato = tel
    ? `O WhatsApp direto é *${tel}* — salva esse contato, é desse número que a conversa continua.`
    : 'E salva este número aqui — é a nossa central, dá pra falar com a gente por aqui a hora que precisar.';

  return [
    // "Pré-atendimento" na PRIMEIRA frase é o pedido do dono e responde uma dúvida
    // real de quem acabou de se cadastrar: não sei se estou falando com quem vai
    // me atender. Dizer isso na abertura ainda compra o resto da mensagem — a
    // pergunta do consumo deixa de parecer interrogatório e vira preparação.
    `Oi${comNome(n)}! Aqui é da *Irmãos na Obra*. Este é o seu pré-atendimento: eu organizo o seu caso pra quem vai te atender já chegar preparado.`,
    apresentacao,
    contato,
    // O que o pré-atendimento entrega, em coisa concreta. Sem número inventado
    // (anos de mercado, projetos entregues): promessa que a empresa não pode
    // provar na conversa seguinte queima o consultor que atende depois.
    'Antes de te chamar, a gente monta o estudo do seu caso — consumo, telhado e retorno. Você recebe projeto calculado, não estimativa de tabela.',
    // UMA pergunta só (decisão do dono). Formulário no WhatsApp não é
    // conversa: cada pergunta a mais derruba a chance de vir qualquer resposta,
    // e o consumo é a única que o estudo não consegue estimar sozinho. O resto
    // ("por que ainda não tem", "o que fez procurar") o consultor pergunta na
    // conversa, que é onde essas duas rendem de verdade.
    'Pra isso preciso de uma coisa só: qual o seu consumo hoje? Manda o valor da conta de luz ou uma foto dela — texto, áudio ou foto, como for mais fácil.',
  ];
}

interface Ficha {
  id: number;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  created_at: string;
  created_by: string | null;
  status: string | null;
  boas_vindas_at: string | null;
}

export type PreviaBoasVindas = {
  id: number;
  cliente: string;
  origem: string;
  consultor: string;
  bolhas: string[];
};

export type ResultadoBoasVindas = {
  enviadas: number;
  /** Cadastros que envelheceram além da janela sem receber — falha, não decisão. */
  perdidos: number;
  erros: number;
  motivo?: string;
  previa?: PreviaBoasVindas[];
};

const zero = (motivo?: string): ResultadoBoasVindas =>
  ({ enviadas: 0, perdidos: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/** nome do consultor → WhatsApp dele, direto do cadastro do CRM (não lista fixa:
 *  número trocado no cadastro tem que valer na mensagem seguinte). */
async function carregarConsultores(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const { data, error } = await supabaseGerador.from('consultores').select('nome, whatsapp').limit(100);
    if (error) throw error;
    for (const c of data ?? []) {
      if (c?.nome && c?.whatsapp) mapa.set(String(c.nome), String(c.whatsapp));
    }
  } catch (err) {
    logger.error('solar-boas-vindas', 'ler consultores falhou — a mensagem sai com o contato da central', err);
  }
  return mapa;
}

/**
 * Roda a cada ~5 min dentro do /cron/process-messages.
 * `dry` roda a decisão inteira e devolve o que SAIRIA, sem enviar e sem gravar
 * flag — é assim que se confere a copy contra ficha real antes de ligar.
 */
export async function runSolarBoasVindasTick(opts: { dry?: boolean } = {}): Promise<ResultadoBoasVindas> {
  // No dry a checagem do switch é pulada: a conferência da copy tem que funcionar
  // mesmo com o agente desligado — é como se revisa o texto sem tocar em ninguém.
  if (!opts.dry && desligado()) return zero('desligado');

  const agora = Date.now();
  const janela = new Date(agora - JANELA_MS).toISOString();
  // O piso é o MAIOR dos três: a janela móvel, o dia em que o agente nasceu e o
  // piso de "daqui pra frente". O último é o que impede a janela de 24h de acordar
  // o backlog de julho no primeiro tick depois do deploy.
  const piso = [janela, SOLAR_BOASVINDAS_INICIO, SOLAR_ENTREGA_AMPLA_INICIO].sort().pop()!;

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, cliente_nome, cliente_telefone, created_at, created_by, status, boas_vindas_at')
    .in('created_by', SOLAR_ORIGENS)
    .not('status', 'in', `(${STATUS_QUE_NAO_RECEBEM.join(',')})`)
    .is('boas_vindas_at', null)
    .gte('created_at', piso)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    logger.error('solar-boas-vindas', 'ler agendamentos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }
  if (!data?.length) return zero('nenhum_cadastro_novo');

  const telPorConsultor = await carregarConsultores();

  let enviadas = 0, erros = 0, candidatos = 0;
  const previa: PreviaBoasVindas[] = [];

  for (const ficha of data as Ficha[]) {
    const tel = String(ficha.cliente_telefone || '').replace(/\D/g, '');
    if (!tel) continue;

    // Refeito em JS de propósito: se o filtro da consulta mudar (ou o cliente
    // devolver a mais), uma ficha velha viraria "recebi seu cadastro agora"
    // dias depois — e uma já tocada viraria mensagem repetida.
    if (ficha.boas_vindas_at) continue;
    if (String(ficha.created_at) < piso) continue;
    if (STATUS_QUE_NAO_RECEBEM.includes(String(ficha.status || ''))) continue;
    if (jaTocadas.has(ficha.id)) continue;

    candidatos++;
    if (enviadas >= MAX_POR_TICK) continue;   // conta o que sobrou pro log de corte

    // Teto anti-ban da linha, compartilhado com a Bia, o followup e o resto.
    // Este agente ficava FORA dele ("é transacional") — mesma decisão que, no
    // agente do eletroposto, bloqueou o 5040 pela 2ª vez em 04/08. Uma pessoa
    // aqui custa 6 mensagens; estourar o teto é barato e sai caro.
    if (!opts.dry && !(await dentroDoTetoHorarioLinha({ transacional: true })  /* boas-vindas de quem acabou de se cadastrar */)) {
      logger.info('solar-boas-vindas', 'teto da linha estourado — fica pro próximo tick', { esperando: candidatos - enviadas });
      break;
    }

    const telDoConsultor = telPorConsultor.get(String(ficha.vendedor_nome || '')) ?? null;
    const bolhas = bolhasBoasVindas(ficha.cliente_nome, ficha.vendedor_nome, telDoConsultor);

    if (opts.dry) {
      previa.push({
        id: ficha.id,
        cliente: String(ficha.cliente_nome || '—'),
        origem: String(ficha.created_by || '—'),
        consultor: String(ficha.vendedor_nome || '—'),
        bolhas,
      });
      enviadas++;
      continue;
    }

    try {
      await sendHuman(tel, bolhas, 'io', { max: BOLHA_MAX, maxBolhas: BOLHA_TETO });
    } catch (e) {
      // Envio falhou: a ficha fica sem flag de propósito, o próximo tick tenta
      // de novo enquanto ela estiver dentro da janela. Falha vira retry, não buraco.
      logger.error('solar-boas-vindas', 'falha ao enviar as boas-vindas', { id: ficha.id, erro: String(e) });
      erros++;
      continue;
    }

    // A mensagem JÁ saiu daqui pra baixo — a partir deste ponto o risco deixa de
    // ser "o cliente não recebeu" e passa a ser "o cliente recebe de novo".
    jaTocadas.add(ficha.id);
    if (jaTocadas.size > 500) jaTocadas.clear();
    enviadas++;

    // Carimbo pro teto da linha. Vai ANTES da flag da ficha e sem try/catch de
    // parada: se este marcador falhar, o agente segue — mas o teto passa a
    // subestimar a hora, então o erro é logado alto.
    const nowIso = new Date().toISOString();
    await supabase.from('system_state')
      .upsert({ key: `${SOLAR_BV_PREFIX}${ficha.id}`, value: { em: nowIso }, updated_at: nowIso }, { onConflict: 'key' })
      .then(undefined, (e: unknown) =>
        logger.error('solar-boas-vindas', 'carimbo do teto da linha falhou', { id: ficha.id, erro: String(e) }));
    try {
      await marcarTocada(ficha.id);
    } catch (e) {
      // Grave: entregue mas não marcado. Só a rede em memória segura a repetição,
      // e ela morre com o processo. Alto e claro no log pra alguém marcar na mão.
      logger.error('solar-boas-vindas', 'ENTREGUE MAS NÃO MARCADO — risco de repetir',
        { id: ficha.id, erro: String(e) });
      erros++;
    }
  }

  if (!opts.dry && candidatos > enviadas) {
    // Corte explícito: sem este log, "5 enviadas" pareceria cobertura completa
    // num lote em que 7 pessoas ficaram pra próxima rodada (ou pro esquecimento,
    // se envelhecerem além da janela antes dela chegar).
    logger.info('solar-boas-vindas',
      `${candidatos - enviadas} cadastro(s) ficaram pra próxima rodada (teto de ${MAX_POR_TICK})`);
  }
  if (enviadas > 0 && !opts.dry) {
    logger.info('solar-boas-vindas', `${enviadas} cadastro(s) de solar receberam as boas-vindas`, { erros });
  }
  const perdidos = await contarPerdidos(piso);
  return { enviadas, perdidos, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}

/**
 * Quem envelheceu ALÉM da janela sem receber nada — e não por decisão (status),
 * mas por falha de entrega.
 *
 * Existe porque foi assim que 87 pessoas passaram em branco por 30 dias: nada no
 * log dizia "não entreguei", só "entreguei 1". Silêncio parecia sucesso. Agora
 * cada rodada devolve o número, e ele aparece na Central das Agentes.
 *
 * Conta só a partir do piso de "daqui pra frente": o backlog de julho não é
 * perda deste agente, é decisão do dono.
 */
async function contarPerdidos(pisoDaJanela: string): Promise<number> {
  try {
    const { data, error } = await supabaseGerador
      .from('agendamentos').select('id')
      .in('created_by', SOLAR_ORIGENS)
      .not('status', 'in', `(${STATUS_QUE_NAO_RECEBEM.join(',')})`)
      .is('boas_vindas_at', null)
      .gte('created_at', SOLAR_ENTREGA_AMPLA_INICIO)
      .lt('created_at', pisoDaJanela)
      .limit(200);
    if (error) throw error;
    const n = (data ?? []).length;
    if (n > 0) {
      logger.error('solar-boas-vindas',
        `${n} cadastro(s) passaram da janela de ${JANELA_MS / 3600_000}h SEM receber as boas-vindas`);
    }
    return n;
  } catch (err) {
    logger.error('solar-boas-vindas', 'contar perdidos falhou', err);
    return 0;
  }
}
