// ─────────────────────────────────────────────────────────────────────────────
// O FOLLOW-UP DE RETORNO — quem perdeu o horário na régua do SIM é chamado de
// volta, com horário na mesa, duas vezes.
//
// Ordem do dono em 22/09/2026, no mesmo dia em que a régua do SIM tirou 18
// reuniões mudas da agenda: *"desses excluídos da agenda, faz um followup de
// retorno deles"*.
//
// A mensagem de liberação já convida a pessoa a voltar, mas ela é um convite
// ABERTO ("me responde que eu procuro um horário novo"), e convite aberto morre
// no silêncio de quem já estava em silêncio. Aqui o robô faz o contrário: põe
// três horários concretos na mesa e pede um número. É a mesma conversa que ele
// já sabe ter com quem pede pra remarcar, e é por isso que este módulo não
// inventa fluxo nenhum — ele só decide QUANDO chamar.
//
// ── A cadência ──
//   D+1 (20h depois da liberação)  · 1ª oferta, sem cobrança nenhuma no texto
//   D+3 (68h depois)               · a última, e a mensagem diz que é a última
//   depois disso                   · silêncio. A ficha dele está na aba Curioso
//                                    e quem fala com ele é a equipe.
//
// As 20 horas não são um número redondo à toa: a liberação acontece de dia, e
// 20h depois cai na manhã seguinte, que é quando a linha está vazia (a régua do
// SIM aprendeu isso apanhando: na estreia, a linha estava em 25 envios por hora
// à tarde e a fila de avisos parou). 68h joga a segunda pra manhã de D+3.
//
// ── Quem NÃO recebe ──
//   · quem voltou (a ficha saiu de `cancelado`, seja pelo robô ou pela equipe);
//   · quem escreveu qualquer coisa depois da liberação — aí tem gente
//     conversando, e robô que entra no meio de conversa estraga conversa;
//   · quem não tem consultor na ficha (sem dono não há agenda pra oferecer);
//   · quem já levou as duas rodadas.
//
// ── Por que a oferta é FRIA no teto da linha ──
// `ofertarPorConta` é chamado com `transacional: false`. Reengajar quem sumiu
// não é resposta a mensagem de ninguém e não pode comer a reserva anti-ban que
// existe pra quem acabou de marcar uma reunião. Na prática isso ainda AJUDA a
// entrega: o orçamento frio (6/h) está quase todo livre, enquanto o transacional
// disputa espaço com os quatro toques de agenda do dia.
//
// Kill-switch: EP_RETORNO_OFF=1. Prévia sem enviar e sem gravar:
// GET /cron/eletroposto-retorno?dry=1
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ofertarPorConta, bolhasRetorno1, bolhasRetorno2 } from './eletropostoRemarcar';
import { EP_LIBERADO_PREFIX } from './eletropostoCobraSim';
import { EP_RESPOSTA_PREFIX } from './eletropostoAgenda';

/** Carimbo de rodada ENVIADA: `ep_retorno:<id>:r1` / `:r2`. Reivindicado ANTES
 *  do envio (insert numa primary key), pelo mesmo motivo que a régua do SIM:
 *  dois ticks simultâneos leem a mesma fila e mandariam duas vezes. */
export const EP_RETORNO_PREFIX = 'ep_retorno:';

const BRT_TZ = 'America/Sao_Paulo';

const R1_APOS_H = Number(process.env.EP_RETORNO_R1_H || 20);
const R2_APOS_H = Number(process.env.EP_RETORNO_R2_H || 68);
// Duas rodadas e ponto: depois disto a ficha está no Curioso e o assunto passa a
// ser da equipe. Quem guarda o "duas" é a própria escada (r1, r2) em
// `rodadaDevida`, então não existe constante solta aqui pra desencontrar dela.
/** Uma pessoa por vez na fila lenta. Com o tick de 5 min isso é até 12/h, e o
 *  teto frio da linha (6/h) morde antes: quem manda no ritmo é ele. */
const POR_TICK = Number(process.env.EP_RETORNO_POR_TICK || 1);
/** Oferta de reunião não sai de madrugada nem na hora do jantar. */
const JANELA_INICIO_H = 9;
const JANELA_FIM_H = 19;
/** Liberação de mais de uma semana não vira oferta: o lead esfriou e a mensagem
 *  vira abordagem fria, que tem outro canal (a pauta do Curioso). */
