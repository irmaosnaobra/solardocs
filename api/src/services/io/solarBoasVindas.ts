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
//   • JANELA DE IDADE: só ficha criada na última hora. Quem cadastrou ontem não
//     recebe "recebi seu cadastro agora" — e, mais importante, ligar o
//     kill-switch NÃO dispara pro backlog inteiro de uma vez.
//   • PISO DE DATA: nada anterior a SOLAR_BOASVINDAS_INICIO, aconteça o que
//     acontecer com a janela.
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
// Opt-in explícito: SOLAR_BOASVINDAS_ON=true. Sem isso o tick é no-op — mensagem
// pro cliente não começa a sair só porque um deploy subiu.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman } from '../agents/zapiClient';
import { telefoneBonito } from './eletropostoAgenda';

/** As origens que caem na tabela `agendamentos` como ENERGIA SOLAR.
 *  Mesmo agrupamento do "Leads por Origem" do /admin (admin.ts:200).
 *  `indicacao` fica FORA: indicado não se cadastrou, foi cadastrado por outra
 *  pessoa — recibo de cadastro pra quem não preencheu nada é abordagem fria. */
export const SOLAR_ORIGENS = ['lead-meta', 'leads-meta', 'lp_solar', 'manychat'];

/** Dia em que este agente entrou no ar. Ficha anterior a isto nunca recebe:
 *  é o que impede o backlog de virar rajada no dia em que o switch for ligado. */
export const SOLAR_BOASVINDAS_INICIO = '2026-08-04T00:00:00.000Z';

/** Ficha "nova": o cadastro acabou de acontecer e a pessoa ainda está com a
 *  página aberta na cabeça. Uma hora cobre atraso de cron e do sync do Meta. */
const JANELA_MS = 60 * 60 * 1000;
const MAX_POR_TICK = 5;

/** Bolha maior que o padrão (160) de propósito: sem isso as frases longas se
 *  quebram no meio, viram 8+ mensagens seguidas, e o teto de 5 do `emBolhas`
 *  reagrupa tudo de volta em parede de texto. */
const BOLHA_MAX = 260;
const BOLHA_TETO = 7;

const ligado = () => (process.env.SOLAR_BOASVINDAS_ON || '').trim().toLowerCase() === 'true';

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
  const apresentacao = quem
    ? `Quem vai cuidar do seu projeto aqui é *${quem}* — e *nós entramos em contato com você*, não precisa fazer nada, é só deixar o WhatsApp por perto.`
    : 'Seu projeto já está com um consultor nosso — e *nós entramos em contato com você*, não precisa fazer nada, é só deixar o WhatsApp por perto.';

  // Sem telefone cadastrado o contato NÃO some — a promessa do dono é "sempre
  // passar nosso contato". O que muda é qual contato: cai na própria linha, que
  // é onde esta mensagem já está e onde alguém lê de verdade.
  const contato = tel
    ? `O WhatsApp direto é *${tel}* — salva esse contato, é desse número que a gente fala com você.`
    : 'E salva este número aqui, ó — é a nossa central, dá pra falar com a gente por aqui a hora que precisar.';

  return [
    `Oi${comNome(n)}! Aqui é da *Irmãos na Obra* — seu cadastro de energia solar chegou pra mim. ☀️`,
    apresentacao,
    contato,
    'E você não precisa esperar a gente: se quiser, já me escreve aqui agora. Estamos prontos, te aguardando. 👊',
    // UMA pergunta só (decisão do dono). Formulário no WhatsApp não é
    // conversa: cada pergunta a mais derruba a chance de vir qualquer resposta,
    // e o consumo é a única que o estudo não consegue estimar sozinho. O resto
    // ("por que ainda não tem", "o que fez procurar") o consultor pergunta na
    // conversa, que é onde essas duas rendem de verdade.
    'Pra eu já adiantar o seu estudo, me conta uma coisa só: qual o seu consumo atual? ⚡',
    'Pode mandar o valor da sua conta de luz, ou uma foto dela — por texto, áudio ou foto, do jeito que for mais fácil. Com esse número na mão a gente já chega falando de conta, não de pergunta.',
  ];
}

interface Ficha {
  id: number;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  created_at: string;
  created_by: string | null;
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
  erros: number;
  motivo?: string;
  previa?: PreviaBoasVindas[];
};

const zero = (motivo?: string): ResultadoBoasVindas => ({ enviadas: 0, erros: 0, ...(motivo ? { motivo } : {}) });

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
  // No dry a checagem do switch é pulada: a conferência tem que funcionar com o
  // agente ainda desligado, senão não dá pra aprovar a copy antes de ligar.
  if (!opts.dry && !ligado()) return zero('desligado');

  const agora = Date.now();
  const janela = new Date(agora - JANELA_MS).toISOString();
  const piso = janela > SOLAR_BOASVINDAS_INICIO ? janela : SOLAR_BOASVINDAS_INICIO;

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, cliente_nome, cliente_telefone, created_at, created_by, boas_vindas_at')
    .in('created_by', SOLAR_ORIGENS)
    .eq('status', 'agendado')          // cancelado/sem_interesse não recebe nada
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
    if (jaTocadas.has(ficha.id)) continue;

    candidatos++;
    if (enviadas >= MAX_POR_TICK) continue;   // conta o que sobrou pro log de corte

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
  return { enviadas, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}
