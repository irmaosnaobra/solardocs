// Leitura da marca do integrador no banco. É o ÚNICO arquivo da pasta relatorio/ que importa
// supabase e logger: os templates importam marca.ts (puro), nunca este.

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { COLUNAS_MARCA, marcaDeLinha, type LinhaEmpresa, type MarcaEmpresa } from './marca';

/**
 * Marca (logo, nome, CNPJ e cor) da empresa do usuário, ou null se não houver. NUNCA lança: erro do
 * banco ou do cliente vira log e null, porque o link público do relatório não pode virar 500 por
 * causa da marca (sem marca, o relatório sai com a identidade padrão).
 */
export async function lerMarca(userId: string | null | undefined): Promise<MarcaEmpresa | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('company')
      .select(COLUNAS_MARCA)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.error('relatorio', 'falha lendo a marca da empresa', error);
      return null;
    }
    return marcaDeLinha(data as unknown as LinhaEmpresa | null);
  } catch (err) {
    logger.error('relatorio', 'falha lendo a marca da empresa', err);
    return null;
  }
}
