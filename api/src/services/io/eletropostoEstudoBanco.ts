// ─────────────────────────────────────────────────────────────────────────────
// ESTUDO DO LOCAL, o acesso ao banco.
//
// A tabela eletroposto_estudos tem RLS ligada e nenhuma policy: a chave publishable
// (que está no código deste repo público) não lê nem escreve nela. Tudo passa por
// funções SECURITY DEFINER que conferem o EP_ESTUDO_DB_SEGREDO, e o banco guarda só
// o sha256 dele. Ver MIGRATION_eletroposto_estudos.sql na raiz.
//
// Sem o segredo na Vercel, `bancoConfigurado()` é falso e o estudo inteiro fica
// parado: o card sai sem link e o tick responde `sem_segredo`. Nada quebra.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import type { DadosEstudo } from './eletropostoEstudoPuro';

export type StatusEstudo = 'pendente' | 'processando' | 'pronto' | 'parcial' | 'sem_endereco' | 'descartado' | 'erro';
export type OrigemEstudo = 'alerta' | 'rede' | 'backfill' | 'manual';

export interface LinhaEstudoBanco {
  id: number;
  agendamento_id: number;
  token: string;
  origem: OrigemEstudo;
  status: StatusEstudo;
  tentativas: number;
  locked_until: string | null;
  municipio_ibge: number | null;
  confianca: string | null;
  pre_nota: number | null;
  indice: number | null;
  situacao: 'pronto' | 'confirmar' | null;
  dados: DadosEstudo;
  fontes: Record<string, string>;
  custo_usd: number;
  erro: string | null;
  aviso_enviado_em: string | null;
  historico_em: string | null;
  coords_apagadas_em: string | null;
  created_at: string;
  pronto_em: string | null;
}

/** O pedaço da reunião que a página mostra. Sem telefone, de propósito. */
export interface ReuniaoDoEstudo {
  quando: string | null;
  status: string;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cidade: string | null;
  observacao: string | null;
}

export type PatchEstudo = Partial<Pick<LinhaEstudoBanco,
  'status' | 'locked_until' | 'municipio_ibge' | 'confianca' | 'pre_nota' | 'indice' | 'situacao'
  | 'dados' | 'fontes' | 'custo_usd' | 'erro' | 'pronto_em' | 'coords_apagadas_em'>>;

export type ModoLista = 'fila' | 'aviso' | 'historico' | 'limpeza' | 'por_agendamentos' | 'ibge';

const segredo = (): string => (process.env.EP_ESTUDO_DB_SEGREDO || '').trim();

export const bancoConfigurado = (): boolean => segredo().length >= 32;

async function chamar<T>(funcao: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseGerador.rpc(funcao, { p_segredo: segredo(), ...args });
  // A mensagem do Postgres não carrega os argumentos: o segredo não sai daqui.
  if (error) throw new Error(`${funcao}: ${[error.code, error.message].filter(Boolean).join(' ')}`);
  return data as T;
}

/** Cria a linha da reunião se ainda não existe e devolve o token que vale. */
export function garantirLinha(o: {
  agendamentoId: number; token: string; origem: OrigemEstudo; dados?: Partial<DadosEstudo>; avisoEnviado?: boolean;
}): Promise<string | null> {
  return chamar<string | null>('ep_estudo_garantir', {
    p_agendamento_id: o.agendamentoId,
    p_token: o.token,
    p_origem: o.origem,
    p_dados: o.dados ?? {},
    p_aviso_enviado: !!o.avisoEnviado,
  });
}

export function lerPorToken(token: string): Promise<{ estudo: LinhaEstudoBanco; reuniao: ReuniaoDoEstudo } | null> {
  return chamar('ep_estudo_ler', { p_token: token });
}

export async function listar(modo: ModoLista, o: { ids?: number[]; limite?: number } = {}): Promise<LinhaEstudoBanco[]> {
  const r = await chamar<LinhaEstudoBanco[] | null>('ep_estudo_listar', {
    p_modo: modo, p_ids: o.ids ?? null, p_limite: o.limite ?? 20,
  });
  return r ?? [];
}

export function contarProntosDesde(desdeIso: string): Promise<number> {
  return chamar<number>('ep_estudo_contar_prontos', { p_desde: desdeIso });
}

/** Claim com lease. Falso = outro tick pegou antes, ou a linha mudou. */
export function pegar(id: number, tentativas: number, leaseSeg: number): Promise<boolean> {
  return chamar<boolean>('ep_estudo_pegar', { p_id: id, p_tentativas: tentativas, p_lease_seg: leaseSeg });
}

export async function salvar(id: number, patch: PatchEstudo): Promise<void> {
  await chamar<null>('ep_estudo_salvar', { p_id: id, p_patch: patch });
}

/** Carimbo de aviso ou de linha no CRM. Ligar só pega se estava vazio. */
export function marcar(id: number, campo: 'aviso' | 'historico', ligar: boolean): Promise<boolean> {
  return chamar<boolean>('ep_estudo_marcar', { p_id: id, p_campo: campo, p_ligar: ligar });
}

export async function escreverNoHistorico(agendamentoId: number, linha: string): Promise<void> {
  await chamar<null>('ep_estudo_historico', { p_id: agendamentoId, p_linha: linha });
}
