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
 *   · perdido / fechou / fechou_concorrente: a conversa já terminou, pra um lado ou
 *     pro outro. "Este é o seu pré-atendimento" pra quem já fechou, com a gente ou
 *     com outro, é mensagem fora de hora. Entraram em 14/09/2026, quando a ficha
 *     995, marcada como perdido, voltou a contar no alarme de perdidos.
 * O resto (agendado, em_atendimento, nao_atendeu) RECEBE: são justamente os casos
 * em que a conversa ainda não aconteceu — e `nao_atendeu` é literalmente quem o
 * consultor tentou ligar e não alcançou.
 */
const STATUS_QUE_NAO_RECEBEM = ['cancelado', 'sem_interesse', 'fez_orcamento', 'perdido', 'fechou', 'fechou_concorrente'];

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
 * Reserva a ficha gravando boas_vindas_at SÓ se ainda estiver vazia, e diz se foi
 * esta chamada que gravou. É a escrita condicional que impede duas rodadas
 * simultâneas de mandar as mesmas bolhas pra mesma pessoa. O supabase-js não lança
 * em falha de escrita, devolve `{ error }`, então o error é conferido: reserva que
 * não se confirma não envia.
 */
async function reservarFicha(id: number, em: string): Promise<boolean> {
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .update({ boas_vindas_at: em })
    .eq('id', id)
    .is('boas_vindas_at', null)
    .select('id');
  if (error) throw new Error(`reservar boas_vindas_at falhou: ${error.message ?? error}`);
  return (data?.length ?? 0) > 0;
}

/** Envio falhou: tira a reserva, mas só a DESTA rodada (confere o carimbo dela).
 *  Uma retentativa: sem ela, um soluço do banco na devolução deixava a ficha marcada
 *  como recebida sem ninguém ter recebido nada. */
async function devolverFicha(id: number, reservadaEm: string): Promise<void> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { error } = await supabaseGerador
      .from('agendamentos')
      .update({ boas_vindas_at: null })
      .eq('id', id)
      .eq('boas_vindas_at', reservadaEm);
    if (!error) return;
    if (tentativa === 2) {
      // A pessoa NÃO recebeu e a ficha ficou marcada. A varredura de reservas sem
      // envio (conferirReservasSemEnvio) é quem acusa na rodada seguinte.
      logger.error('solar-boas-vindas', 'ENVIO FALHOU E A FICHA FICOU MARCADA, desmarcar na mão',
        { id, erro: error.message ?? String(error) });
    }
  }
}

/** Marcador de "não mandei porque este telefone já recebeu". Fica fora dos prefixos
 *  do teto da linha (nada saiu) e é o que a varredura usa pra não confundir com
 *  envio interrompido. */
export const SOLAR_BV_DEDUP_PREFIX = 'solar_bv_dedup:';
/** Mesma pessoa que já recebeu nestes dias não recebe de novo por ficha nova. */
const DEDUP_TELEFONE_DIAS = 30;

/**
 * Este telefone já recebeu as boas-vindas por OUTRA ficha de solar nos últimos 30
 * dias? A reserva é por ficha, e o intake cria ficha nova pro mesmo número: um
 * telefone levou 5 boas-vindas completas entre 25/08 e 14/09/2026, e outro levou 3
 * em 16 minutos. telefone_norm já é DDD + 8 últimos dígitos (a mesma chave do
 * solarRespostas), então o 55 na frente ou o nono dígito não escondem a repetição.
 */
async function telefoneJaRecebeu(ficha: Ficha): Promise<boolean> {
  if (!ficha.telefone_norm) return false;
  const desde = new Date(Date.now() - DEDUP_TELEFONE_DIAS * 86_400_000).toISOString();
  const { data, error } = await supabaseGerador
    .from('agendamentos').select('id')
    .in('created_by', SOLAR_ORIGENS)
    .eq('telefone_norm', ficha.telefone_norm)
    .neq('id', ficha.id)
    .gte('boas_vindas_at', desde)
    .limit(1);
  if (error) throw new Error(`conferir telefone já atendido falhou: ${error.message ?? error}`);
  return (data?.length ?? 0) > 0;
}

