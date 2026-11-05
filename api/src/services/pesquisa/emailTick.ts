// ─────────────────────────────────────────────────────────────────────────────
// OS E-MAILS DAS PESQUISAS (04/11/2026): a entrevista de saída e o pedido de depoimento. SEM WhatsApp e fora da linha: e-mail não conta
// no teto da 5040. Roda no tick do /cron/master (a Vercel chama de hora em hora no minuto 17; o GitHub, quando consegue) e é seguro chamar em paralelo:
//   · cada pessoa recebe 1 e-mail por tipo, para sempre: o claim `pesquisa_saida_email:<userId>` / `pesquisa_depo_email:<userId>` é por
//     INSERT, ANTES do envio. Falhou o envio: o claim fica marcado `falhou` (não tenta de novo) e o tick para;
//   · o teto de 10 por dia é contado pelos claims desde as 0h de Brasília, nunca pelo número de ticks;
//   · só das 9h às 19h de Brasília; PESQUISA_EMAIL_OFF=1 desliga os dois.
// O link do e-mail leva um token (token.ts) e a chave que o liga à pessoa é gravada ANTES do claim virar `enviado`.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendPesquisaDepoimentoEmail, sendPesquisaSaidaEmail } from '../../utils/mailerPesquisa';
import { liberarChave, reservarChave } from '../agentes5040/cota';
import { primeiroNome } from '../nexus/email';
import { diaBRT } from '../agentes5040/relogio';
import { lerChavesPorPrefixo, lerExAssinantes, lerGrandesUsuarios } from './publico';
import {
  PREFIXO_EMAIL_DEPO, PREFIXO_EMAIL_SAIDA, PREFIXO_RETOMADA_WA, TETO_EMAIL_DIA, dentroDaJanelaDeEmail, podeReceberEmail, recebeuSatisfacaoRecente,
  type UsuarioPesq,
} from './regras';
import { registrarToken, type TipoPesquisa } from './token';

const LOG = 'pesquisa-email';

export interface DepsEmail {
  desligado(): boolean;
  /** Quem pode receber este tipo AGORA (já filtrado pelas regras), do mais indicado para o menos. */
  candidatos(tipo: TipoPesquisa, agora: Date): Promise<UsuarioPesq[]>;
  /** Os ids que já têm claim deste tipo (com a hora em que o claim foi tomado) e os que já responderam. */
  claims(tipo: TipoPesquisa): Promise<Map<string, string | null>>;
  respondeu(tipo: TipoPesquisa): Promise<Set<string>>;
  /** Ids que receberam o WhatsApp da retomada (`usu_rec_sent:`) no dia de Brasília de `agora`. Erro LANÇA. */
  retomadaHoje(agora: Date): Promise<Set<string>>;
  claim(chave: string, valor: Record<string, unknown>, agora: Date): Promise<'ok' | 'ja' | 'erro'>;
  /** Quantas vagas do dia já foram tomadas (só para não ler o público à toa quando o teto já fechou; quem manda é o `tomarVaga`). */
  vagasTomadas(tipo: TipoPesquisa, agora: Date): Promise<number>;
  /** Solta o claim de uma pessoa que não chegou a gastar vaga. */
  soltar(chave: string): Promise<void>;
  /** Toma UMA das 10 vagas do dia (insert em `pesquisa_<tipo>_vaga:<dia BRT>:<n>`, n de 1 a 10). 'cheia' = as 10 já foram tomadas. */
  tomarVaga(tipo: TipoPesquisa, agora: Date): Promise<'ok' | 'cheia' | 'erro'>;
  marcar(chave: string, valor: Record<string, unknown>): Promise<void>;
  gravarToken(userId: string, tipo: TipoPesquisa): Promise<string>;
  enviar(tipo: TipoPesquisa, u: UsuarioPesq, token: string): Promise<void>;
}

export interface ResultadoTipo { tipo: TipoPesquisa; enviados: number; motivo: string | null }

const PREFIXO: Record<TipoPesquisa, string> = { saida: PREFIXO_EMAIL_SAIDA, depoimento: PREFIXO_EMAIL_DEPO };

