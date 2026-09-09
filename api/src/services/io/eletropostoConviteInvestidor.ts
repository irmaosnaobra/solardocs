// ─────────────────────────────────────────────────────────────────────────────
// CONVITE AO INVESTIDOR — quem tem capital e já viu um ponto, mas nunca sentou.
//
// São 61 pessoas que preencheram a LP dizendo duas coisas ao mesmo tempo: que
// têm o dinheiro e que JÁ VIRAM um local. A ficha registrou isso e ninguém falou
// com elas — 92% da base de investidores foi descartada por "sem ponto", e estas
// são justamente as que não estão nesse balde.
//
// O robô manda UMA mensagem, com três horários reais da agenda, e o lead escolhe
// respondendo "1". A partir daí a ficha nasce em `agendamentos` idêntica à que a
// LP cria — mesma tabela, mesmo status, mesmo formato de observação. É isso que
// faz a confirmação, os lembretes de 1h e 5min, o NÃO ATENDIDO automático e o
// repasse Thiago/Diego funcionarem sem saber que este caminho existe.
//
// ── Por que oferecer horário em vez de perguntar "tem interesse?" ──
// "Tem interesse em marcar?" é uma pergunta de sim ou não: gasta um toque da
// linha, dá uma chance a mais de dizer não e, quando o sim vem, ainda falta
// combinar horário — dois toques a mais numa linha que já foi bloqueada três
// vezes por volume. Com a lista na mesa, a resposta "2" já é a reunião marcada.
//
// ── Ritmo ──
// 1 pessoa a cada 20 minutos, das 07h às 20h (BRT). É a mesma régua que o dono
// mandou usar depois do bloqueio de 30/08 e que a repescagem já respeita: o que
// derruba a linha é volume em rajada, não o total do mês. Nesse passo as 61
// levam cerca de quatro dias.
//
// ── O que ele NUNCA faz ──
//   • Não manda duas vezes pra mesma pessoa (marcador `ep_convite_sent:`).
//   • Não fala com quem já tem reunião futura marcada — esse já está no funil.
//   • Não insiste: uma oferta por pessoa. Sem resposta, o assunto vira do humano.
//   • Não grava sem conferir: entre oferecer e o lead responder passam horas, e o
//     `aindaLivre` refaz a checagem no instante de marcar.
//
// Kill-switch: EP_CONVITE_OFF=1 congela a fila.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendFrio, sendHuman } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { quandoPorExtenso } from './eletropostoAgenda';
import { proximasVagas, aindaLivre } from './eletropostoVagas';
import { escolhaDaResposta } from './eletropostoRemarcar';

const PENDING_PREFIX = 'ep_convite_pending:';
/** Marcador de envio efetivado. Contado no teto anti-ban da linha. */
export const EP_CONVITE_SENT_PREFIX = 'ep_convite_sent:';
/** Oferta em aberto: `ep_convite_oferta:<telefone>` → { ofertas, dono, nome, em }. */
export const EP_CONVITE_OFERTA_PREFIX = 'ep_convite_oferta:';
const ULTIMO_KEY = 'ep_convite_ultimo';

/** Os dois que atendem eletroposto. A mesma lista da LP (ioEletroposto). */
const DONOS_EP = ['Thiago', 'Diego'] as const;

/** 1 pessoa a cada 20 min — régua pós-bloqueio de 30/08. */
const INTERVALO_MS = 20 * 60 * 1000;
/** Janela de envio pedida pelo dono (09/09): 07:00 às 21:45.
 *  Em minutos porque 21:45 não cabe em hora cheia — com corte por hora o robô
 *  ou parava às 21:00 (perdia 45min) ou varava as 22h. */
const JANELA_INICIO_MIN = 7 * 60;
const JANELA_FIM_MIN = 21 * 60 + 45;
const MAX_TENTATIVAS = 3;
/** Três é escolha; cinco é formulário. Mesma conta do remarcar. */
const QUANTAS_OPCOES = 3;
/** Oferta velha não vale: "2" três dias depois não escolhe coisa nenhuma. */
const OFERTA_VALIDA_MS = 48 * 3600_000;

/** Capital declarado — a MESMA régua da aba Investidores do /gerador. */
const CAPITAL_VALIDO = ['proprio', 'proprio_credito', 'fin_aprovado', 'fin_cnpj', 'fin_banco'];

