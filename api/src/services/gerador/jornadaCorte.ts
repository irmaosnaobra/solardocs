// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, VENDAS FINALIZADAS (05/11/2026). Por ordem do dono, os clientes que já existiam passam a aparecer como FINALIZADOS:
// "trata todos os clientes existentes hoje como finalizados, não vamos corrigir todos e vamos organizar de hoje pra frente".
//
//   - O CORTE: o momento da primeira leitura depois do deploy, gravado UMA vez em `system_state`, chave `jornada_corte`, por INSERT com chave
//     única (nunca upsert) e assinado como as outras linhas `jornada_*` (a chave pública do banco escreve naquela tabela). Daí em diante vale o gravado.
//   - FINALIZADA = venda solar vendida antes do corte, sem trabalho de gente na jornada até o corte. Nada é gravado por venda: é uma conta.
//   - A venda com evento de etapa de GENTE até o corte continua ativa. Evento depois do corte NÃO a reabre (efeito colateral de upload, Trello ou
//     número não pode devolver uma venda antiga à cobrança): só o "Trazer para a jornada" do ADM, que grava o evento `trazida`.
//
// Serviço puro de rota (sem importar rota). Nada aqui põe nome, telefone ou valor em log.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { segredoDoVinculo } from './vendaSolarHub';
import { ErroJornada, lerJornadaComVersao } from './jornadaSolarBanco';
import { lerObraComVersao } from './jornadaObraBanco';
import { POR_QUE_NAO_E_GENTE, type EstadoJornada } from './jornadaSolar';
import type { EstadoObra } from './jornadaObra';

export const CHAVE_CORTE = 'jornada_corte';

/** `JORNADA_FINALIZADAS_OFF=1` desliga a regra inteira (ninguém é finalizada e o corte nem é lido): tudo volta a como era antes. Lido a cada chamada. */
export const finalizadasDesligadas = (): boolean => process.env.JORNADA_FINALIZADAS_OFF === '1';

/** Ações do histórico que NÃO são trabalho de etapa (efeito de sistema): não seguram a venda na jornada. */
const ACOES_QUE_NAO_SAO_ETAPA: ReadonlySet<string> = new Set(['materializada', 'numero', 'numero_falhou', 'venda_completa']);

const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

// ── A conta pura ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A venda é FINALIZADA? `corteMs` é o corte em milissegundos. Sem estado nenhum, é finalizada (a venda nova sempre nasce com estado, pela rota
 * "Vendido"). Estado com a marca `trazida`, ou vendido depois do corte, ou com evento de GENTE até o corte: ativa.
 */
export function ehFinalizada(js: EstadoJornada | null, jo: EstadoObra | null, corteMs: number): boolean {
  if (finalizadasDesligadas()) return false;
  if (!js && !jo) return true;
  if (js?.historico.some((h) => h.acao === 'trazida')) return false;
  const vendido = js?.vendido_em ? Date.parse(js.vendido_em) : NaN;
  if (Number.isFinite(vendido) && vendido > corteMs) return false;
  const eventos = [...(js?.historico ?? []), ...(jo?.historico ?? [])];
  for (const h of eventos) {
    if (ACOES_QUE_NAO_SAO_ETAPA.has(h.acao) || POR_QUE_NAO_E_GENTE.has(h.por)) continue;
    const t = Date.parse(h.em);
    if (Number.isFinite(t) && t <= corteMs) return false;
  }
  return true;
}

// ── O corte gravado ─────────────────────────────────────────────────────────────────────────────────────────────────

export function assinarCorte(em: string): string | null {
  const segredo = segredoDoVinculo();
  return segredo ? crypto.createHmac('sha256', segredo).update(`corte|${em}`).digest('hex') : null;
}

/** O corte do `value` do banco SE a assinatura confere; senão null. */
export function corteAssinado(value: unknown): number | null {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const em = o && typeof o.em === 'string' ? o.em : '';
  const t = Date.parse(em);
  const esperada = Number.isFinite(t) ? assinarCorte(em) : null;
  const sig = o?.sig;
  if (!esperada || typeof sig !== 'string' || sig.length !== esperada.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8')) ? t : null;
}

let guardado: number | null = null;
let voando: Promise<number> | null = null;
/** Para os testes. */
export function reiniciarCorte(): void { guardado = null; voando = null; }

async function lerLinha(): Promise<unknown | undefined> {
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', CHAVE_CORTE).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  return data ? (data as { value?: unknown }).value ?? null : undefined;
}

async function lerOuGravar(): Promise<number> {
  for (let volta = 0; volta < 3; volta++) {
    const lida = await lerLinha();
    if (lida !== undefined) {
      const t = corteAssinado(lida);
      if (t === null) throw new ErroJornada('corte_invalido');
      return t;
    }
    if (!segredoDoVinculo()) throw new ErroJornada('sem_segredo');
    const em = new Date().toISOString();
    const sig = assinarCorte(em);
    if (!sig) throw new ErroJornada('sem_segredo');
    const { error } = await supabase.from('system_state').insert({ key: CHAVE_CORTE, value: { v: 1, em, sig }, updated_at: em });
    if (!error) return Date.parse(em);
    // Perdeu a corrida (chave única): lê o que o outro gravou. Qualquer outro erro lança.
    if (codigoDe(error) !== '23505') throw new ErroJornada(codigoDe(error));
  }
  throw new ErroJornada('corte_ocupado');
}

/**
 * O corte em milissegundos. Preguiçoso (nunca no boot), com uma leitura só por vez no processo; só guarda em memória depois de ler ou gravar com
 * sucesso. Falha lança `ErroJornada`: quem chama trata como "não sei" (robô não envia; rota de escrita não grava).
 */
export async function lerCorte(): Promise<number> {
  if (finalizadasDesligadas()) return 0;
  if (guardado !== null) return guardado;
  if (!voando) {
    voando = lerOuGravar().then((t) => { guardado = t; return t; }).finally(() => { voando = null; });
  }
  return voando;
}

/** Esta venda é finalizada agora? Lê o corte e os dois estados (a da Fase 1 e a das etapas 4 a 8). Falha de leitura lança. */
export async function obraFinalizada(card: number): Promise<boolean> {
  if (finalizadasDesligadas()) return false;
  const [corte, { estado: js }, { estado: jo }] = await Promise.all([lerCorte(), lerJornadaComVersao(card), lerObraComVersao(card)]);
  return ehFinalizada(js, jo, corte);
}

export const MSG_FINALIZADA = 'Esta venda está finalizada. Ela abre só para leitura; o administrador pode trazê-la para a jornada.';
