// ─────────────────────────────────────────────────────────────────────────────
// RETOMADA DO 1x1 DO SOLARDOC: a Carla volta em quem ficou sem desfecho.
//
// Ordem do Thiago (01/09/2026): "não deixar a pessoa dar vácuo, é venda ou
// receber um não". Hoje o funil B2B tem ZERO segundo toque: em 26 leads, nenhum
// foi recontatado uma vez sequer, enquanto a mesma máquina reativou 127 de 836
// no B2C. Quem reabriu conversa até agora foi sempre o lead (o Daniel da
// GARRISOL sumiu no dia 30 e voltou sozinho dois dias depois).
//
// ── POR QUE ISTO NÃO É O DISPARO QUE DERRUBOU A LINHA TRÊS VEZES ──
//
// A diferença não é o volume, é COM QUEM se fala. Falar de novo com quem já
// conversou é continuar uma conversa; falar de novo com quem nunca respondeu é
// o que produz denúncia, e denúncia é o que derruba número. Por isso a régua
// separa os dois e trata diferente:
//
//   ENGAJOU (2+ falas dele): 19 pessoas. Retomada normal, até 2 toques.
//   SÓ A FRASE DE ENTRADA:   13 pessoas. UM toque, e nunca mais.
//
// Nenhuma delas recebe se estiver na lista de silêncio ou na de mudos com 3+
// toques (carregarBloqueioProativo), e o envio inteiro passa pelo teto da linha
// como qualquer outro bot: o marcador `carla_retomada:` está em
// BOT_SENT_PREFIXES, então isto compete pelo mesmo orçamento e não fura nada.
//
// ── O QUE ELA MANDA ──
//
// Não é template de campanha. Ela LÊ a conversa que teve com a pessoa e volta no
// ponto exato onde parou: o Glicerio ouviu sobre o Reonic que ele só usa 30%, o
// Alvair tinha entregado CNPJ pra pagar no Pix, a Bruna esperava o código. Uma
// mensagem que ignora isso é pior que silêncio, porque prova que ninguém leu.
//
// ── DESLIGAR ──
// CARLA_RETOMADA_ON não setado = não manda nada. Opt-in explícito, não
// kill-switch: campanha em cima de base não pode começar sozinha porque um
// deploy subiu. Modo seco (`dry`) ignora a trava de propósito.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { sendHuman } from '../zapiClient';
import { dentroDoTetoHorarioLinha, dentroDaJanelaDiurna } from '../whatsapp/lineThrottle';
import { carregarBloqueioProativo } from '../../io/ioSend';
import { BOLHAS_CARLA } from './carlaAcoes';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const RETOMADA_PREFIX = 'carla_retomada:';

const ligada = () => (process.env.CARLA_RETOMADA_ON || '').toLowerCase() === 'true';

/** Quantos por tick. Baixo de propósito: a base é pequena e drena em uma tarde. */
const POR_TICK = Number(process.env.CARLA_RETOMADA_LOTE || 2);

/** Horas mínimas de silêncio antes de puxar. Ninguém é cutucado no mesmo dia. */
const HORAS_DE_VACUO = Number(process.env.CARLA_RETOMADA_HORAS || 20);

/** Teto de toques por pessoa, por grupo. Quem nunca falou leva UM e acabou. */
const MAX_TOQUES_ENGAJOU = 2;
const MAX_TOQUES_MUDO = 1;

interface Alvo {
  phone: string;
  nome: string | null;
  estagio: string | null;
  falasDele: number;
  historico: string;
  toques: number;
}

/** O que já foi mandado pra essa pessoa nesta campanha. */
async function toquesJaDados(phone: string): Promise<number> {
  try {
    const { data } = await supabase
      .from('system_state').select('value').eq('key', `${RETOMADA_PREFIX}${phone}`).maybeSingle();
    const v = (data?.value ?? null) as { toques?: number } | null;
    return typeof v?.toques === 'number' ? v.toques : 0;
  } catch { return 0; }
}