const desligado = () => (process.env.EP_CONVITE_OFF || '').trim() === '1';

interface MarcadorConvite {
  nome: string;
  cidade: string | null;
  ready_at: string;
  tentativas?: number;
}

interface OfertaConvite {
  ofertas: string[];
  dono: string;
  nome: string;
  cidade: string | null;
  em: string;
  /** Quantas vezes a lista já foi posta na mesa. Duas no máximo. */
  rodada?: number;
}

// ── QUEM RESPONDEU BEM MAS NÃO ESCOLHEU ─────────────────────────────────────
// "Tenho interesse", "pode marcar", "boa" — é gente dizendo sim sem apontar o
// dedo pra um horário. Sem este caminho a mensagem cairia no `nada`, viraria só
// um aviso pra equipe e a reunião ficaria dependendo de alguém ver o recado:
// exatamente o buraco que fez 178 das 194 fichas nunca chegarem à agenda.
//
// A negativa vem primeiro de propósito: "não tenho interesse" contém "interesse".
const RE_NEGATIVO = /\b(n[ãa]o (tenho|quero|vou|posso|d[áa]|tenho interesse)|sem interesse|desist|descadastr|para de mandar|pare de mandar|n[ãa]o me interessa)\b/i;
const RE_POSITIVO = /\b(sim|quero|queria|tenho interesse|me interessa|interessado|pode ser|pode marcar|podemos|vamos|bora|claro|aceito|topo|fechado|beleza|blz|show|perfeito|[óo]timo|combinado|t[ôo] dentro|manda|marca)\b/i;

/** Disse sim, mas não escolheu horário nenhum? */
export function positivoSemHorario(textos: string[]): boolean {
  const t = textos.map(x => String(x || '').trim()).filter(Boolean).join(' ');
  if (!t) return false;
  if (RE_NEGATIVO.test(t)) return false;
  return RE_POSITIVO.test(t);
}

/** Minutos desde a meia-noite em Brasília — o servidor roda em UTC. */
export function minutosBrasilia(d = new Date()): number {
  const s = d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const m = /(\d{1,2})\D(\d{2})/.exec(s);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function foraDaJanela(d = new Date()): boolean {
  const t = minutosBrasilia(d);
  return t < JANELA_INICIO_MIN || t >= JANELA_FIM_MIN;
}

/** Telefone só dígitos com DDI — é a chave da fila (1 pessoa = 1 marcador). */
export function normalizarTel(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 12 || d.length > 13) return null;
  return d.startsWith('55') ? d : null;
}

/**
 * Chave de comparação: DDD + 8 últimos — a MESMA de `telefone_norm` no banco e do
 * `donoDoTelefone` no CRM. Ela NÃO disca: serve só pra dizer se duas linhas são a
 * mesma pessoa, tolerando o 9 e o 55.
 *
 * Confundir as duas custa caro e em silêncio: `telefone_norm` tem 10 dígitos, e
 * mandar isso pro normalizador de DDI descarta 100% da base — a fila semeia zero
 * e o log diz "fila_vazia", que é indistinguível de "já falei com todo mundo".
 */
export function chaveTel(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.slice(-10);
}

