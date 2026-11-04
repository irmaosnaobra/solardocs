// ─────────────────────────────────────────────────────────────────────────────
// AS RESPOSTAS DAS PESQUISAS (04/11/2026): o que o formulário aceita, onde grava, quem é avisado e como o admin lê.
// Gravação: system_state, chave `pesquisa_<tipo>:<userId>`, upsert (a última resposta vale), com `em`. Aviso ao Thiago pelo
// sendOpsAlert, com o texto escapado (a entrada é pública). Depoimento diz se veio COM autorização: é com ela que ele publica.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { sendOpsAlert } from '../../utils/mailer';
import { logger } from '../../utils/logger';
import { chaveResposta, type TipoPesquisa } from './token';

export const MAX_CAMPO = 1000;

export const CAMPOS_SAIDA = ['porque', 'critica', 'voltaria'] as const;
export const CAMPOS_DEPOIMENTO = ['mudou', 'frase', 'nome', 'empresa', 'cidade'] as const;

export type DadosSaida = Record<typeof CAMPOS_SAIDA[number], string>;
export type DadosDepoimento = Record<typeof CAMPOS_DEPOIMENTO[number], string> & { autorizo: boolean };
export type DadosPesquisa = DadosSaida | DadosDepoimento;

export type Validacao<T> = { ok: true; dados: T } | { ok: false; erro: string };

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function campo(corpo: Record<string, unknown>, nome: string): { ok: true; v: string } | { ok: false; erro: string } {
  const bruto = corpo[nome];
  if (bruto === undefined || bruto === null) return { ok: true, v: '' };
  if (typeof bruto !== 'string') return { ok: false, erro: `O campo "${nome}" precisa ser um texto.` };
  const v = bruto.replace(CONTROLE, '').trim();
  if (v.length > MAX_CAMPO) return { ok: false, erro: `O campo "${nome}" passa de ${MAX_CAMPO} caracteres.` };
  return { ok: true, v };
}

export function validarResposta(tipo: TipoPesquisa, corpo: unknown): Validacao<DadosPesquisa> {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, erro: 'Corpo inválido.' };
  const c = corpo as Record<string, unknown>;
  const nomes: readonly string[] = tipo === 'saida' ? CAMPOS_SAIDA : CAMPOS_DEPOIMENTO;
  const dados: Record<string, string> = {};
  for (const n of nomes) {
    const r = campo(c, n);
    if (!r.ok) return r;
    dados[n] = r.v;
  }
  if (tipo === 'saida') {
    if (!CAMPOS_SAIDA.some(n => dados[n])) return { ok: false, erro: 'Responda pelo menos uma das 3 perguntas.' };
    return { ok: true, dados: dados as DadosSaida };
  }
  if (!dados.frase && !dados.mudou) return { ok: false, erro: 'Escreva o seu depoimento.' };
  const a = c.autorizo;
  if (a !== undefined && a !== null && typeof a !== 'boolean') return { ok: false, erro: 'O campo "autorizo" precisa ser verdadeiro ou falso.' };
  return { ok: true, dados: { ...(dados as Omit<DadosDepoimento, 'autorizo'>), autorizo: a === true } };
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');

// ── quem é a pessoa (para preencher o formulário e para o aviso) ─────────────

export interface ContextoPesquisa { nome: string; empresa: string; cidade: string; email: string }

export async function lerContexto(userId: string): Promise<ContextoPesquisa | null> {
  const { data: u, error } = await supabase.from('users').select('nome, email').eq('id', userId).maybeSingle();
  if (error || !u) return null;
  const { data: c } = await supabase.from('company').select('nome, nome_fantasia, cidade').eq('user_id', userId).limit(1);
  const emp = ((c ?? []) as Array<{ nome?: string | null; nome_fantasia?: string | null; cidade?: string | null }>)[0];
  const usr = u as { nome?: string | null; email?: string | null };
  return {
    nome: String(usr.nome ?? '').trim(),
    email: String(usr.email ?? '').trim(),
    empresa: String(emp?.nome_fantasia || emp?.nome || '').trim(),
    cidade: String(emp?.cidade ?? '').trim(),
  };
}

// ── gravar e avisar ──────────────────────────────────────────────────────────

export interface RespostaGravada { tipo: TipoPesquisa; user_id: string; origem: 'formulario' | 'whatsapp'; em: string; [campo: string]: unknown }

/** Upsert: a última resposta vale. `avisar` = é a 1ª desta pessoa neste tipo, ou o conteúdo mudou. Erro LANÇA (o formulário responde 500 e a pessoa tenta de novo). */
export async function gravarResposta(
  tipo: TipoPesquisa, userId: string, dados: DadosPesquisa, origem: 'formulario' | 'whatsapp', agora: Date = new Date(),
): Promise<{ valor: RespostaGravada; avisar: boolean }> {
  const em = agora.toISOString();
  const chave = chaveResposta(tipo, userId);
  const { data: antes, error: erroLeitura } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
  if (erroLeitura) throw new Error('ler_resposta_falhou');
  const anterior = ((antes as { value?: Record<string, unknown> } | null)?.value ?? null) as Record<string, unknown> | null;
  const nomes: readonly string[] = tipo === 'saida' ? CAMPOS_SAIDA : [...CAMPOS_DEPOIMENTO, 'autorizo'];
  const novo = dados as unknown as Record<string, unknown>;
  const avisar = !anterior || nomes.some(n => (anterior[n] ?? (n === 'autorizo' ? false : '')) !== (novo[n] ?? (n === 'autorizo' ? false : '')));
  const valor: RespostaGravada = { tipo, user_id: userId, origem, ...dados, em };
  const { error } = await supabase.from('system_state').upsert({ key: chave, value: valor, updated_at: em }, { onConflict: 'key' });
  if (error) throw new Error('gravar_resposta_falhou');
  return { valor, avisar };
}

