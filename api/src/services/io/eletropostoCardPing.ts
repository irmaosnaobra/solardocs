// ─────────────────────────────────────────────────────────────────────────────
// 12H SEM AÇÃO NO CARD → O CARD CHEGA DE NOVO NO WHATSAPP DE QUEM ESTÁ COM ELE.
//
// Ordem do Thiago (19/08/2026): "quando o consultor não der ação no card em 12h,
// envia pra ele novamente".
//
// O rodízio de 12h já existia e funciona — mas ele é MUDO. A função
// `processar_repasses()` (Supabase do Gerador, pg_cron a cada 15 min) troca o
// `vendedor_nome`, remarca pro próximo dia útil e escreve a linha no histórico…
// e ninguém avisa o consultor que passou a ser dono. O card "NOVA REUNIÃO" só
// existe uma vez na vida da ficha: no minuto em que ela nasce, mandado pros dois.
// Resultado prático: o repasse move a ficha de mesa e a mesa nova não fica
// sabendo — o lead simplesmente muda de dono e continua parado.
//
// Este módulo fecha esse buraco. Ele não decide repasse nenhum (quem decide é o
// banco, e continua sendo): ele OBSERVA de quem é cada card e, quando o dono
// muda, reenvia o card inteiro — a mesma mensagem da abertura, com o selo da
// nota, o WhatsApp do lead e tudo que o consultor precisa pra agir — só pra quem
// está com ele agora.
//
// ── Como ele sabe que mudou ──
// Carimbo `ep_card_dono:<id>` no system_state, com o último dono visto. Ficha que
// ele vê pela PRIMEIRA vez só é carimbada, sem envio: senão ligar o módulo
// mandaria o card de toda reunião viva de uma vez. Mudança de dono feita na mão
// pelo CRM também dispara — e tem que disparar mesmo: alguém pôs aquele lead na
// mesa de outra pessoa e ela precisa saber.
//
// ── O que ele NÃO é ──
// Não é o lembrete de reunião do vendedor, que o Thiago mandou desligar em 25/07
// (aquele avisava "🔔 em 1 hora" antes de cada call). Este aqui é sobre CARD
// PARADO: só existe quando o relógio de 12h venceu e a ficha trocou de mão.
//
// Recado interno pra contato salvo: não passa pelo teto anti-ban da linha (mesma
// decisão do card original), mas tem teto próprio por rodada pra nunca virar
// rajada se um dia o banco repassar 40 fichas de uma vez.
//
// Kill-switch: EP_CARD_PING_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE, montarMensagem } from '../../routes/ioEletroposto';
import { carregarConsultores, quandoPorExtenso } from './eletropostoAgenda';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

/** Último dono visto de cada card: `ep_card_dono:<id>` → { dono, em }. */
export const EP_CARD_DONO_PREFIX = 'ep_card_dono:';

/** Teto por rodada. O banco repassa de 15 em 15 min e normalmente move 1 ou 2
 *  fichas; 5 é folga com trava. */
const POR_TICK = 5;
/** Só reunião viva: o que já passou há mais de 2 dias não vira card de novo. */
const PASSADO_MAX_MS = 2 * 24 * 3600_000;
const FUTURO_MAX_MS = 30 * 24 * 3600_000;

const desligado = () => (process.env.EP_CARD_PING_OFF || '').trim() === '1';

export type ResultadoCardPing = {
  reenviados: number;
  novos: number;              // fichas vistas pela 1ª vez (só carimbadas)
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; de: string; para: string }>;
};

