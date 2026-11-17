// Validação PURA do que chega nas rotas da Trilha (fora o Raio-X, que mora em trilhaRaioX.ts). Nada aqui lê banco nem relógio:
// quem chama passa o dia de hoje (AAAA-MM-DD em Brasília) quando a regra precisa dele. Nenhuma função aceita user_id.

import { soDigitos } from '../../utils/cnpj';
import { UFS } from './procura';
import { OPCOES, type Resultado } from './trilhaRaioX';
import { inicioDiaBRT } from './tempo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s === '' ? null : s;
};

export const FORMATOS = ['mentoria', 'academia'] as const;
export type Formato = (typeof FORMATOS)[number];

export interface Preferencia {
  dias: string[];
  periodo: 'manha' | 'tarde';
  whatsapp?: string;
}

/** Preferência de horário: até 3 dias (AAAA-MM-DD, de hoje em diante), manhã ou tarde e, se quiser, um WhatsApp. */
export function validarPreferencia(v: unknown, hoje: string): Resultado<Preferencia> {
  if (!ehObjeto(v)) return { ok: false, erro: 'preferencia_invalida' };
  const dias = v.dias;
  if (!Array.isArray(dias) || dias.length < 1 || dias.length > 3) return { ok: false, erro: 'preferencia_invalida', campo: 'dias' };
  const limpos: string[] = [];
  for (const d of dias) {
    if (typeof d !== 'string' || inicioDiaBRT(d) === null || d < hoje) return { ok: false, erro: 'preferencia_invalida', campo: 'dias' };
    if (!limpos.includes(d)) limpos.push(d);
  }
  if (v.periodo !== 'manha' && v.periodo !== 'tarde') return { ok: false, erro: 'preferencia_invalida', campo: 'periodo' };
  const out: Preferencia = { dias: limpos.sort(), periodo: v.periodo };
  if (v.whatsapp !== undefined && v.whatsapp !== null && v.whatsapp !== '') {
    const d = soDigitos(v.whatsapp);
    if (d.length < 10 || d.length > 13) return { ok: false, erro: 'preferencia_invalida', campo: 'whatsapp' };
    out.whatsapp = d;
  }
  return { ok: true, valor: out };
}

export interface PedidoDeReuniao {
  cliente_id?: string;
  cliente_nome: string;
  cidade: string;
  uf: string;
  tipo_local: string;
  proposta_id?: string;
  preferencia: Preferencia;
}

/** Pedido de reunião com o cliente. cliente_id e proposta_id só têm o formato conferido aqui: o dono é conferido no repositório. */
export function validarReuniao(v: unknown, hoje: string): Resultado<PedidoDeReuniao> {
  if (!ehObjeto(v)) return { ok: false, erro: 'reuniao_invalida' };
  const nome = texto(v.cliente_nome, 120);
  const cidade = texto(v.cidade, 80);
  const uf = typeof v.uf === 'string' ? v.uf.trim().toUpperCase() : '';
  if (!nome) return { ok: false, erro: 'reuniao_invalida', campo: 'cliente_nome' };
  if (!cidade) return { ok: false, erro: 'reuniao_invalida', campo: 'cidade' };
  if (!UFS.includes(uf)) return { ok: false, erro: 'reuniao_invalida', campo: 'uf' };
  if (typeof v.tipo_local !== 'string' || !(OPCOES.tipo_local as readonly string[]).includes(v.tipo_local)) return { ok: false, erro: 'reuniao_invalida', campo: 'tipo_local' };
  const pref = validarPreferencia(v.preferencia, hoje);
  if (!pref.ok) return { ok: false, erro: 'reuniao_invalida', campo: 'preferencia' };
  const out: PedidoDeReuniao = { cliente_nome: nome, cidade, uf, tipo_local: v.tipo_local, preferencia: pref.valor };
  for (const k of ['cliente_id', 'proposta_id'] as const) {
    const x = v[k];
    if (x === undefined || x === null || x === '') continue;
    if (typeof x !== 'string' || !UUID.test(x)) return { ok: false, erro: 'reuniao_invalida', campo: k };
    out[k] = x.toLowerCase();
  }
  return { ok: true, valor: out };
}

// ── Ações da equipe (PATCH /nexus/equipe/trilha/:userId) ─────────────────────
export type AcaoEquipe =
  | { acao: 'agendar_diagnostico'; quando: string; link: string | null }
  | { acao: 'diagnostico_feito'; resultado: 'aprovado' | 'ainda_nao'; plano: string | null }
  | { acao: 'mentoria_paga' }
  | { acao: 'mentoria_encontro' }
  | { acao: 'agendar_reuniao'; quando: string }
  | { acao: 'reuniao_feita'; obs: string | null }
  | { acao: 'promover_regional' }
  | { acao: 'avancar'; motivo: string }
  | { acao: 'responsavel'; email: string | null }
  | { acao: 'obs'; texto: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function quandoValido(v: unknown, agora: Date): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || ms > agora.getTime() + 2 * 365 * 86_400_000 || ms < agora.getTime() - 400 * 86_400_000) return null;
  return new Date(ms).toISOString();
}

export function validarAcaoEquipe(corpo: unknown, agora: Date = new Date()): Resultado<AcaoEquipe> {
  if (!ehObjeto(corpo)) return { ok: false, erro: 'acao_invalida' };
  const invalido = (campo: string): Resultado<AcaoEquipe> => ({ ok: false, erro: 'acao_invalida', campo });
  switch (corpo.acao) {
    case 'agendar_diagnostico': {
      const quando = quandoValido(corpo.quando, agora);
      if (!quando) return invalido('quando');
      let link: string | null = null;
      if (corpo.link !== undefined && corpo.link !== null && corpo.link !== '') {
        link = texto(corpo.link, 300);
        if (!link || !/^https:\/\/\S+$/i.test(link)) return invalido('link');
      }
      return { ok: true, valor: { acao: 'agendar_diagnostico', quando, link } };
    }
    case 'diagnostico_feito':
      if (corpo.resultado !== 'aprovado' && corpo.resultado !== 'ainda_nao') return invalido('resultado');
      return { ok: true, valor: { acao: 'diagnostico_feito', resultado: corpo.resultado, plano: texto(corpo.plano, 2000) } };
    case 'mentoria_paga': case 'mentoria_encontro': case 'promover_regional':
      return { ok: true, valor: { acao: corpo.acao } };
    case 'agendar_reuniao': {
      const quando = quandoValido(corpo.quando, agora);
      return quando ? { ok: true, valor: { acao: 'agendar_reuniao', quando } } : invalido('quando');
    }
    case 'reuniao_feita':
      return { ok: true, valor: { acao: 'reuniao_feita', obs: texto(corpo.obs, 500) } };
    case 'avancar': {
      const motivo = texto(corpo.motivo, 500);
      return motivo && motivo.length >= 3 ? { ok: true, valor: { acao: 'avancar', motivo } } : { ok: false, erro: 'motivo_obrigatorio', campo: 'motivo' };
    }
    case 'responsavel': {
      const email = texto(corpo.email, 120)?.toLowerCase() ?? null;
      if (email && !EMAIL.test(email)) return invalido('email');
      return { ok: true, valor: { acao: 'responsavel', email } };
    }
    case 'obs':
      return { ok: true, valor: { acao: 'obs', texto: texto(corpo.texto, 2000) } };
    default:
      return { ok: false, erro: 'acao_invalida', campo: 'acao' };
  }
}
