/**
 * LIMPAPRO: esta conta comprou?
 *
 * O funil do LimpaPro é outro projeto (limpapro.solardoc.app) e o webhook dele, que fica fora deste
 * repositório, não grava nada em `entitlements`: a compra mora em `limpapro_entitlements` (um item por
 * linha, por e-mail) e em `limpapro_membros` (a conta da área de membros, com o telefone). Por isso o
 * `curso-limpapro` do menu nunca abria para quem comprou. Em vez de criar uma segunda concessão (duas
 * verdades para o mesmo acesso) e mexer num funil vivo, o `acessos()` LÊ a verdade que já existe.
 *
 * Conta com compra do LimpaPro = qualquer uma destas, por e-mail da conta ou pelo WhatsApp dela (as mesmas
 * variantes de número que a caixa do WhatsApp e o quiz já usam):
 *   - `limpapro_entitlements` ativo com o item `curso-principal` (o webhook do LimpaPro grava este item em
 *     TODA compra do funil) ou `premium` (o plano completo), por e-mail;
 *   - `limpapro_membros` ativo, por e-mail ou por telefone.
 * Erro de leitura, tabela que não existe: "não tem". Errar para o lado de trancar é recuperável.
 */

import { supabase } from '../../utils/supabase';
import { variantesDoTelefone } from './chaveTelefone';

const ITENS_QUE_ABREM = ['curso-principal', 'premium'];

/** Onde a área do aluno mora. Quem tem o produto vai para cá; a raiz do domínio é a página de venda. */
export const LIMPAPRO_AREA_DE_MEMBROS = 'https://limpapro.solardoc.app/membros';

async function achou(rotulo: string, busca: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<boolean> {
  try {
    const { data, error } = await busca;
    if (error) {
      console.warn(`[acessos] limpapro (${rotulo}) não pôde ser lido, tratando como "não tem":`, error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.warn(`[acessos] limpapro (${rotulo}) falhou, tratando como "não tem":`, err);
    return false;
  }
}

export async function temCompraLimpapro(opts: {
  email?: string | null;
  whatsapp?: string | null;
}): Promise<boolean> {
  const email = String(opts.email ?? '').toLowerCase().trim();
  const telefones = variantesDoTelefone(opts.whatsapp);

  const buscas: Array<Promise<boolean>> = [];
  if (email) {
    buscas.push(achou('entitlements por e-mail', supabase
      .from('limpapro_entitlements').select('item')
      .eq('email', email).eq('ativo', true).in('item', ITENS_QUE_ABREM).limit(1)));
    buscas.push(achou('membros por e-mail', supabase
      .from('limpapro_membros').select('email')
      .eq('email', email).eq('ativo', true).limit(1)));
  }
  if (telefones.length) {
    buscas.push(achou('membros por telefone', supabase
      .from('limpapro_membros').select('email')
      .in('telefone', telefones).eq('ativo', true).limit(1)));
  }
  if (!buscas.length) return false;
  return (await Promise.all(buscas)).some(Boolean);
}