const VALIDADE_MS = 8 * 24 * 3600_000;

const desligado = () => (process.env.EP_RETORNO_OFF || '').trim() === '1';

function foraDaJanela(now = new Date()): boolean {
  const h = Number(now.toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}

interface Liberado { id: number; em: string; nome: string | null; quando: string | null }

interface FichaCancelada {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  vendedor_nome: string | null;
  quando: string | null;
  status: string | null;
  lead_resposta_at: string | null;
}

export type RodadaRetorno = 'r1' | 'r2' | null;

/**
 * Qual rodada vale agora, em função pura.
 *
 * `horasDesdeLiberacao` manda em tudo: a régua do SIM libera a qualquer hora do
 * dia, então contar em "dias" daria mensagens às 8h pra quem perdeu às 19h e
 * às 19h pra quem perdeu às 8h.
 */
export function rodadaDevida(e: {
  horasDesdeLiberacao: number;
  r1Enviada: boolean;
  r2Enviada: boolean;
}): RodadaRetorno {
  if (e.r2Enviada) return null;
  if (e.r1Enviada) return e.horasDesdeLiberacao >= R2_APOS_H ? 'r2' : null;
  return e.horasDesdeLiberacao >= R1_APOS_H ? 'r1' : null;
}

export type ResultadoRetorno = {
  ofertas: number;
  /** Chamados que não saíram porque a agenda do consultor está sem vaga. */
  sem_vaga: number;
  /** Quem já voltou pra agenda e por isso saiu desta fila. */
  voltaram: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; rodada: RodadaRetorno }>;
};

const zero = (motivo?: string): ResultadoRetorno =>
  ({ ofertas: 0, sem_vaga: 0, voltaram: 0, erros: 0, ...(motivo ? { motivo } : {}) });

