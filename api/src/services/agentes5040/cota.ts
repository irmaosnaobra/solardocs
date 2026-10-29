// ─────────────────────────────────────────────────────────────────────────────
// COTA DO ENSAIO E DO REPLAY. O saldo da Anthropic já zerou 4 vezes: o ensaio nunca pode ser
// o motivo de a produção emudecer.
//
//  · Teto de chamadas à IA por dia de Brasília: AGENTES5040_TETO_VIVO (padrão 120, o ensaio sombra),
//    AGENTES5040_TETO_REPLAY (padrão 120) e AGENTES5040_TETO_RESPOSTA (padrão 300, a rodada viva, cota própria). Cada CHAMADA REAL ao modelo reserva uma vaga antes de
//    sair (um pensar chega a 4 chamadas: principal, reserva, e o dobro numa reescrita).
//  · A vaga é uma linha de system_state, ag5040_ia:<tipo>:<dia>:<n>, reservada por INSERT (a chave
//    única decide a corrida; 23505 tenta a próxima). Sem telefone, nome ou texto.
//  · Disjuntor ag5040_disjuntor: erro de crédito ou de chave da Anthropic abre, e o ensaio para.
//    FECHA SOZINHO depois de DISJUNTOR_MINUTOS (60); para fechar antes, apague a chave em system_state
//    (fecharDisjuntor). NUNCA grava `ia_falha:*` (esse estado vira os robôs ao vivo para humano).
//  · Ligar e desligar: interruptores.ts (ligado('ensaio'), ligado('replay')), fora deste arquivo.
//  · Faxina: linhas ag5040_ia:, ag5040_lock:, ag5040_vez:, ag5040_vez_vivo: e outras com mais de 7 dias, uma vez por dia.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { classificarFalhaIA, type ClienteIA } from './ia';
import { diaBRT } from './relogio';

/** 'dry' = a sonda (?dry=1): teto PRÓPRIO por dia, para uma sonda esquecida num loop não comer a cota do vivo nem a do replay. */
export type TipoCota = 'vivo' | 'replay' | 'dry' | 'resposta' | 'qualidade';

export const CHAVE_DISJUNTOR = 'ag5040_disjuntor';
export const DISJUNTOR_MINUTOS = 60;
export const TETO_PADRAO = 120;
export const TETO_DRY_PADRAO = 10;
/** Teto da rodada viva (tipo 'resposta'): AGENTES5040_TETO_RESPOSTA. Cota própria, separada da do ensaio sombra. */
export const TETO_RESPOSTA_PADRAO = 300;
/** Teto da nota diária das conversas (tipo 'qualidade'): AGENTES5040_TETO_QUALIDADE. Uma chamada por conversa. */
export const TETO_QUALIDADE_PADRAO = 30;
const DIAS_DA_FAXINA = 7;
const PAGINA = 1000;
const MAX_TENTATIVAS = 8;

/** Teto do dia. Env inválida, zero ou negativa volta ao padrão (teto zero seria "desligado" calado). */
export function tetoDe(tipo: TipoCota): number {
  const env = tipo === 'vivo' ? 'AGENTES5040_TETO_VIVO' : tipo === 'replay' ? 'AGENTES5040_TETO_REPLAY'
    : tipo === 'resposta' ? 'AGENTES5040_TETO_RESPOSTA' : tipo === 'qualidade' ? 'AGENTES5040_TETO_QUALIDADE' : 'AGENTES5040_TETO_DRY';
  const bruto = Number(String(process.env[env] ?? '').trim());
  return Number.isInteger(bruto) && bruto > 0 ? bruto
    : tipo === 'dry' ? TETO_DRY_PADRAO : tipo === 'resposta' ? TETO_RESPOSTA_PADRAO : tipo === 'qualidade' ? TETO_QUALIDADE_PADRAO : TETO_PADRAO;
}

const prefixoDaCota = (tipo: TipoCota, dia: string): string => `ag5040_ia:${tipo}:${dia}:`;
const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? '');

// ── reservas por insert ──────────────────────────────────────────────────────

export type Reserva = 'reservada' | 'ja_existe' | 'erro';

/** Reserva uma chave por INSERT. A chave única decide quem ganha a corrida. */
export async function reservarChave(chave: string, valor: Record<string, unknown>, agora: Date): Promise<Reserva> {
  try {
    const { error } = await supabase.from('system_state')
      .insert({ key: chave, value: { ...valor, em: agora.toISOString() }, updated_at: agora.toISOString() });
    if (!error) return 'reservada';
    return codigoDe(error) === '23505' ? 'ja_existe' : 'erro';
  } catch {
    return 'erro';
  }
}

