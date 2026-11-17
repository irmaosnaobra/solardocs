// O convite da Trilha, mostrado a quem ainda não é parceiro: o usuário fecha o cartão ("fechou") ou diz que não quer ("nao_quero").
// Só grava em nexus_trilha_eventos (sem chave estrangeira: user_id é uuid puro, ver MIGRATION_nexus_trilha.sql). NUNCA cria linha
// em nexus_parceiros nem em nexus_trilha. Nada aqui lê user_id do cliente: quem chama passa o req.userId.

import { supabase } from '../../utils/supabase';
import { ErroBanco, Linha } from './repositorio';
import { registrarEventos } from './trilhaRepo';

export const ACOES_CONVITE = ['fechou', 'nao_quero'] as const;
export type AcaoConvite = (typeof ACOES_CONVITE)[number];
export interface Convite { fechou: number; recusou: boolean }

export const TIPO_FECHOU = 'convite_fechado';
export const TIPO_RECUSOU = 'convite_recusado';
/** `fechou` repetido em menos de 1 minuto é o mesmo clique (duplo toque, reenvio): não vira evento novo. */
export const JANELA_FECHOU_MS = 60_000;

export const acaoDeConvite = (v: unknown): AcaoConvite | null =>
  typeof v === 'string' && (ACOES_CONVITE as readonly string[]).includes(v) ? (v as AcaoConvite) : null;

/** Uma consulta, só dos eventos de convite deste usuário (poucas linhas). */
async function lerEventosDeConvite(userId: string): Promise<Linha[]> {
  const { data, error } = await supabase.from('nexus_trilha_eventos').select('tipo, created_at').eq('user_id', userId).in('tipo', [TIPO_FECHOU, TIPO_RECUSOU]);
  if (error) throw new ErroBanco(error, 'leitura do convite');
  return (data as Linha[] | null) ?? [];
}

const contar = (eventos: Linha[]): Convite => ({ fechou: eventos.filter((e) => e.tipo === TIPO_FECHOU).length, recusou: eventos.some((e) => e.tipo === TIPO_RECUSOU) });

/** { fechou: quantas vezes fechou, recusou: já disse que não quer }. Só lê. */
export async function lerConvite(userId: string): Promise<Convite> {
  return contar(await lerEventosDeConvite(userId));
}

/** Registra o gesto do usuário e devolve a contagem já com ele. */
export async function registrarConvite(userId: string, acao: AcaoConvite, agora: Date = new Date()): Promise<Convite> {
  const eventos = await lerEventosDeConvite(userId);
  if (acao === 'nao_quero') {
    if (eventos.some((e) => e.tipo === TIPO_RECUSOU)) return contar(eventos); // idempotente
    await registrarEventos(userId, [{ tipo: TIPO_RECUSOU, dados: {}, autor: 'parceiro' }]);
    return contar([...eventos, { tipo: TIPO_RECUSOU }]);
  }
  const ultimo = Math.max(0, ...eventos.filter((e) => e.tipo === TIPO_FECHOU).map((e) => Date.parse(String(e.created_at)) || 0));
  if (ultimo && agora.getTime() - ultimo < JANELA_FECHOU_MS) return contar(eventos);
  await registrarEventos(userId, [{ tipo: TIPO_FECHOU, dados: {}, autor: 'parceiro' }]);
  return contar([...eventos, { tipo: TIPO_FECHOU }]);
}