export async function runEletropostoRetornoTick(opts: { dry?: boolean } = {}): Promise<ResultadoRetorno> {
  if (desligado()) return zero('desligado');
  if (foraDaJanela()) return zero('fora_da_janela');

  const agora = Date.now();
  const dry = opts.dry === true;

  // 1) Quem a régua do SIM liberou. O carimbo é a fonte: ele guarda a hora da
  //    liberação, que é o relógio desta cadência.
  const { data: carimbos, error } = await supabase
    .from('system_state').select('key, value, updated_at')
    .like('key', `${EP_LIBERADO_PREFIX}%`).limit(500);
  if (error) {
    logger.error('ep-retorno', 'ler liberados falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }
  const liberados: Liberado[] = (carimbos ?? []).map(m => {
    const v = (m.value ?? {}) as { em?: string; nome?: string | null; quando?: string | null };
    return {
      id: Number(String(m.key).slice(EP_LIBERADO_PREFIX.length)),
      em: String(v.em || m.updated_at || ''),
      nome: v.nome ?? null,
      quando: v.quando ?? null,
    };
  }).filter(l => Number.isInteger(l.id) && l.em && agora - Date.parse(l.em) <= VALIDADE_MS);
  if (!liberados.length) return zero('ninguem_liberado');

  // 2) O que já foi chamado, e quem escreveu depois de perder o horário.
  const [rodadas, falaram] = await Promise.all([
    supabase.from('system_state').select('key').like('key', `${EP_RETORNO_PREFIX}%`).limit(2000),
    supabase.from('system_state').select('key, updated_at').like('key', `${EP_RESPOSTA_PREFIX}%`).limit(1000),
  ]);
  const jaChamado = new Set((rodadas.data ?? []).map(m => String(m.key).slice(EP_RETORNO_PREFIX.length)));
  const respondeuEm = new Map<number, string>((falaram.data ?? []).map(m =>
    [Number(String(m.key).slice(EP_RESPOSTA_PREFIX.length)), String(m.updated_at ?? '')]));

  const candidatos = liberados.filter(l => {
    const rodada = rodadaDevida({
      horasDesdeLiberacao: (agora - Date.parse(l.em)) / 3600_000,
      r1Enviada: jaChamado.has(`${l.id}:r1`),
      r2Enviada: jaChamado.has(`${l.id}:r2`),
    });
    return rodada !== null;
  });
  if (!candidatos.length) return zero('ninguem_no_prazo');

  // 3) A ficha manda: se ela não está mais `cancelado`, a pessoa voltou (pelo
  //    robô de remarcação, pela LP ou pela mão da equipe) e não se chama de volta
  //    quem já voltou.
  const { data: fichasBrutas, error: eFichas } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, vendedor_nome, quando, status, lead_resposta_at')
    .in('id', candidatos.map(c => c.id));
  if (eFichas) {
    logger.error('ep-retorno', 'ler fichas falhou', eFichas);
    return { ...zero('erro_fichas'), erros: 1 };
  }
  const porId = new Map<number, FichaCancelada>(
    ((fichasBrutas ?? []) as unknown as FichaCancelada[]).map(f => [f.id, f]));

  let ofertas = 0, semVaga = 0, voltaram = 0, erros = 0;
  const previa: NonNullable<ResultadoRetorno['previa']> = [];

  for (const l of candidatos) {
    if (ofertas + semVaga >= POR_TICK) break;
    const f = porId.get(l.id);
    if (!f) continue;
    if (f.status !== 'cancelado') { voltaram++; continue; }
    // Escreveu depois de perder o horário: tem conversa em pé, e quem responde é
    // gente (o eletropostoRespostas já levou o recado pro Thiago e pro Diego).
    const falouDepois = (f.lead_resposta_at && f.lead_resposta_at > l.em)
      || ((respondeuEm.get(l.id) ?? '') > l.em);
    if (falouDepois) continue;
    if (!f.vendedor_nome || !f.cliente_telefone) continue;

    const rodada = rodadaDevida({
      horasDesdeLiberacao: (agora - Date.parse(l.em)) / 3600_000,
      r1Enviada: jaChamado.has(`${l.id}:r1`),
      r2Enviada: jaChamado.has(`${l.id}:r2`),
    })!;

    if (dry) {
      previa.push({ id: l.id, cliente: String(f.cliente_nome || '—'), rodada });
      ofertas++;
      continue;
    }

    // CLAIM antes de falar, pelo mesmo motivo da régua do SIM: o cron do GitHub e
    // o da Vercel chamam o mesmo tick, e sem isto a mesma oferta sai duas vezes.
    const nowIso = new Date().toISOString();
    const chave = `${EP_RETORNO_PREFIX}${l.id}:${rodada}`;
    const { error: eClaim } = await supabase.from('system_state')
      .insert({ key: chave, value: { claim: nowIso }, updated_at: nowIso });
    if (eClaim) continue;

    try {
      const r = await ofertarPorConta(
        { id: f.id, cliente_nome: f.cliente_nome, cliente_telefone: f.cliente_telefone,
          vendedor_nome: f.vendedor_nome, quando: f.quando },
        rodada === 'r1' ? bolhasRetorno1 : bolhasRetorno2,
        // `rodada` do estado de oferta: a mesma contagem que o robô de remarcação
        // usa pra parar depois de 2 listas sem escolha.
        { rodada: rodada === 'r1' ? 1 : 2, silencioSemVaga: true, transacional: false },
      );
      if (r.acao === 'ofertou') {
        await supabase.from('system_state').upsert(
          { key: chave, value: { em: new Date().toISOString(), rodada }, updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
        ofertas++;
        logger.info('ep-retorno', `oferta de retorno enviada (${rodada})`, { id: l.id });
      } else {
        // Não saiu (sem vaga na agenda dele, teto da linha ou remarcação
        // desligada): o carimbo tem que sumir, senão a rodada conta sem ninguém
        // ter recebido nada. Tentamos de novo no próximo tick.
        await supabase.from('system_state').delete().eq('key', chave).then(undefined, () => {});
        if (r.acao === 'sem_vaga') semVaga++;
      }
    } catch (e) {
      await supabase.from('system_state').delete().eq('key', chave).then(undefined, () => {});
      logger.error('ep-retorno', 'falha na oferta de retorno', { id: l.id, erro: String(e) });
      erros++;
    }
  }

  if (!dry && (ofertas || semVaga || erros)) {
    logger.info('ep-retorno', 'follow-up de retorno', { ofertas, sem_vaga: semVaga, voltaram, erros });
  }
  return { ofertas, sem_vaga: semVaga, voltaram, erros, ...(dry ? { motivo: 'dry', previa } : {}) };
}