/** Fecha a ficha repetida SEM mandar nada: flag condicional e marcador próprio. */
async function marcarSemEnviar(id: number): Promise<void> {
  const em = new Date().toISOString();
  const { error } = await supabaseGerador
    .from('agendamentos')
    .update({ boas_vindas_at: em })
    .eq('id', id)
    .is('boas_vindas_at', null)
    .select('id');
  if (error) {
    logger.error('solar-boas-vindas', 'marcar ficha de telefone repetido falhou', { id, erro: error.message ?? String(error) });
    return;
  }
  const { error: erroMarcador } = await supabase.from('system_state')
    .upsert({ key: `${SOLAR_BV_DEDUP_PREFIX}${id}`, value: { em }, updated_at: em }, { onConflict: 'key' });
  if (erroMarcador) logger.warn('solar-boas-vindas', 'marcador de telefone repetido falhou', { id, erro: erroMarcador.message });
  logger.info('solar-boas-vindas', 'telefone já recebeu as boas-vindas por outra ficha, não repete', { id });
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
  /** DDD + 8 últimos dígitos, a chave pra achar a mesma pessoa em outra ficha. */
  telefone_norm: string | null;
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
    .select('id, vendedor_nome, cliente_nome, cliente_telefone, telefone_norm, created_at, created_by, status, boas_vindas_at')
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
  // A contagem de perdidos vem ANTES da saída por "não tem ninguém novo" — e é aí
  // que ela mais importa. A rodada em que TODO mundo envelheceu além da janela é
  // exatamente a rodada sem candidato: sair antes de contar faria o agente relatar
  // "nada a fazer" no momento em que mais gente ficou no escuro. Foi esse tipo de
  // silêncio que deixou 87 pessoas passarem em branco por 30 dias.
  const perdidos = await contarPerdidos(piso, !!opts.dry);
  if (!opts.dry) await conferirReservasSemEnvio(janela);
  if (!data?.length) return { ...zero('nenhum_cadastro_novo'), perdidos };

  const telPorConsultor = await carregarConsultores();

  let enviadas = 0, erros = 0, candidatos = 0;
  const previa: PreviaBoasVindas[] = [];
  // Telefones já tratados NESTA rodada: o intake às vezes cria 2 ou 3 fichas do mesmo
  // número em minutos, e elas chegam juntas no mesmo lote.
  const telefonesDaRodada = new Set<string>();

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

    // MESMA PESSOA, FICHA NOVA: marca sem mandar (ver telefoneJaRecebeu). Vem ANTES do
    // teto da linha: fechar ficha repetida não manda nada, então não gasta a linha e
    // não pode ficar presa esperando ela abrir (a 1053 esperou 7 horas assim em 14/09).
    const chaveTel = ficha.telefone_norm || tel;
    if (!opts.dry) {
      let repetido = telefonesDaRodada.has(chaveTel);
      if (!repetido) {
        try {
          repetido = await telefoneJaRecebeu(ficha);
        } catch (e) {
          // Sem conseguir conferir, não manda: repetir as bolhas pra mesma pessoa custa
          // mais que esperar a próxima rodada.
          logger.error('solar-boas-vindas', 'conferir telefone já atendido falhou, não envia nesta rodada', { id: ficha.id, erro: String(e) });
          erros++;
          continue;
        }
      }
      if (repetido) {
        candidatos--;
        await marcarSemEnviar(ficha.id);
        continue;
      }
    }

    // Teto anti-ban da linha, compartilhado com a Bia, o followup e o resto.
    // Este agente ficava FORA dele ("é transacional") — mesma decisão que, no
    // agente do eletroposto, bloqueou o 5040 pela 2ª vez em 04/08. Uma pessoa
    // aqui custa 6 mensagens; estourar o teto é barato e sai caro.
    // PISO DO DIA de 200, o mesmo da agenda do eletroposto e da Giovanna, que também
    // são transacionais. Sem ele, em 14/09/2026 a agenda do eletroposto sozinha somou
    // 65 envios em 24h, o teto do dia vivia cheio e as boas-vindas não saíam: 1 envio
    // em 24h e lead novo esperando 6 horas. O teto por HORA continua valendo, e é ele
    // que segura rajada; o volume daqui é o de cadastros (3 em 30 horas).
    if (!opts.dry && !(await dentroDoTetoHorarioLinha({ transacional: true, pisoDia: 200 })  /* boas-vindas de quem acabou de se cadastrar */)) {
      logger.info('solar-boas-vindas', 'teto da linha estourado — fica pro próximo tick', { esperando: candidatos - enviadas });
      // Deixa RASTRO, uma vez por hora. O logger.info só vai pro console da Vercel,
      // que não guarda histórico: de 01 a 05/09/2026 as boas-vindas pararam 4 dias e
      // esperas de 11 a 16 horas se repetiram depois, sem nenhuma linha no error_logs
      // dizendo o porquê. Com isto, espera longa por teto fechado fica medível.
      const esperando = (data as Ficha[]).filter((f) => !f.boas_vindas_at && !jaTocadas.has(f.id));
      if (await mudou(AVISO_TETO_KEY, new Date(agora).toISOString().slice(0, 13))) {
        const maisAntiga = esperando.reduce(
          (m, f) => (String(f.created_at) < m ? String(f.created_at) : m), new Date(agora).toISOString());
        logger.warn('solar-boas-vindas', 'teto da linha segurou as boas-vindas', {
          esperando: esperando.length,
          ids: esperando.map((f) => f.id),
          horas_da_mais_antiga: Math.round((agora - Date.parse(maisAntiga)) / 360_000) / 10,
        });
      }
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

    // RESERVA antes de enviar. O tick roda no /process-messages e no /master, e o
    // /process-messages tem mais de um chamador. Com a flag gravada só DEPOIS do
    // envio, duas rodadas sobrepostas liam a mesma ficha vazia e as duas mandavam:
    // 8 fichas levaram as 5 bolhas duas vezes entre 15/08 e 14/09/2026. Agora a flag
    // só grava se ainda estiver vazia, e só manda a rodada que conseguiu gravar.
    const reservadaEm = new Date().toISOString();
    let ganhou = false;
    try {
      ganhou = await reservarFicha(ficha.id, reservadaEm);
    } catch (e) {
      // Sem conseguir reservar, não manda. A resposta pode ter se perdido com o UPDATE
      // já aplicado (504 do gateway): devolve pelo carimbo desta rodada, que só apaga
      // se foi mesmo esta rodada que gravou.
      await devolverFicha(ficha.id, reservadaEm);
      logger.error('solar-boas-vindas', 'reservar a ficha falhou, não envia nesta rodada', { id: ficha.id, erro: String(e) });
      erros++;
      continue;
    }
    if (!ganhou) continue;   // outra rodada já pegou esta ficha
    jaTocadas.add(ficha.id);
    if (jaTocadas.size > 500) jaTocadas.clear();

    try {
      await sendHuman(tel, bolhas, 'io', { max: BOLHA_MAX, maxBolhas: BOLHA_TETO });
    } catch (e) {
      // Envio falhou: a ficha volta pra fila e o próximo tick tenta de novo enquanto
      // ela estiver dentro da janela. Falha vira retry, não buraco, como antes.
      jaTocadas.delete(ficha.id);
      await devolverFicha(ficha.id, reservadaEm);
      logger.error('solar-boas-vindas', 'falha ao enviar as boas-vindas', { id: ficha.id, erro: String(e) });
      erros++;
      continue;
    }
    enviadas++;
    // Só depois do envio: se ele falhasse, a outra ficha do mesmo número não pode
    // ser fechada sem ninguém ter recebido nada.
    telefonesDaRodada.add(chaveTel);

    // Carimbo pro teto da linha, e prova de envio pra varredura de reservas. O
    // supabase-js não rejeita em falha de escrita, devolve { error }: sem conferir o
    // error, a falha nunca aparecia no log.
    const nowIso = new Date().toISOString();
    const { error: erroCarimbo } = await supabase.from('system_state')
      .upsert({ key: `${SOLAR_BV_PREFIX}${ficha.id}`, value: { em: nowIso }, updated_at: nowIso }, { onConflict: 'key' });
    if (erroCarimbo) {
      logger.error('solar-boas-vindas', 'carimbo do teto da linha falhou', { id: ficha.id, erro: erroCarimbo.message });
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
  return { enviadas, perdidos, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}

/**
 * Quem envelheceu ALÉM da janela sem receber nada — e não por decisão (status),
 * mas por falha de entrega.
 *
 * Existe porque foi assim que 87 pessoas passaram em branco por 30 dias: nada no
 * log dizia "não entreguei", só "entreguei 1". Silêncio parecia sucesso. Agora
 * cada rodada devolve o número na resposta do cron.
 *
 * Conta só a partir do piso de "daqui pra frente": o backlog de julho não é
 * perda deste agente, é decisão do dono.
 */
async function contarPerdidos(pisoDaJanela: string, dry = false): Promise<number> {
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
    const ids = (data ?? []).map((f: { id: number }) => Number(f.id)).sort((a: number, b: number) => a - b);
    // O alarme grita quando a LISTA muda, não a cada rodada. Antes a mesma linha
    // "12 cadastro(s)..." ia pro error_logs a cada ~2 minutos (682 por dia) sobre um
    // conjunto parado desde 11/09/2026: alarme que repete o tempo todo ninguém lê.
    // No dry só conta: gravar o estado aqui faria a próxima rodada real achar a lista
    // "já avisada" e engolir o alarme.
    if (!dry && await mudou(ALARME_PERDIDOS_KEY, ids.join(',')) && ids.length > 0) {
      logger.error('solar-boas-vindas',
        `${ids.length} cadastro(s) passaram da janela de ${JANELA_MS / 3600_000}h SEM receber as boas-vindas`, { ids });
    }
    return ids.length;
  } catch (err) {
    logger.error('solar-boas-vindas', 'contar perdidos falhou', err);
    return 0;
  }
}

const ALARME_PERDIDOS_KEY = 'solar_bv_alarme_perdidos';
const ALARME_RESERVA_KEY = 'solar_bv_alarme_reserva';
const AVISO_TETO_KEY = 'solar_bv_aviso_teto';
/** Reserva mais velha que isto sem carimbo de envio já não é envio em andamento. */
const RESERVA_SEM_ENVIO_MS = 15 * 60_000;

/**
 * Ficha marcada como recebida SEM envio confirmado.
 *
 * A flag é gravada ANTES do envio (a reserva). Se a função morre no meio do
 * sendHuman (limite de 300 s da Vercel, Z-API pendurada) ou se a resposta da reserva
 * se perde num 504, a ficha fica marcada, ninguém recebeu nada, e todo painel conta
 * como atendida. O carimbo solar_boasvindas_sent só é gravado DEPOIS do envio (em
 * 14/09/2026 ele casava com 90 de 90 fichas), então reserva com mais de 15 minutos sem
 * carimbo, e sem o marcador de telefone repetido, é envio que não se confirmou.
 *
 * Não desmarca sozinho: se o envio saiu e só o carimbo falhou, desmarcar mandaria as
 * bolhas de novo. Avisa, uma vez por lista, com os ids.
 */
async function conferirReservasSemEnvio(desde: string): Promise<void> {
  try {
    const ate = new Date(Date.now() - RESERVA_SEM_ENVIO_MS).toISOString();
    const { data, error } = await supabaseGerador
      .from('agendamentos').select('id')
      .in('created_by', SOLAR_ORIGENS)
      .gte('boas_vindas_at', desde)
      .lt('boas_vindas_at', ate)
      .limit(100);
    if (error) throw error;
    const ids = (data ?? []).map((f: { id: number }) => Number(f.id));

    let semEnvio: number[] = [];
    if (ids.length > 0) {
      const chaves = ids.flatMap((id: number) => [`${SOLAR_BV_PREFIX}${id}`, `${SOLAR_BV_DEDUP_PREFIX}${id}`]);
      const { data: marcas, error: erroMarcas } = await supabase
        .from('system_state').select('key').in('key', chaves);
      if (erroMarcas) throw erroMarcas;
      const existentes = new Set((marcas ?? []).map((m: { key: string }) => String(m.key)));
      semEnvio = ids
        .filter((id: number) => !existentes.has(`${SOLAR_BV_PREFIX}${id}`) && !existentes.has(`${SOLAR_BV_DEDUP_PREFIX}${id}`))
        .sort((a: number, b: number) => a - b);
    }

    if (await mudou(ALARME_RESERVA_KEY, semEnvio.join(',')) && semEnvio.length > 0) {
      logger.error('solar-boas-vindas',
        `${semEnvio.length} ficha(s) marcadas como recebidas sem envio confirmado`, { ids: semEnvio });
    }
  } catch (err) {
    logger.error('solar-boas-vindas', 'conferir reservas sem envio falhou', err);
  }
}

/**
 * Guarda `assinatura` em system_state[chave] e diz se ela MUDOU desde a última vez.
 * É o que deixa um aviso sair uma vez por mudança em vez de uma vez por rodada.
 * Falha ao ler o estado conta como mudança: na dúvida, o aviso sai.
 */
async function mudou(chave: string, assinatura: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('system_state').select('value').eq('key', chave).maybeSingle();
  const anterior = error ? null : String((data?.value as { assinatura?: string } | null)?.assinatura ?? '');
  if (anterior === assinatura) return false;
  const agora = new Date().toISOString();
  const { error: erroGravar } = await supabase.from('system_state')
    .upsert({ key: chave, value: { assinatura, em: agora }, updated_at: agora }, { onConflict: 'key' });
  if (erroGravar) logger.warn('solar-boas-vindas', 'gravar estado do aviso falhou', { chave, erro: erroGravar.message });
  return true;
}