/** Solta uma reserva nossa (a rodada falhou por motivo de infraestrutura e a mensagem pode ser tentada de novo). */
export async function liberarChave(chave: string): Promise<void> {
  try { await supabase.from('system_state').delete().eq('key', chave); } catch { /* a faxina leva em 7 dias */ }
}

/** Quais destas chaves já existem. Erro de leitura sobe (quem chama trata como "não sei" e não gasta). */
export async function chavesExistentes(chaves: readonly string[]): Promise<Set<string>> {
  const achadas = new Set<string>();
  for (let i = 0; i < chaves.length; i += 100) {
    const lote = chaves.slice(i, i + 100);
    const { data, error } = await supabase.from('system_state').select('key').in('key', lote);
    if (error) throw new Error('leitura de reservas falhou');
    for (const r of (data ?? []) as Array<{ key: string }>) achadas.add(r.key);
  }
  return achadas;
}

// ── a cota ───────────────────────────────────────────────────────────────────

export type ResultadoReserva = { ok: true; n: number } | { ok: false; motivo: 'teto' | 'erro' };

/** Quantas vagas do dia já foram reservadas. */
async function vagasUsadas(tipo: TipoCota, dia: string): Promise<number> {
  const { count, error } = await supabase.from('system_state')
    .select('key', { count: 'exact', head: true }).like('key', `${prefixoDaCota(tipo, dia)}%`);
  if (error) throw new Error('contagem da cota falhou');
  return count ?? 0;
}

/**
 * Reserva UMA chamada à IA do dia. Parte da contagem de linhas do dia (não de 1) e tenta a próxima no
 * 23505. Passou do teto = { ok:false, motivo:'teto' }; erro de banco = 'erro' (quem chama NÃO chama o modelo).
 */
export async function reservarChamada(tipo: TipoCota, agora: Date): Promise<ResultadoReserva> {
  try {
    const dia = diaBRT(agora);
    if (!dia) return { ok: false, motivo: 'erro' };
    const teto = tetoDe(tipo);
    const base = await vagasUsadas(tipo, dia);
    for (let i = 0; i < MAX_TENTATIVAS; i++) {
      const n = base + 1 + i;
      if (n > teto) return { ok: false, motivo: 'teto' };
      const r = await reservarChave(`${prefixoDaCota(tipo, dia)}${n}`, { tipo }, agora);
      if (r === 'reservada') return { ok: true, n };
      if (r === 'erro') return { ok: false, motivo: 'erro' };
    }
    return { ok: false, motivo: 'erro' };
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

// ── disjuntor ────────────────────────────────────────────────────────────────

export async function abrirDisjuntor(causa: string, agora: Date, minutos = DISJUNTOR_MINUTOS): Promise<void> {
  try {
    const ate = new Date(agora.getTime() + minutos * 60_000).toISOString();
    await supabase.from('system_state').upsert(
      { key: CHAVE_DISJUNTOR, value: { causa, aberto_em: agora.toISOString(), ate }, updated_at: agora.toISOString() },
      { onConflict: 'key' },
    );
  } catch { /* sem como gravar: o erro volta na próxima chamada e o disjuntor tenta de novo */ }
}

/** Aberto? Erro de leitura conta como ABERTO (sem banco o ensaio não anda de qualquer jeito). */
export async function disjuntorAberto(agora: Date): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_DISJUNTOR).maybeSingle();
    if (error) return true;
    if (!data) return false;
    const ate = Date.parse(String((data as { value?: { ate?: string } }).value?.ate ?? ''));
    return Number.isFinite(ate) ? agora.getTime() < ate : true;
  } catch {
    return true;
  }
}

export async function fecharDisjuntor(): Promise<void> {
  await supabase.from('system_state').delete().eq('key', CHAVE_DISJUNTOR);
}

// ── o cliente que conta ──────────────────────────────────────────────────────

export interface EstadoCota {
  /** Chamadas que de fato saíram para a Anthropic. */
  chamadas: number;
  /** Por que a rodada deve parar (nenhuma conversa nova): teto do dia, disjuntor ou erro de cota. */
  parou: null | 'teto' | 'disjuntor' | 'erro' | 'prazo';
}

/** Menor tempo restante que ainda vale abrir uma chamada ao modelo. */
const RESTANTE_MINIMO_MS = 5_000;
const TIMEOUT_PADRAO_MS = 60_000;

/**
 * Embrulha o cliente da IA: cada `messages.create` reserva uma vaga ANTES de sair (sem vaga ou com
 * disjuntor aberto, lança sem chamar a API) e erro de crédito ou de chave abre o disjuntor.
 * Os erros da guarda dizem "billing" de propósito: o classificarFalhaIA lê como crédito e o `ia.ts`
 * não gasta a chamada da reserva à toa.
 */
