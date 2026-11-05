// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): a CHAVE de ligar e desligar as mensagens, um grupo por vez.
//
// Mora no `system_state` principal, linha `jornada_solar_mensagens`, ASSINADA por HMAC (a chave pública do banco alcança a tabela e pode
// escrever nela: linha sem assinatura válida vale "tudo desligado"). Fica FORA de `jornada_solar_ajustes`: mudar o normalizador dos
// Ajustes invalidaria a assinatura que já existe e as comissões voltariam ao padrão.
//
// Os cinco grupos nascem DESLIGADOS. O grupo do cliente só liga com os três da equipe ligados há 24 h ou mais (a ordem de ligar é do
// servidor). Nada pessoal aqui: só nome de quem ligou e instantes. Serviço: não importa rota, não envia nada, não loga dado pessoal.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { ErroJornada } from './jornadaSolarBanco';
import { segredoDoVinculo } from './vendaSolarHub';
import { nomeSimples } from './solarObras';
import { GRUPOS_CLIENTE, GRUPOS_EQUIPE, GRUPOS_MSG, type GrupoMsg } from '../io/jornadaMensagensPuro';

export const CHAVE_MSGS = 'jornada_solar_mensagens';
export const ESPERA_DO_CLIENTE_MS = 24 * 3600_000;

export interface EstadoGrupo { ligado: boolean; ligado_em: string | null; primeiro_ligado_em: string | null; por: string }
export interface ChaveMsgs {
  v: 1;
  grupos: Record<GrupoMsg, EstadoGrupo>;
  historico: Array<{ em: string; por: string; grupo: GrupoMsg; ligado: boolean }>;
}

const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const dataIso = (v: unknown): string | null =>
  (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v.trim()) ? v.trim() : null);
const nome = (v: unknown): string => (typeof v === 'string' ? nomeSimples(v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60)).slice(0, 60) : '');

const grupoVazio = (): EstadoGrupo => ({ ligado: false, ligado_em: null, primeiro_ligado_em: null, por: '' });
export const chaveVazia = (): ChaveMsgs => ({
  v: 1,
  grupos: { venda: grupoVazio(), etapa: grupoVazio(), fila: grupoVazio(), liberacao: grupoVazio(), aniversario: grupoVazio() },
  historico: [],
});

/** O normalizado, com as chaves escritas à mão em TODO nível (o jsonb do Postgres guarda a ordem que quiser). Null quando o formato não vale. */
export function normalizarMensagens(value: unknown): ChaveMsgs | null {
  const v = obj(value);
  if (!v || v.v !== 1) return null;
  const g = obj(v.grupos) ?? {};
  const um = (k: GrupoMsg): EstadoGrupo => {
    const o = obj(g[k]) ?? {};
    const em = dataIso(o.ligado_em);
    const primeiro = dataIso(o.primeiro_ligado_em);
    // Ligado sem instante não vale: sem `ligado_em` nada pode disparar.
    const ligado = o.ligado === true && !!em;
    return { ligado, ligado_em: em, primeiro_ligado_em: primeiro ?? (ligado ? em : null), por: nome(o.por) };
  };
  const hist = (Array.isArray(v.historico) ? v.historico : []).flatMap((x) => {
    const o = obj(x);
    const em = o ? dataIso(o.em) : null;
    const grupo = o && (GRUPOS_MSG as readonly string[]).includes(String(o.grupo)) ? (o.grupo as GrupoMsg) : null;
    return o && em && grupo ? [{ em, por: nome(o.por), grupo, ligado: o.ligado === true }] : [];
  });
  return {
    v: 1,
    grupos: { venda: um('venda'), etapa: um('etapa'), fila: um('fila'), liberacao: um('liberacao'), aniversario: um('aniversario') },
    historico: hist.slice(-30),
  };
}

/** HMAC de `jornada_msgs|JSON` do normalizado, ou null sem segredo ou sem formato válido. */
export function assinarMensagens(m: unknown): string | null {
  const segredo = segredoDoVinculo();
  const n = normalizarMensagens(m);
  if (!segredo || !n) return null;
  return crypto.createHmac('sha256', segredo).update(`jornada_msgs|${JSON.stringify(n)}`).digest('hex');
}

