/**
 * ADICIONAIS DENTRO DO APP: o que está ativo, o que ainda dá para comprar e o carimbo de "cancelando".
 *
 * A verdade do "ativo" é a posse em `entitlements`: `obs = adicional:<meio>:<item>[:cancelando]`, `expira_em` = fim
 * do período pago + 3 dias, `order_id` = id da assinatura da Stripe ou do contrato do Pix. O acesso em si continua
 * sendo decidido só por `acessos()`.
 */

import { supabase } from '../../utils/supabase';
import { acessos } from './acessos';
import {
  FOLGA_ADICIONAL_DIAS, ITENS_AVULSOS, PACOTE, adicionaisLigado, lerObsDoAdicional, obsDoAdicional,
} from './adicionais';

export interface AdicionalAtivo {
  id: string;
  meio: 'cartao' | 'pix';
  /** Quando renova (ISO): o fim do período pago, sem a folga. */
  renovaEm: string;
  /** Já pediu para cancelar: o acesso segue até `renovaEm` e não cobra de novo. */
  cancelado: boolean;
}

interface LinhaPosse { id?: string; produto: string; expira_em: string | null; obs: string | null; order_id: string | null }

async function posses(userId: string): Promise<LinhaPosse[]> {
  const { data } = await supabase.from('entitlements').select('id, produto, expira_em, obs, order_id').eq('user_id', userId);
  return (data ?? []) as LinhaPosse[];
}

/** Os adicionais com acesso ainda válido, um por (item, meio). */
export function adicionaisAtivosDe(linhas: LinhaPosse[], agora = Date.now()): AdicionalAtivo[] {
  const grupos = new Map<string, { id: string; meio: 'cartao' | 'pix'; ate: number; todosCancelando: boolean }>();
  for (const l of linhas) {
    const obs = lerObsDoAdicional(l.obs);
    const ate = l.expira_em ? new Date(l.expira_em).getTime() : NaN;
    if (!obs || !Number.isFinite(ate) || ate <= agora) continue;
    const chave = `${obs.meio}:${obs.item}`;
    const g = grupos.get(chave);
    if (!g) grupos.set(chave, { id: obs.item, meio: obs.meio, ate, todosCancelando: obs.cancelando });
    else { g.ate = Math.max(g.ate, ate); g.todosCancelando = g.todosCancelando && obs.cancelando; }
  }
  return [...grupos.values()].map((g) => ({
    id: g.id, meio: g.meio,
    renovaEm: new Date(g.ate - FOLGA_ADICIONAL_DIAS * 24 * 60 * 60 * 1000).toISOString(),
    cancelado: g.todosCancelando,
  }));
}

/**
 * GET /produtos/adicional. `podeComprar`: as ferramentas que a conta ainda NÃO tem por nenhum caminho (assinatura,
 * compra antiga, cortesia, adicional ativo) e, quando compensa, o 'pacote'. Flag desligada: tudo vazio.
 */
export async function estadoDosAdicionais(userId: string): Promise<{ ativos: AdicionalAtivo[]; podeComprar: string[] }> {
  if (!adicionaisLigado()) return { ativos: [], podeComprar: [] };
  const [linhas, a] = await Promise.all([posses(userId), acessos(userId)]);
  const ativos = adicionaisAtivosDe(linhas);
  const faltam = ITENS_AVULSOS.filter((i) => !a.produtos.has(i));
  const temAvulsaAtiva = ativos.some((x) => x.id !== PACOTE);
  const pacote = faltam.length >= 2 || (faltam.length >= 1 && temAvulsaAtiva);
  return { ativos, podeComprar: [...faltam, ...(pacote ? [PACOTE] : [])] };
}

/** As linhas de posse deste item neste meio (para o cancelamento achar a assinatura ou o contrato). */
export async function posseDoAdicional(userId: string, item: string, meio: 'cartao' | 'pix'): Promise<LinhaPosse[]> {
  return (await posses(userId)).filter((l) => {
    const o = lerObsDoAdicional(l.obs);
    return !!o && o.item === item && o.meio === meio;
  });
}

/** Carimba "cancelando" nas posses do item: o acesso segue até a data, a tela mostra o aviso. */
export async function marcarCancelando(userId: string, item: string, meio: 'cartao' | 'pix'): Promise<void> {
  for (const l of await posseDoAdicional(userId, item, meio)) {
    if (!l.id) continue;
    const { error } = await supabase.from('entitlements').update({ obs: obsDoAdicional(meio, item, true) }).eq('id', l.id);
    if (error) console.error('[adicionais] nao consegui marcar cancelando:', error.message);
  }
}