export function clienteComCota(
  tipo: TipoCota, agora: () => Date, base: ClienteIA, prazoFinalMs?: number,
): { cliente: ClienteIA; estado: EstadoCota } {
  const estado: EstadoCota = { chamadas: 0, parou: null };
  const cliente: ClienteIA = {
    messages: {
      async create(body: any, opts?: any) {
        // Prazo da rodada (relógio de verdade): a função da Vercel morre aos 300 s. Cada chamada leva só o
        // tempo que sobra (no máximo o timeout dela) e, sem tempo, nem sai.
        let opcoes = opts;
        if (prazoFinalMs !== undefined) {
          const restante = prazoFinalMs - Date.now();
          if (restante < RESTANTE_MINIMO_MS) {
            estado.parou ??= 'prazo';
            throw new Error('ensaio billing guard: prazo da rodada');
          }
          opcoes = { ...(opts ?? {}), timeout: Math.min(Number(opts?.timeout) || TIMEOUT_PADRAO_MS, restante) };
        }
        if (await disjuntorAberto(agora())) {
          estado.parou ??= 'disjuntor';
          throw new Error('ensaio billing guard: disjuntor aberto');
        }
        const r = await reservarChamada(tipo, agora());
        if (!r.ok) {
          estado.parou ??= r.motivo === 'teto' ? 'teto' : 'erro';
          throw new Error(`ensaio billing guard: ${r.motivo}`);
        }
        try {
          const resposta = await base.messages.create(body, opcoes);
          estado.chamadas++;
          return resposta;
        } catch (e) {
          estado.chamadas++;
          const causa = classificarFalhaIA(String((e as { message?: string })?.message ?? e));
          if (causa === 'ia_sem_credito' || causa === 'ia_chave') {
            await abrirDisjuntor(causa, agora());
            estado.parou ??= 'disjuntor';
          }
          throw e;
        }
      },
    },
  };
  return { cliente, estado };
}

// ── faxina ───────────────────────────────────────────────────────────────────

const PREFIXOS_DA_FAXINA = ['ag5040_ia:', 'ag5040_lock:', 'ag5040_vez:', 'ag5040_vez_vivo:', 'ag5040_faxina:', 'ag5040_tent:'] as const;

/**
 * Conta a tentativa de um turno que falhou por motivo de infraestrutura SEM ser crédito/chave/teto (400, timeout,
 * limite de taxa). 1 = primeira falha (tente de novo na próxima rodada); 2 = segunda (grave o turno como falhou).
 * Reserva `ag5040_tent:<waId>` por insert: sem dado pessoal. Erro de banco conta como primeira (não grava "falhou" à toa).
 */
export async function registrarTentativa(waId: number, agora: Date): Promise<1 | 2> {
  const r = await reservarChave(`ag5040_tent:${waId}`, {}, agora);
  return r === 'ja_existe' ? 2 : 1;
}

/**
 * Apaga as reservas com mais de 7 dias (a data está em `value.em`). Roda no máximo uma vez por dia
 * (reserva ag5040_faxina:<dia>). Nunca lança. Devolve quantas apagou.
 */
export async function faxinar(agora: Date): Promise<number> {
  try {
    const dia = diaBRT(agora);
    if (!dia || (await reservarChave(`ag5040_faxina:${dia}`, {}, agora)) !== 'reservada') return 0;
    const corte = agora.getTime() - DIAS_DA_FAXINA * 86_400_000;
    let apagadas = 0;
    for (const prefixo of PREFIXOS_DA_FAXINA) {
      const velhas: string[] = [];
      for (let p = 0; p < 20; p++) {
        const { data, error } = await supabase.from('system_state').select('key, value')
          .like('key', `${prefixo}%`).order('key', { ascending: true }).range(p * PAGINA, p * PAGINA + PAGINA - 1);
        if (error) break;
        const lote = (data ?? []) as Array<{ key: string; value: { em?: string } | null }>;
        for (const r of lote) {
          const em = Date.parse(String(r.value?.em ?? ''));
          if (Number.isFinite(em) && em < corte) velhas.push(r.key);
        }
        if (lote.length < PAGINA) break;
      }
      for (let i = 0; i < velhas.length; i += 100) {
        const lote = velhas.slice(i, i + 100);
        const { error } = await supabase.from('system_state').delete().in('key', lote);
        if (!error) apagadas += lote.length;
      }
    }
    return apagadas;
  } catch {
    return 0;
  }
}
