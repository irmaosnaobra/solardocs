// Dados do cadastro do cliente que o relatório da vistoria mostra (endereço e concessionária).
// Este arquivo lê o banco (supabase e logger), então o template do relatório NUNCA o importa por valor:
// só `import type { DadosCliente }`, que o compilador apaga.

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

export interface DadosCliente {
  endereco: string;
  cep: string;
  cidade: string;
  uf: string;
  concessionaria: string;
}

/** Só estas colunas saem do cadastro. Nada de cpf_cnpj, e-mail nem telefone no relatório público. */
const COLUNAS = 'endereco, cep, cidade, uf, concessionaria';
/** Colunas mais antigas: se o banco não tiver as de cima, o endereço e o CEP ainda saem. */
const COLUNAS_BASE = 'endereco, cep';

const texto = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

/**
 * Linha de `clients` para DadosCliente (pura). Pega só os 5 campos, aparados; qualquer outra coluna que
 * venha na linha é ignorada. Devolve null se todos os campos ficarem vazios.
 */
export function dadosClienteDeLinha(linha: unknown): DadosCliente | null {
  if (!linha || typeof linha !== 'object' || Array.isArray(linha)) return null;
  const l = linha as Record<string, unknown>;
  const dados: DadosCliente = {
    endereco: texto(l.endereco),
    cep: texto(l.cep),
    cidade: texto(l.cidade),
    uf: texto(l.uf),
    concessionaria: texto(l.concessionaria),
  };
  return Object.values(dados).some((v) => v !== '') ? dados : null;
}

async function lerLinha(colunas: string, clienteId: string, userId: string): Promise<{ linha: unknown; falhou: boolean }> {
  const { data, error } = await supabase
    .from('clients')
    .select(colunas)
    .eq('id', clienteId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { linha: null, falhou: true };
  return { linha: data, falhou: false };
}

/**
 * Endereço e concessionária do cliente cadastrado, ou null. Chamada como `lerDadosCliente(v.cliente_id, v.user_id)`.
 * `clienteId` nulo, indefinido ou vazio devolve null SEM consultar o banco (muitas vistorias são "só o nome"), e a
 * consulta sempre filtra pelo dono, então cliente de outro usuário nunca aparece. Qualquer erro (inclusive coluna
 * ausente) tenta de novo só com endereço e CEP; se falhar de novo, null. NUNCA lança: o link público do relatório
 * não pode virar 500 por causa do cadastro.
 */
export async function lerDadosCliente(
  clienteId: string | null | undefined,
  userId: string | null | undefined,
): Promise<DadosCliente | null> {
  const cid = texto(clienteId);
  const uid = texto(userId);
  if (!cid || !uid) return null;
  try {
    let lida = await lerLinha(COLUNAS, cid, uid);
    if (lida.falhou) lida = await lerLinha(COLUNAS_BASE, cid, uid);
    if (lida.falhou) {
      logger.warn('relatorio', 'não consegui ler o cadastro do cliente para o relatório', { clienteId: cid });
      return null;
    }
    return dadosClienteDeLinha(lida.linha);
  } catch (err) {
    logger.error('relatorio', 'falha lendo o cadastro do cliente', err);
    return null;
  }
}
