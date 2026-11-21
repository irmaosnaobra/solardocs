// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR UM ARQUIVO NUM ITEM DA VENDA (20/11/2026). O upload do navegador (`POST /clientes/:linha/:codigo/docs`) manda o arquivo direto ao Storage
// e só depois registra; aqui o SERVIDOR já tem os bytes (o anexo baixado do Trello). O registro do arquivo (`criarArquivoDoc`) é UM só para os dois
// caminhos, e as mesmas conferências valem: tipo aceito pelo item, 10 MB, assinatura do arquivo, espaço no item (um só arquivo por item, teto da venda)
// e gravação com compare-and-swap. O objeto que não coube (ou que perdeu a corrida) é removido do bucket.
// Nunca põe caminho, nome de arquivo nem texto de erro do Storage em log.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import {
  BUCKET_DOCS, LIMITE_BYTES, assinaturaBate, comArquivo, itemDoCatalogo, mimeServeAoItem, motivoSemEspaco, novoCaminho, type ArquivoDoc,
} from './docsCliente';
import { ErroDocs, garantirBucketDocs, gravarDocs, lerDocsComVersao, removerObjeto } from './docsClienteBanco';

const TENTATIVAS = 4;

/** O registro de um arquivo recém-guardado: o MESMO objeto do upload do navegador e da importação do servidor. */
export function criarArquivoDoc(a: { slot: string; caminho: string; mime: string; bytes: number; por: string; agora: string; id?: string }): ArquivoDoc {
  return { id: a.id ?? crypto.randomUUID(), slot: a.slot, caminho: a.caminho, mime: a.mime, bytes: a.bytes, em: a.agora, por: a.por };
}

export type MotivoRegistro = 'slot_ocupado' | 'sem_espaco' | 'invalido' | 'ocupado';
export type ResRegistro = { ok: true; arquivo: ArquivoDoc } | { ok: false; motivo: MotivoRegistro };

/**
 * Guarda `bytes` no item `slot` da venda solar `codigo` (só os dígitos), SÓ SE o item estiver vazio e couber: nunca troca nem acrescenta num item ocupado.
 * `antes(id)` roda depois de confirmado que cabe e ANTES de qualquer escrita: devolver false cancela (`ocupado`). Lança `ErroDocs` se o armazenamento falhar.
 */
export async function registrarArquivoNoSlot(e: {
  codigo: string; slot: string; mime: string; bytes: Buffer; por: string; antes?: (id: string) => Promise<boolean>;
}): Promise<ResRegistro> {
  const item = itemDoCatalogo('vendasolar', e.slot);
  if (!item || !mimeServeAoItem(item, e.mime) || e.bytes.length === 0 || e.bytes.length > LIMITE_BYTES || !assinaturaBate(e.mime, e.bytes.subarray(0, 16))) {
    return { ok: false, motivo: 'invalido' };
  }
  await garantirBucketDocs();
  const { reg: antesReg } = await lerDocsComVersao('vendasolar', e.codigo);
  const m0 = motivoSemEspaco(antesReg, item, 'vendasolar');
  if (m0) return { ok: false, motivo: m0 === 'slot_ocupado' ? 'slot_ocupado' : 'sem_espaco' };
  const id = crypto.randomUUID();
  if (e.antes && !(await e.antes(id))) return { ok: false, motivo: 'ocupado' };

  const caminho = novoCaminho('vendasolar', e.codigo, e.mime);
  const { error } = await supabase.storage.from(BUCKET_DOCS).upload(caminho, e.bytes, { contentType: e.mime, upsert: false, cacheControl: '60' });
  if (error) throw new ErroDocs('upload_objeto');
  const soltar = (): Promise<void> => removerObjeto(caminho).catch(() => undefined);
  try {
    for (let t = 0; t < TENTATIVAS; t++) {
      const { reg, versao } = await lerDocsComVersao('vendasolar', e.codigo);
      if (reg.apagados.includes(caminho) || reg.arquivos.some((a) => a.caminho === caminho)) { await soltar(); return { ok: false, motivo: 'ocupado' }; }
      const motivo = motivoSemEspaco(reg, item, 'vendasolar');
      if (motivo) { await soltar(); return { ok: false, motivo: motivo === 'slot_ocupado' ? 'slot_ocupado' : 'sem_espaco' }; }
      const agora = new Date().toISOString();
      const arquivo = criarArquivoDoc({ id, slot: e.slot, caminho, mime: e.mime, bytes: e.bytes.length, por: e.por, agora });
      if (await gravarDocs('vendasolar', e.codigo, comArquivo(reg, arquivo), versao, agora)) return { ok: true, arquivo };
    }
  } catch (err) {
    await soltar();
    throw err;
  }
  await soltar();
  return { ok: false, motivo: 'ocupado' };
}