/** O e-mail de operação ao Thiago. Nunca lança (a resposta já está gravada). */
export async function avisarThiago(tipo: TipoPesquisa, userId: string, v: RespostaGravada, ctx: ContextoPesquisa | null): Promise<boolean> {
  const quem = ctx ? `${esc(ctx.nome) || 'sem nome'} (${esc(ctx.email) || 'sem e-mail'})` : esc(userId);
  const linhas: Array<[string, unknown]> = tipo === 'saida'
    ? [['Por que saiu', v.porque], ['Crítica sincera', v.critica], ['O que faria voltar', v.voltaria]]
    : [['O que mudou', v.mudou], ['Depoimento', v.frase], ['Nome', v.nome], ['Empresa', v.empresa], ['Cidade', v.cidade]];
  const itens = linhas.filter(([, x]) => String(x ?? '').trim()).map(([k, x]) => `<p style="margin:0 0 8px;"><strong>${k}:</strong> ${esc(x)}</p>`).join('');
  const via = v.origem === 'whatsapp' ? 'pelo WhatsApp (Carla)' : 'pelo formulário';
  let assunto: string;
  let extra = '';
  if (tipo === 'saida') {
    assunto = 'Entrevista de saída respondida';
  } else {
    const aut = v.autorizo === true;
    assunto = aut ? 'Depoimento recebido COM autorização para publicar' : 'Depoimento recebido SEM autorização (não publicar)';
    extra = `<p style="margin:0 0 8px;"><strong>Autorização para publicar:</strong> ${aut ? 'SIM' : 'NÃO'}</p>`;
  }
  try {
    await sendOpsAlert(assunto, `<p style="margin:0 0 12px;">${quem} respondeu ${via}.</p>${itens}${extra}`);
    return true;
  } catch (e) {
    logger.error('pesquisa', `aviso ao Thiago falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
    return false;
  }
}

/** O que a Carla registra na conversa (ação registrar_feedback_saida): junta com o que já havia e avisa o Thiago. */
export async function registrarFeedbackSaidaPelaCarla(userId: string, parcial: Partial<DadosSaida>, agora: Date = new Date()): Promise<boolean> {
  const { data } = await supabase.from('system_state').select('value').eq('key', chaveResposta('saida', userId)).maybeSingle();
  const antes = ((data as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  const dados: DadosSaida = { porque: '', critica: '', voltaria: '' };
  for (const n of CAMPOS_SAIDA) {
    const novo = String(parcial[n] ?? '').replace(CONTROLE, '').trim().slice(0, MAX_CAMPO);
    dados[n] = novo || String(antes[n] ?? '');
  }
  if (!CAMPOS_SAIDA.some(n => dados[n])) return false;
  const { valor, avisar } = await gravarResposta('saida', userId, dados, 'whatsapp', agora);
  if (avisar) await avisarThiago('saida', userId, valor, await lerContexto(userId).catch(() => null));
  return true;
}

// ── o admin ──────────────────────────────────────────────────────────────────

export interface LinhaPesquisa { tipo: TipoPesquisa; user_id: string; nome: string | null; email: string | null; em: string | null; resposta: Record<string, unknown> }

export async function listarRespostas(): Promise<LinhaPesquisa[]> {
  const out: LinhaPesquisa[] = [];
  for (const tipo of ['saida', 'depoimento'] as const) {
    const prefixo = `pesquisa_${tipo}:`;
    for (let p = 0; p < 50; p++) {
      const { data, error } = await supabase.from('system_state').select('key, value').like('key', `${prefixo}%`)
        .order('key', { ascending: true }).range(p * 1000, p * 1000 + 999);
      if (error) throw new Error('ler_respostas_falhou');
      const lote = (data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>;
      for (const l of lote) {
        if (!l.key.startsWith(prefixo)) continue;
        const v = l.value ?? {};
        out.push({ tipo, user_id: l.key.slice(prefixo.length), nome: null, email: null, em: typeof v.em === 'string' ? v.em : null, resposta: v });
      }
      if (lote.length < 1000) break;
    }
  }
  const ids = [...new Set(out.map(o => o.user_id))];
  const quem = new Map<string, { nome: string | null; email: string | null }>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('users').select('id, nome, email').in('id', ids.slice(i, i + 100));
    for (const u of (data ?? []) as Array<{ id: string; nome: string | null; email: string | null }>) quem.set(u.id, { nome: u.nome, email: u.email });
  }
  for (const o of out) { const q = quem.get(o.user_id); if (q) { o.nome = q.nome; o.email = q.email; } }
  return out.sort((a, b) => String(b.em ?? '').localeCompare(String(a.em ?? '')));
}