async function rodarTipo(tipo: TipoPesquisa, agora: Date, d: DepsEmail): Promise<ResultadoTipo> {
  const r: ResultadoTipo = { tipo, enviados: 0, motivo: null };
  const prefixo = PREFIXO[tipo];
  let claims: Map<string, string | null>;
  try { claims = await d.claims(tipo); } catch { return { ...r, motivo: 'leitura_dos_claims_falhou' }; }

  try { if ((await d.vagasTomadas(tipo, agora)) >= TETO_EMAIL_DIA) return { ...r, motivo: 'teto_do_dia' }; } catch { return { ...r, motivo: 'leitura_das_vagas_falhou' }; }

  let lista: UsuarioPesq[];
  let responderam: Set<string>;
  let retomada = new Set<string>();
  try {
    [lista, responderam] = await Promise.all([d.candidatos(tipo, agora), d.respondeu(tipo)]);
    // A entrevista de saída pelo e-mail não sai no dia em que a retomada já falou com a pessoa pelo WhatsApp (o sentido inverso da retomada).
    if (tipo === 'saida') retomada = await d.retomadaHoje(agora);
  } catch { return { ...r, motivo: 'leitura_do_publico_falhou' }; }

  for (const u of lista) {
    if (claims.has(u.id) || responderam.has(u.id) || retomada.has(u.id)) continue;
    const chave = `${prefixo}${u.id}`;
    const tomou = await d.claim(chave, { user_id: u.id, tipo, estado: 'reservado' }, agora);
    if (tomou === 'ja') continue;
    if (tomou === 'erro') { r.motivo = 'erro_no_claim'; break; }
    // O teto de 10 por dia é ATÔMICO: a vaga é um insert, então dois ticks ao mesmo tempo nunca passam de 10 juntos. Sem vaga, solta o claim e para.
    const vaga = await d.tomarVaga(tipo, agora);
    if (vaga !== 'ok') {
      await d.soltar(chave);
      r.motivo = vaga === 'cheia' ? 'teto_do_dia' : 'erro_na_vaga';
      break;
    }
    try {
      const token = await d.gravarToken(u.id, tipo);
      await d.enviar(tipo, u, token);
      await d.marcar(chave, { user_id: u.id, tipo, estado: 'enviado', em: agora.toISOString() });
      r.enviados++;
    } catch (e) {
      // O claim fica (1 vez por pessoa) e o tick para: erro de envio costuma ser do provedor, não da pessoa.
      await d.marcar(chave, { user_id: u.id, tipo, estado: 'falhou', em: agora.toISOString() });
      logger.error(LOG, `${tipo}: envio falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
      r.motivo = 'envio_falhou';
      break;
    }
  }
  return r;
}

export async function rodarEmailsPesquisa(opts: { agora?: Date } = {}, deps?: DepsEmail): Promise<{ ok: boolean; motivo: string | null; saida?: ResultadoTipo; depoimento?: ResultadoTipo }> {
  const agora = opts.agora ?? new Date();
  const d = deps ?? depsReaisEmail();
  if (d.desligado()) return { ok: true, motivo: 'desligado' };
  if (!dentroDaJanelaDeEmail(agora)) return { ok: true, motivo: 'fora_da_janela' };
  const saida = await rodarTipo('saida', agora, d).catch((e) => ({ tipo: 'saida' as const, enviados: 0, motivo: `falhou:${String((e as Error)?.message ?? e).slice(0, 40)}` }));
  const depoimento = await rodarTipo('depoimento', agora, d).catch((e) => ({ tipo: 'depoimento' as const, enviados: 0, motivo: `falhou:${String((e as Error)?.message ?? e).slice(0, 40)}` }));
  return { ok: true, motivo: null, saida, depoimento };
}

export function depsReaisEmail(): DepsEmail {
  return {
    desligado: () => process.env.PESQUISA_EMAIL_OFF === '1',
    async candidatos(tipo, agora) {
      if (tipo === 'saida') return lerExAssinantes(agora);
      const agoraMs = agora.getTime();
      return (await lerGrandesUsuarios(agora)).map(g => g.u).filter(u => podeReceberEmail(u) && !recebeuSatisfacaoRecente(u, agoraMs));
    },
    async claims(tipo) {
      const m = await lerChavesPorPrefixo(PREFIXO[tipo]);
      const out = new Map<string, string | null>();
      for (const [id, v] of m) out.set(id, typeof v.value?.em === 'string' ? v.value.em : v.updated_at);
      return out;
    },
    async retomadaHoje(agora) {
      const hoje = diaBRT(agora);
      const out = new Set<string>();
      for (const v of (await lerChavesPorPrefixo(PREFIXO_RETOMADA_WA)).values()) {
        const id = typeof v.value?.user_id === 'string' ? v.value.user_id : '';
        const em = typeof v.value?.em === 'string' ? v.value.em : v.updated_at;
        if (id && em && diaBRT(em) === hoje) out.add(id);
      }
      return out;
    },
    async respondeu(tipo) {
      return new Set((await lerChavesPorPrefixo(`pesquisa_${tipo}:`)).keys());
    },
    claim: async (chave, valor, agora) => {
      const v = await reservarChave(chave, valor, agora);
      return v === 'reservada' ? 'ok' : v === 'ja_existe' ? 'ja' : 'erro';
    },
    async marcar(chave, valor) {
      try { await supabase.from('system_state').update({ value: valor, updated_at: new Date().toISOString() }).eq('key', chave); } catch { /* o claim já vale */ }
    },
    soltar: (chave) => liberarChave(chave),
    async vagasTomadas(tipo, agora) { return (await lerChavesPorPrefixo(`pesquisa_${tipo}_vaga:${diaBRT(agora)}:`)).size; },
    async tomarVaga(tipo, agora) {
      const dia = diaBRT(agora);
      for (let n = 1; n <= TETO_EMAIL_DIA; n++) {
        const v = await reservarChave(`pesquisa_${tipo}_vaga:${dia}:${n}`, {}, agora);
        if (v === 'reservada') return 'ok';
        if (v === 'erro') return 'erro';
      }
      return 'cheia';
    },
    gravarToken: (userId, tipo) => registrarToken(userId, tipo),
    enviar: (tipo, u, token) => {
      const o = { to: String(u.email), userId: u.id, nome: primeiroNome(u.nome) || null, token };
      return tipo === 'saida' ? sendPesquisaSaidaEmail(o) : sendPesquisaDepoimentoEmail(o);
    },
  };
}