async function marcarToque(phone: string, toques: number): Promise<void> {
  const agora = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: `${RETOMADA_PREFIX}${phone}`, value: { toques, ultimo: agora }, updated_at: agora },
    { onConflict: 'key' },
  );
}

/**
 * Transcreve a conversa pro prompt. Só as falas de verdade: bloco de tool e
 * marcador de estágio não são conversa e só confundem quem vai escrever.
 */
function transcrever(messages: unknown): { texto: string; falasDele: number } {
  const arr = Array.isArray(messages) ? messages : [];
  const linhas: string[] = [];
  let falasDele = 0;
  for (const m of arr as { role: string; content: unknown }[]) {
    if (typeof m.content !== 'string' || m.content.startsWith('[{')) continue;
    const txt = m.content.replace(/\[ESTAGIO:[^\]]*\]/gi, '').replace(/\|\|/g, ' ').trim();
    if (!txt) continue;
    if (m.role === 'user') { falasDele++; linhas.push(`ELE: ${txt}`); }
    else linhas.push(`CARLA: ${txt}`);
  }
  // As últimas trocas são o que importa: é onde a conversa parou.
  return { texto: linhas.slice(-14).join('\n'), falasDele };
}

async function escreverRetomada(alvo: Alvo): Promise<string> {
  const engajou = alvo.falasDele >= 2;
  const prompt = [
    'Você é a Carla, do comercial do SolarDoc Pro. Você JÁ conversou com esta pessoa',
    'no WhatsApp e a conversa ficou sem desfecho. Escreva a mensagem que reabre.',
    '',
    'A CONVERSA QUE VOCÊS TIVERAM (últimas trocas):',
    alvo.historico || '(sem histórico legível)',
    '',
    `Estágio no CRM: ${alvo.estagio || 'novo'}. Toque de retomada nº ${alvo.toques + 1}.`,
    '',
    'REGRAS:',
    '- Retome no ponto EXATO onde parou. Cite a coisa concreta que ele disse ou',
    '  perguntou. Mensagem que serviria pra qualquer um prova que ninguém leu, e',
    '  é pior que o silêncio.',
    '- Se ficou algo pendente da NOSSA parte, reconheça sem rodeio e resolva ou',
    '  diga o que dá pra fazer agora. Não invente desculpa nem culpe "o time".',
    engajou
      ? '- Ele conversou de verdade com você. Trate como continuação, não como abordagem.'
      : '- Ele só mandou a frase de entrada e sumiu. Seja curtíssima e dê um motivo real pra responder.',
    '- É venda ou é um não: termine com uma pergunta que ele consiga responder em',
    '  uma palavra, e que dê a ele a saída honesta de dizer que não quer.',
    '- SE ELE JÁ DISSE NÃO, se já falou que fechou com outro, que desistiu ou que',
    '  não tem interesse, NÃO pergunte de novo o que ele já respondeu. Reconheça a',
    '  decisão dele em uma frase, deixe UMA porta aberta sem cobrar resposta, e',
    '  encerre. Perguntar "você já fechou com outro?" pra quem acabou de dizer que',
    '  fechou é a prova de que ninguém leu, e é o que transforma uma perda em',
    '  irritação.',
    '- No máximo 2 bolhas separadas por ||. Uma ideia por bolha, 1 ou 2 linhas.',
    '- Minúscula no começo, sem emoji, SEM TRAVESSÃO (nem o tracinho comprido nem',
    '  hífen fazendo o papel dele). Vírgula, ponto ou quebra de bolha.',
    '- Nada de "não perca", "oportunidade única", "estou à disposição".',
    '- Preço é R$ 67/mês, ilimitado, sem fidelidade, 7 dias de garantia. Não invente',
    '  desconto, prazo ou condição. Não mande link nesta mensagem: se ele responder,',
    '  a conversa continua e o link sai no 1x1.',
    '- Saída: APENAS o texto da mensagem, sem aspas e sem explicação.',
  ].join('\n');

  const r = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: prompt,
    messages: [{ role: 'user', content: 'Escreva a mensagem de retomada.' }],
  });
  const c = r.content.find((b) => b.type === 'text') as { text?: string } | undefined;
  return (c?.text || '').trim();
}