const zero = (motivo?: string): ResultadoCardPing =>
  ({ reenviados: 0, novos: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/** O cabeçalho que explica por que este card está chegando de novo. */
export function cabecalhoDoReenvio(deQuem: string, paraQuem: string, quandoIso: string | null): string {
  return [
    `🔁 *CARD SEM AÇÃO EM 12H — AGORA É SEU*`,
    deQuem && deQuem !== paraQuem
      ? `Estava com o *${deQuem}* e ninguém mexeu nele em 12 horas. Passou pra você, ${paraQuem}.`
      : `Ninguém mexeu neste card em 12 horas, ${paraQuem}.`,
    quandoIso ? `A reunião foi remarcada pra *${quandoPorExtenso(quandoIso)}*.` : '',
    '',
  ].filter(Boolean).join('\n');
}

/** Telefone de quem vai receber. Cadastro do CRM primeiro (é onde se troca um
 *  número), e a lista fixa da equipe como rede — card que não chega a ninguém é
 *  exatamente o problema que este módulo existe pra resolver. */
function telDoConsultor(nome: string, cadastro: Map<string, string>): string | null {
  const doCadastro = cadastro.get(nome);
  if (doCadastro) return String(doCadastro).replace(/\D/g, '');
  const fixo = EQUIPE[nome.trim().toLowerCase()];
  return fixo ? String(fixo).replace(/\D/g, '') : null;
}

/**
 * Roda a cada ~5 min dentro do /cron/process-messages.
 * `dry` decide igual, sem enviar e sem carimbar.
 */
export async function runEletropostoCardPingTick(opts: { dry?: boolean } = {}): Promise<ResultadoCardPing> {
  if (desligado()) return zero('desligado');

  const agora = Date.now();
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, cidade, temperatura, observacao, created_at, created_by, status')
    .eq('status', 'agendado')
    .gte('quando', new Date(agora - PASSADO_MAX_MS).toISOString())
    .lte('quando', new Date(agora + FUTURO_MAX_MS).toISOString())
    .limit(400);
  if (error) {
    logger.error('ep-card-ping', 'ler agendamentos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  const fichas = ((data ?? []) as Array<Record<string, any>>)
    .filter(f => ehOrigemEletroposto(f.created_by) && f.vendedor_nome);
  if (!fichas.length) return zero('nenhuma_ficha');

  const { data: carimbos } = await supabase
    .from('system_state').select('key, value')
    .in('key', fichas.map(f => `${EP_CARD_DONO_PREFIX}${f.id}`));
  const donoVisto = new Map<number, string>();
  for (const c of carimbos ?? []) {
    const id = Number(String(c.key).slice(EP_CARD_DONO_PREFIX.length));
    const dono = ((c.value ?? {}) as { dono?: string }).dono;
    if (Number.isInteger(id) && dono) donoVisto.set(id, String(dono));
  }

  const carimbar = async (id: number, dono: string) => {
    const nowIso = new Date().toISOString();
    await supabase.from('system_state').upsert(
      { key: `${EP_CARD_DONO_PREFIX}${id}`, value: { dono, em: nowIso }, updated_at: nowIso },
      { onConflict: 'key' },
    ).then(undefined, (e: unknown) => logger.error('ep-card-ping', 'carimbo do dono falhou', { id, erro: String(e) }));
  };

  // Ficha nunca vista: só carimba. É o que impede que ligar o módulo (ou uma
  // ficha nova) vire um card repetido pra quem acabou de receber o original.
  const novas = fichas.filter(f => !donoVisto.has(f.id));
  if (!opts.dry) {
    for (const f of novas) await carimbar(f.id, String(f.vendedor_nome));
  }

  const trocaram = fichas.filter(f => {
    const antes = donoVisto.get(f.id);
    return !!antes && antes !== String(f.vendedor_nome);
  }).slice(0, POR_TICK);
  if (!trocaram.length) return { reenviados: 0, novos: novas.length, erros: 0, motivo: 'ninguem_trocou' };

  const cadastro = await carregarConsultores();
  const previa: NonNullable<ResultadoCardPing['previa']> = [];
  let reenviados = 0, erros = 0;

  for (const f of trocaram) {
    const de = donoVisto.get(f.id)!;
    const para = String(f.vendedor_nome);
    if (opts.dry) {
      previa.push({ id: f.id, cliente: String(f.cliente_nome || '—'), de, para });
      reenviados++;
      continue;
    }
    const tel = telDoConsultor(para, cadastro);
    if (!tel) {
      logger.error('ep-card-ping', 'consultor sem WhatsApp — card não reenviado', { id: f.id, para });
      // Carimba mesmo assim: sem isso a mesma ficha tentaria a cada 5 minutos
      // pra sempre, e o log viraria ruído até alguém cadastrar o número.
      await carimbar(f.id, para);
      erros++;
      continue;
    }
    try {
      await sendWhatsApp(tel, `${cabecalhoDoReenvio(de, para, f.quando ?? null)}${montarMensagem(f)}`, 'io');
      await carimbar(f.id, para);
      reenviados++;
      logger.info('ep-card-ping', `card #${f.id} reenviado: ${de} → ${para}`);
    } catch (e) {
      // NÃO carimba: envio que falhou tem que tentar de novo no próximo tick —
      // é o card de um lead que já está parado há 12 horas.
      logger.error('ep-card-ping', 'reenviar card falhou', { id: f.id, erro: String(e) });
      erros++;
    }
  }

  return { reenviados, novos: novas.length, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}