function primeiroNome(nome: string): string {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

/** "1) segunda, 15/09 às 14h00" */
const linhaDaOpcao = (iso: string, i: number) =>
  `${i + 1}) ${quandoPorExtenso(iso).replace('-feira', '')}`;

// ─── a mensagem ──────────────────────────────────────────────────────────────
/**
 * UMA bolha. A linha corta rajada desde o bloqueio (1 toque = 1 mensagem), e
 * quebrar isso em cinco balões seria o mesmo volume que já derrubou o número.
 *
 * A ordem dentro do texto é proposital: primeiro o que a PESSOA disse (capital
 * e ponto), porque é o que prova que não é disparo; depois o que a gente é; e a
 * agenda por último, que é a única coisa que pede ação.
 */
export function bolhaConvite(nome: string, cidade: string | null, ofertas: string[], dono: string): string[] {
  const p = primeiroNome(nome);
  const ondeViu = cidade ? ` em ${cidade}` : '';
  const lista = ofertas.map(linhaDaOpcao).join('\n');
  return [
    `Oi${p ? ' ' + p : ''}! Aqui é o ${dono}, da NEXUS ELETROPOSTOS.\n\n`
    + `Você preencheu no nosso site que já tem o capital e que já viu um ponto${ondeViu}.\n\n`
    + 'A gente importa os carregadores direto da fábrica e monta o ponto inteiro — projeto, '
    + 'parecer na concessionária, obra e comissionamento. Dá pra fechar à vista, em até 18x no '
    + 'cartão ou financiado em até 72 meses.\n\n'
    + `Separei três horários pra gente ver a conta do seu ponto:\n${lista}\n\n`
    + 'Responde 1, 2 ou 3 que eu já deixo marcado.',
  ];
}

const bolhaMarcado = (nome: string, iso: string, dono: string): string[] => [
  `Fechado${nome ? ', ' + primeiroNome(nome) : ''}! ${quandoPorExtenso(iso).replace('-feira', '')} com o ${dono}. `
  + 'Na véspera eu confirmo por aqui. Se puder, já me manda o endereço do ponto que você viu — '
  + 'chego na conversa com a conta dele pronta.',
];

const bolhaReoferta = (ofertas: string[]): string[] => [
  'Boa! Pra já deixar marcado, me diz qual desses fica melhor:\n'
  + `${ofertas.map(linhaDaOpcao).join('\n')}\n\nÉ só responder o número.`,
];

const bolhaSlotTomado = (ofertas: string[]): string[] => [
  'Esse horário acabou de ser preenchido, desculpa. '
  + `Ainda tenho:\n${ofertas.map(linhaDaOpcao).join('\n')}\n\nQual desses?`,
];

// ─── SEMEAR: quem entra na fila ──────────────────────────────────────────────
/**
 * O recorte é o que a base já respondeu, não um palpite:
 *   capital declarado  +  tem_ponto = 'em_vista'  +  telefone válido
 *
 * `em_vista` é a chave. Quem marcou 'sem_ideia' (60 pessoas) não tem o que
 * conversar ainda — mensagem pra eles seria "vamos conversar?" sem assunto, e é
 * assim que se gasta linha e esfria lead. Quem tem ponto 'definido' ou
 * 'negociando' (8) é mais quente ainda e entra primeiro na ordenação.
 */
export async function semearConvites(opts: { dry?: boolean; limite?: number; naoAntesDe?: string } = {}): Promise<{
  candidatos: number; enfileirados: number; pulados: number; motivos: Record<string, number>;
}> {
  const motivos: Record<string, number> = {};
  const pula = (m: string) => { motivos[m] = (motivos[m] || 0) + 1; };

  const { data: fichas, error } = await supabaseGerador
    .from('eletroposto_nota1')
    .select('nome, telefone, telefone_norm, cidade, capital_faixa, tem_ponto, e_decisor, created_at')
    .in('capital_faixa', CAPITAL_VALIDO)
    .in('tem_ponto', ['definido', 'negociando', 'em_vista'])
    .order('created_at', { ascending: false });
  if (error) throw error;

  const candidatos = (fichas || []);
  if (!candidatos.length) return { candidatos: 0, enfileirados: 0, pulados: 0, motivos };

  // Quem já tem reunião no futuro está no funil: convidar de novo é atropelar
  // o consultor que já está com a ficha na mão.
  const { data: futuras } = await supabaseGerador
    .from('agendamentos')
    .select('cliente_telefone')
    .gte('quando', new Date().toISOString())
    .eq('status', 'agendado');
  // Comparação por CHAVE (10 dígitos), não pelo número inteiro: `agendamentos`
  // guarda os dois formatos e o cliente_telefone às vezes vem com 12, 13 ou 14.
  const jaNoFunil = new Set((futuras || [])
    .map(f => chaveTel(f.cliente_telefone as string))
    .filter(Boolean) as string[]);

  // Quem já recebeu este convite alguma vez. Uma pessoa, uma mensagem.
  const { data: enviados } = await supabase
    .from('system_state').select('key').like('key', `${EP_CONVITE_SENT_PREFIX}%`);
  const jaEnviado = new Set((enviados || []).map(r => String(r.key).slice(EP_CONVITE_SENT_PREFIX.length)));

  const { data: naFila } = await supabase
    .from('system_state').select('key').like('key', `${PENDING_PREFIX}%`);
  const jaNaFila = new Set((naFila || []).map(r => String(r.key).slice(PENDING_PREFIX.length)));

  // Decisor com ponto já definido primeiro: é a ordem do mais quente pro mais frio.
  const peso = (f: Record<string, unknown>) =>
    (['definido', 'negociando'].includes(String(f.tem_ponto)) ? 2 : 0)
    + (f.e_decisor === true ? 1 : 0);
  const ordenados = [...candidatos].sort((a, b) => peso(b) - peso(a));

  const linhas: { key: string; value: MarcadorConvite; updated_at: string }[] = [];
  const vistos = new Set<string>();
  // O dono pediu pra começar 19:30 de hoje: sem este piso, semear às 19:20
  // dispararia a primeira mensagem no mesmo minuto.
  const piso = opts.naoAntesDe ? new Date(opts.naoAntesDe).getTime() : 0;
  let base = Math.max(Date.now(), Number.isFinite(piso) ? piso : 0);

  for (const f of ordenados) {
    if (opts.limite && linhas.length >= opts.limite) break;
    // `telefone` é o discável (55 + DDD + número). `telefone_norm` é chave e não disca.
    const tel = normalizarTel(f.telefone as string);
    const chave = chaveTel(f.telefone as string);
    if (!tel || !chave) { pula('telefone_invalido'); continue; }
    if (vistos.has(chave)) { pula('duplicado_na_base'); continue; }
    if (jaNoFunil.has(chave)) { pula('ja_tem_reuniao'); continue; }
    if (jaEnviado.has(tel)) { pula('ja_recebeu'); continue; }
    if (jaNaFila.has(tel)) { pula('ja_na_fila'); continue; }
    vistos.add(chave);
    linhas.push({
      key: `${PENDING_PREFIX}${tel}`,
      value: {
        nome: String(f.nome || ''),
        cidade: (f.cidade as string) || null,
        ready_at: new Date(base).toISOString(),
      },
      updated_at: new Date().toISOString(),
    });
    base += INTERVALO_MS;   // o espaçamento já nasce na fila
  }

  if (!opts.dry && linhas.length) {
    const { error: eIns } = await supabase
      .from('system_state').upsert(linhas, { onConflict: 'key', ignoreDuplicates: true });
    if (eIns) throw eIns;
  }

  return {
    candidatos: candidatos.length,
    enfileirados: linhas.length,
    pulados: candidatos.length - linhas.length,
    motivos,
  };
}

// ─── TICK: uma pessoa por vez ────────────────────────────────────────────────
export type TickConvite = { enviados: number; motivo?: string; restam?: number };

/**
 * De quem é a vez — alterna a cada ENVIO, não a cada fechamento.
 *
 * A LP faz o rodízio contando o que já foi marcado, e ali está certo: lá cada
 * visita vira (ou não) uma reunião na hora. Aqui não: entre um convite e o
 * próximo pode não fechar nada, e contar fechamento deixaria dez pessoas
 * seguidas recebendo os horários do mesmo consultor. O contador é do disparo.
 */
const VEZ_KEY = 'ep_convite_vez';

async function proximoDono(): Promise<string> {
  const { data } = await supabase
    .from('system_state').select('value').eq('key', VEZ_KEY).maybeSingle();
  const n = Number((data?.value as { n?: number } | null)?.n ?? 0);
  await supabase.from('system_state').upsert(
    { key: VEZ_KEY, value: { n: n + 1 }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  return DONOS_EP[n % DONOS_EP.length]!;
}

export async function runConviteTick(): Promise<TickConvite> {
  if (desligado()) return { enviados: 0, motivo: 'desligado' };
  if (foraDaJanela()) return { enviados: 0, motivo: 'fora_da_janela' };

  const { data: rows } = await supabase
    .from('system_state').select('key, value').like('key', `${PENDING_PREFIX}%`);
  if (!rows || !rows.length) return { enviados: 0, motivo: 'fila_vazia' };

  const agora = Date.now();
  const prontos = rows
    .filter(r => new Date(String((r.value as MarcadorConvite).ready_at)).getTime() <= agora)
    .sort((a, b) => new Date(String((a.value as MarcadorConvite).ready_at)).getTime()
      - new Date(String((b.value as MarcadorConvite).ready_at)).getTime());
  if (!prontos.length) return { enviados: 0, motivo: 'nada_pronto', restam: rows.length };

  // Espaçamento entre pessoas: 20 min contados do último envio EFETIVADO.
  const { data: ultimo } = await supabase
    .from('system_state').select('value').eq('key', ULTIMO_KEY).maybeSingle();
  const ultimoAt = ultimo?.value ? new Date(String((ultimo.value as { at: string }).at)).getTime() : 0;
  if (agora - ultimoAt < INTERVALO_MS) return { enviados: 0, motivo: 'intervalo', restam: rows.length };

  // Teto da linha física: a Bia e o followup saem pelo mesmo número.
  if (!(await dentroDoTetoHorarioLinha())) return { enviados: 0, motivo: 'teto_linha', restam: rows.length };

  const alvo = prontos[0]!;
  const marcador = alvo.value as MarcadorConvite;
  const telefone = alvo.key.slice(PENDING_PREFIX.length);

  // CLAIM atômico: dois crons batem o mesmo tick.
  const { data: claimed } = await supabase
    .from('system_state').delete().eq('key', alvo.key).select('key').maybeSingle();
  if (!claimed) return { enviados: 0, motivo: 'corrida_perdida', restam: rows.length };

  // Relógio ANTES do envio: se morrer no meio, o próximo espera 20min em vez de emendar.
  await supabase.from('system_state').upsert(
    { key: ULTIMO_KEY, value: { at: new Date().toISOString(), telefone }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );

  const devolverPraFila = async (motivo: string) => {
    const tentativas = (marcador.tentativas ?? 0) + 1;
    if (tentativas <= MAX_TENTATIVAS) {
      await supabase.from('system_state').upsert(
        {
          key: alvo.key,
          value: { ...marcador, tentativas, ready_at: new Date(Date.now() + INTERVALO_MS).toISOString() },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
    }
    logger.error('ep-convite', `${motivo} pra ${telefone} (tentativa ${tentativas}/${MAX_TENTATIVAS})`, null);
  };

  // A vez é de um, mas a agenda manda: consultor lotado não pode travar a fila.
  let dono = await proximoDono();
  let vagas = await proximasVagas(dono, QUANTAS_OPCOES, { agora });
  if (vagas !== null && !vagas.length) {
    const outro = DONOS_EP.find(d => d !== dono)!;
    const doOutro = await proximasVagas(outro, QUANTAS_OPCOES, { agora });
    if (doOutro && doOutro.length) { dono = outro; vagas = doOutro; }
  }
  // `null` é "não consegui ler a agenda" — diferente de "não tem vaga". Nos dois
  // casos não dá pra oferecer, mas só o primeiro merece voltar pra fila.
  if (vagas === null) { await devolverPraFila('agenda_ilegivel'); return { enviados: 0, motivo: 'agenda_ilegivel' }; }
  if (!vagas.length) { await devolverPraFila('sem_vaga'); return { enviados: 0, motivo: 'sem_vaga' }; }

  try {
    await sendFrio(telefone, bolhaConvite(marcador.nome, marcador.cidade, vagas, dono), 'io');
    const oferta: OfertaConvite = {
      ofertas: vagas, dono, nome: marcador.nome, cidade: marcador.cidade, em: new Date().toISOString(),
    };
    await supabase.from('system_state').upsert([
      {
        key: `${EP_CONVITE_SENT_PREFIX}${telefone}`,
        value: { sent_at: new Date().toISOString(), nome: marcador.nome, dono },
        updated_at: new Date().toISOString(),
      },
      {
        key: `${EP_CONVITE_OFERTA_PREFIX}${telefone}`,
        value: oferta as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: 'key' });
    logger.info('ep-convite', `convite enviado pra ${marcador.nome} (${telefone}) com ${vagas.length} horarios de ${dono}`);
    return { enviados: 1, restam: rows.length - 1 };
  } catch (err) {
    await devolverPraFila('envio_falhou');
    logger.error('ep-convite', `envio falhou pra ${telefone}`, err);
    return { enviados: 0, motivo: 'erro_envio', restam: rows.length };
  }
}

// ─── RESPOSTA: o lead escolheu ───────────────────────────────────────────────
export type PassoConvite =
  | { acao: 'nada' }
  | { acao: 'marcou'; iso: string; dono: string; id: number | null }
  | { acao: 'slot_tomado' }
  | { acao: 'reofertou' }
  | { acao: 'ambiguo' };

/**
 * Chamado de dentro do `eletropostoRespostas`, que já lê o inbound da linha e já
 * casa telefone com ficha. Um segundo leitor de `wa_mensagens` seria dois robôs
 * disputando a mesma conversa.
 *
 * Grava em `agendamentos` com o MESMO formato da LP — é isso que faz a
 * confirmação, os lembretes e o NÃO ATENDIDO pegarem a ficha sem saber que ela
 * veio daqui. O que muda é só o `created_by`, pra dar pra medir este caminho
 * separado no funil.
 */
export async function passoDoConvite(telefone: string, textos: string[]): Promise<PassoConvite> {
  if (desligado()) return { acao: 'nada' };
  const tel = normalizarTel(telefone);
  if (!tel || !textos.length) return { acao: 'nada' };

  const chave = `${EP_CONVITE_OFERTA_PREFIX}${tel}`;
  const { data: linha } = await supabase
    .from('system_state').select('value').eq('key', chave).maybeSingle();
  if (!linha?.value) return { acao: 'nada' };

  const oferta = linha.value as unknown as OfertaConvite;
  if (Date.now() - new Date(oferta.em).getTime() > OFERTA_VALIDA_MS) {
    await supabase.from('system_state').delete().eq('key', chave);
    return { acao: 'nada' };
  }

  const i = escolhaDaResposta(textos, oferta.ofertas);
  if (i === null) {
    // Disse sim e não apontou horário. Repõe a lista UMA vez — quem responde bem
    // e some é o lead mais caro que existe: já custou a mensagem e o interesse.
    // Duas vezes seria insistência, e insistência nesta linha é o que a derruba.
    if (positivoSemHorario(textos) && (oferta.rodada ?? 1) < 2) {
      const novas = await proximasVagas(oferta.dono, QUANTAS_OPCOES, {});
      if (novas && novas.length) {
        await supabase.from('system_state').upsert(
          {
            key: chave,
            value: { ...oferta, ofertas: novas, rodada: 2, em: new Date().toISOString() } as unknown as Record<string, unknown>,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' },
        );
        await sendHuman(tel, bolhaReoferta(novas), 'io');
        logger.info('ep-convite', `positivo sem horario, lista reposta (${tel})`);
        return { acao: 'reofertou' };
      }
    }
    return { acao: 'nada' };                        // não falou de horário nenhum
  }
  if (i === -1) return { acao: 'ambiguo' };         // citou dois: quem desempata é gente

  const iso = oferta.ofertas[i]!;
  // Entre oferecer e responder passam horas: o slot pode ter sido tomado na LP.
  if (!(await aindaLivre(iso, oferta.dono))) {
    const novas = await proximasVagas(oferta.dono, QUANTAS_OPCOES, {});
    if (novas && novas.length) {
      await supabase.from('system_state').upsert(
        {
          key: chave,
          value: { ...oferta, ofertas: novas, em: new Date().toISOString() } as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
      await sendHuman(tel, bolhaSlotTomado(novas), 'io');
    }
    return { acao: 'slot_tomado' };
  }

  const ficha = {
    vendedor_nome: oferta.dono,
    quando: iso,
    cliente_nome: oferta.nome || 'Investidor',
    cliente_telefone: tel,
    cidade: oferta.cidade,
    status: 'agendado',
    temperatura: 'quente',
    observacao: 'Convite ao investidor (WhatsApp): tem capital declarado e já viu um ponto'
      + (oferta.cidade ? ` em ${oferta.cidade}` : '') + '. Escolheu o horário pela lista.',
    created_by: 'convite_investidor',
    src: 'convite_investidor',
  };

  const { data, error } = await supabaseGerador
    .from('agendamentos').insert(ficha).select('id').single();
  if (error) {
    logger.error('ep-convite', `escolheu ${iso} mas nao gravou (${tel})`, error);
    return { acao: 'nada' };
  }

  await supabase.from('system_state').delete().eq('key', chave);
  await sendHuman(tel, bolhaMarcado(oferta.nome, iso, oferta.dono), 'io');
  logger.info('ep-convite', `${oferta.nome} (${tel}) marcou ${iso} com ${oferta.dono}`);
  return { acao: 'marcou', iso, dono: oferta.dono, id: (data?.id as number) ?? null };
}