export interface ResultadoRetomada {
  elegiveis: number;
  enviados: number;
  pulados: string[];
  previa?: { phone: string; nome: string | null; mensagem: string }[];
}

/**
 * Um tick da retomada. Chamado pelo cron.
 * `dry` monta a mensagem e NÃO envia, pra revisar antes de ligar.
 */
export async function runCarlaRetomada(opts: { dry?: boolean } = {}): Promise<ResultadoRetomada> {
  const out: ResultadoRetomada = { elegiveis: 0, enviados: 0, pulados: [], previa: [] };

  if (!opts.dry && !ligada()) {
    out.pulados.push('CARLA_RETOMADA_ON ausente');
    return out;
  }
  if (!opts.dry && !dentroDaJanelaDiurna()) {
    out.pulados.push('fora da janela diurna');
    return out;
  }

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, estagio, updated_at')
    .eq('instance', 'solardoc').eq('tipo', 'b2b')
    .lt('updated_at', new Date(Date.now() - HORAS_DE_VACUO * 3600_000).toISOString())
    .order('updated_at', { ascending: false })
    .limit(200);

  if (!leads?.length) return out;

  const bloqueado = await carregarBloqueioProativo();

  for (const l of leads as { phone: string; nome: string | null; estagio: string | null }[]) {
    if (out.enviados >= POR_TICK) break;

    // Quem já fechou não é puxado. Quem pediu pra parar, também não.
    if (l.estagio === 'fechado' || l.estagio === 'perdido') continue;
    if (bloqueado(l.phone)) { out.pulados.push(`${l.phone}: bloqueio proativo`); continue; }

    const { data: sess } = await supabase
      .from('whatsapp_sessions').select('messages').eq('tipo', 'sdr_b2b').eq('phone', l.phone).maybeSingle();
    const { texto, falasDele } = transcrever((sess as { messages?: unknown } | null)?.messages);
    if (!falasDele) continue;   // nunca escreveu nada: não é conversa, é ruído

    const toques = await toquesJaDados(l.phone);
    const teto = falasDele >= 2 ? MAX_TOQUES_ENGAJOU : MAX_TOQUES_MUDO;
    if (toques >= teto) continue;

    out.elegiveis++;

    // O teto da linha é checado por ENVIO, não uma vez por tick: entre um e
    // outro o eletroposto pode ter gasto o orçamento, e quem descobre isso
    // depois é a linha caindo.
    if (!opts.dry && !(await dentroDoTetoHorarioLinha())) {
      out.pulados.push('teto da linha atingido');
      break;
    }

    const alvo: Alvo = { phone: l.phone, nome: l.nome, estagio: l.estagio, falasDele, historico: texto, toques };
    let mensagem = '';
    try {
      mensagem = await escreverRetomada(alvo);
    } catch (err) {
      logger.error('carla-retomada', `IA falhou pra ${l.phone}`, err);
      out.pulados.push(`${l.phone}: IA falhou`);
      continue;
    }
    if (!mensagem) { out.pulados.push(`${l.phone}: mensagem vazia`); continue; }

    if (opts.dry) {
      out.previa!.push({ phone: l.phone, nome: l.nome, mensagem });
      out.enviados++;
      continue;
    }

    try {
      await sendHuman(l.phone, mensagem.split('||').map(s => s.trim()).filter(Boolean), 'io', BOLHAS_CARLA);
      await marcarToque(l.phone, toques + 1);
      out.enviados++;
      logger.info('carla-retomada', `toque ${toques + 1} enviado pra ${l.phone} (${l.nome || 'sem nome'})`);
    } catch (err) {
      logger.error('carla-retomada', `envio falhou pra ${l.phone}`, err);
      out.pulados.push(`${l.phone}: envio falhou`);
    }
  }

  return out;
}
