// Propostas do Portal do Parceiro NEXUS: validação do corpo e numeração. As regras de limite vêm da especificação:
// quantidade 1..50, valores >= 0 e < 100 milhões, dados até 200 KB.

import { supabase } from '../../utils/supabase';
import { ErroBanco, Linha } from './repositorio';
import { anoBRT } from './tempo';

export type Saida = 'simulador' | 'basico' | 'completo';
export const SAIDAS: readonly Saida[] = Object.freeze(['simulador', 'basico', 'completo']);

export const LIMITE_VALOR = 100_000_000;
export const LIMITE_DADOS_BYTES = 200 * 1024;

export interface PropostaValidada {
  saida: Saida;
  cliente_nome: string | null;
  cliente_doc: string | null;
  cliente_cidade: string | null;
  cliente_uf: string | null;
  cliente_telefone: string | null;
  cliente_email: string | null;
  tipo_local: string | null;
  modelo: string | null;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  dados: Record<string, unknown>;
}

function texto(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
}

function dinheiro(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= LIMITE_VALOR) return null;
  return Math.round(n * 100) / 100;
}

/** Valida o corpo do POST e do PUT de proposta. Devolve a linha pronta para gravar ou o motivo da recusa. */
export function validarProposta(corpo: unknown): { ok: true; p: PropostaValidada } | { ok: false; erro: string } {
  const b = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, any>;
  if (!SAIDAS.includes(b.saida)) return { ok: false, erro: 'saida_invalida' };

  const cli = (b.cliente && typeof b.cliente === 'object' ? b.cliente : {}) as Record<string, unknown>;
  const eq = (b.equipamento && typeof b.equipamento === 'object' ? b.equipamento : {}) as Record<string, unknown>;

  const quantidade = Number(eq.quantidade);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) return { ok: false, erro: 'quantidade_invalida' };
  const preco = dinheiro(eq.preco_unitario);
  if (preco === null) return { ok: false, erro: 'preco_invalido' };
  const total = dinheiro(b.valor_total);
  if (total === null) return { ok: false, erro: 'valor_invalido' };

  if (!b.dados || typeof b.dados !== 'object' || Array.isArray(b.dados)) return { ok: false, erro: 'dados_invalidos' };
  let tamanho = 0;
  try {
    tamanho = Buffer.byteLength(JSON.stringify(b.dados), 'utf8');
  } catch {
    return { ok: false, erro: 'dados_invalidos' };
  }
  if (tamanho > LIMITE_DADOS_BYTES) return { ok: false, erro: 'dados_grandes_demais' };

  return {
    ok: true,
    p: {
      saida: b.saida,
      cliente_nome: texto(cli.nome, 160),
      cliente_doc: texto(cli.doc, 30),
      cliente_cidade: texto(cli.cidade, 80),
      cliente_uf: texto(cli.uf, 2)?.toUpperCase() ?? null,
      cliente_telefone: texto(cli.telefone, 30),
      cliente_email: texto(cli.email, 120),
      tipo_local: texto(cli.tipo_local, 60),
      modelo: texto(eq.modelo, 80),
      quantidade,
      preco_unitario: preco,
      valor_total: total,
      dados: b.dados,
    },
  };
}

/** Próximo número do parceiro: AAAA (ano de Brasília) + sequência de 4 dígitos. Base do max+1; o conflito de unique refaz. */
export async function proximoNumero(userId: string, ano: number = anoBRT()): Promise<string> {
  const { data, error } = await supabase
    .from('nexus_propostas')
    .select('numero')
    .eq('user_id', userId)
    .like('numero', `${ano}%`)
    .order('numero', { ascending: false })
    .limit(1);
  if (error) throw new ErroBanco(error, 'leitura do último número');
  const ultimo = String(((data as Linha[] | null) ?? [])[0]?.numero ?? '');
  const seq = /^\d{8}$/.test(ultimo) ? parseInt(ultimo.slice(4), 10) : 0;
  return `${ano}${String(seq + 1).padStart(4, '0')}`;
}

/** Insere a proposta com número novo. Em conflito de (user_id, numero) tenta de novo, até 6 vezes. */
export async function inserirProposta(userId: string, p: PropostaValidada): Promise<{ id: string; numero: string }> {
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const numero = await proximoNumero(userId);
    const agora = new Date().toISOString();
    const { data, error } = await supabase
      .from('nexus_propostas')
      .insert({ user_id: userId, numero, saida_ultima: p.saida, ...colunasDe(p), created_at: agora, updated_at: agora })
      .select('id, numero')
      .single();
    if (!error && data) return { id: String((data as Linha).id), numero: String((data as Linha).numero) };
    ultimoErro = error;
    if ((error as { code?: string } | null)?.code !== '23505') break;
  }
  throw new ErroBanco(ultimoErro as { code?: string; message?: string }, 'gravação da proposta');
}

export function colunasDe(p: PropostaValidada): Record<string, unknown> {
  const { saida: _s, ...resto } = p;
  return resto;
}