/** O normalizado de um `value` SE a assinatura confere; senão null. */
export function mensagensAssinadas(value: unknown): ChaveMsgs | null {
  const n = normalizarMensagens(value);
  const esperada = n ? assinarMensagens(n) : null;
  const sig = obj(value)?.sig;
  if (n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8'))) return n;
  return null;
}

/** `valida`: a linha existe e a assinatura confere. Sem linha, ou com assinatura inválida, `m` é a chave toda desligada. */
export async function lerMensagens(): Promise<{ m: ChaveMsgs; valida: boolean; versao: string | null }> {
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', CHAVE_MSGS).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  if (!l) return { m: chaveVazia(), valida: true, versao: null };
  const m = mensagensAssinadas(l.value);
  return { m: m ?? chaveVazia(), valida: !!m, versao: l.updated_at ?? '' };
}

/** A regra D7: o cliente só liga com os três da equipe ligados há 24 h ou mais. */
export function equipeLigadaHa24h(m: ChaveMsgs, agora: Date): boolean {
  return GRUPOS_EQUIPE.every((g) => {
    const e = m.grupos[g];
    const t = e.ligado && e.ligado_em ? Date.parse(e.ligado_em) : NaN;
    return Number.isFinite(t) && agora.getTime() - t >= ESPERA_DO_CLIENTE_MS;
  });
}

/**
 * Liga ou desliga UM grupo, com compare-and-swap pelo `updated_at` (até 4 voltas). Ligar grava `ligado_em` agora e mantém o
 * `primeiro_ligado_em`; desligar mantém os dois. Grupo do cliente sem a equipe ligada há 24 h: `ErroJornada('ordem')` (a conferência
 * é DENTRO da volta, sobre o que foi lido naquela volta). Linha com assinatura inválida: `ErroJornada('assinatura')`, nada se grava por cima.
 */
export async function gravarGrupo(grupo: GrupoMsg, ligado: boolean, por: string, agora: Date): Promise<ChaveMsgs> {
  if (!segredoDoVinculo()) throw new ErroJornada('sem_segredo');
  for (let t = 0; t < 4; t++) {
    const { m, valida, versao } = await lerMensagens();
    if (!valida) throw new ErroJornada('assinatura');
    if (ligado && (GRUPOS_CLIENTE as readonly string[]).includes(grupo) && !equipeLigadaHa24h(m, agora)) throw new ErroJornada('ordem');
    const em = agora.toISOString();
    const antes = m.grupos[grupo];
    const novoGrupo: EstadoGrupo = ligado
      ? { ligado: true, ligado_em: em, primeiro_ligado_em: antes.primeiro_ligado_em ?? em, por: nome(por) }
      : { ...antes, ligado: false, por: nome(por) };
    const novo: ChaveMsgs = {
      v: 1,
      grupos: { ...m.grupos, [grupo]: novoGrupo },
      historico: [...m.historico, { em, por: nome(por), grupo, ligado }].slice(-30),
    };
    const n = normalizarMensagens(novo);
    const sig = n ? assinarMensagens(n) : null;
    if (!n || !sig) throw new ErroJornada('sem_segredo');
    const value = { ...n, sig };
    if (versao === null) {
      const { error } = await supabase.from('system_state').insert({ key: CHAVE_MSGS, value, updated_at: em });
      if (!error) return n;
      if (codigoDe(error) !== '23505') throw new ErroJornada(codigoDe(error));
      continue;
    }
    const alvo = supabase.from('system_state').update({ value, updated_at: em }).eq('key', CHAVE_MSGS);
    const { data, error } = await (versao === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versao)).select('key');
    if (error) throw new ErroJornada(codigoDe(error));
    if (Array.isArray(data) && data.length > 0) return n;
  }
  throw new ErroJornada('ocupado');
}

/**
 * O `ligado_em` de cada grupo LIGADO (null quando desligado). Com `JORNADA_MSG_OFF=1`, todos null (desliga os cinco sem deploy). Sem
 * `valida`, quem chama passa a chave vazia, que já vem toda desligada.
 */
export function ligadosAgora(m: ChaveMsgs, env: NodeJS.ProcessEnv = process.env): Record<GrupoMsg, string | null> {
  const fora = env.JORNADA_MSG_OFF === '1';
  const por = (g: GrupoMsg): string | null => (!fora && m.grupos[g].ligado ? m.grupos[g].ligado_em : null);
  return { venda: por('venda'), etapa: por('etapa'), fila: por('fila'), liberacao: por('liberacao'), aniversario: por('aniversario') };
}
