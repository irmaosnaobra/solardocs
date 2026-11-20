// ─────────────────────────────────────────────────────────────────────────────
// A COMPRA LIDA SOZINHA, O LADO COM BANCO E IA (19/11/2026). Nenhum botão "Ler": anexou, o servidor lê e grava. Cada arquivo (foto, PDF, imagem, XML):
//   1. nunca em obra finalizada, cancelada ou com a conta fechada (`obraAbertaParaIa`);
//   2. XML da NF-e: leitura EXATA, sem IA (`lerNfeXml`); o resto: IA (`lerNota`), dentro da cota de 20 leituras por hora e por venda
//      (o mesmo teto da leitura dos passos 1 a 5, com registro próprio: `vendasolar/<card>.leitura-compra.json`);
//   3. dedupe por sha256: arquivo já lido nesta obra não é lido nem gravado de novo (nem gasta cota);
//   4. a mescla é de `compraLeitura.ts`: só campo vazio, nota e pedido marcam comprado, orçamento não;
//   5. nota fiscal entra no registro global de notas (`fin_nf:` e a chave de 44 dígitos): nota que já vive em OUTRA obra não marca nada.
// Valor de dinheiro NUNCA volta daqui: a rota mascara pelo `podeVerLivroDaObra` ao montar a resposta. Nada de nome, texto ou valor vai para log.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'crypto';
import { diaDeBrasilia } from '../agenda/viradaDoDia';
import { comTrava } from './cadastroVendaBanco';
import { decodificarBase64, gravarLeituraDoArquivo, normalizarTipo, subirComprovante } from './financeiroArquivos';
import { MAX_BYTES_XML } from './financeiroCliente';
import * as leitorXml from './nfeXml';
import { lerNota } from './notaLeitura';
import { obraAbertaParaIa } from './leituraGravacao';
import { MAX_LEITURAS_POR_HORA, devolver, reservar, type Cota } from './leituraRegistro';
import { ehRecusa } from './jornadaSolarBanco';
import {
  buscarNotaViva, gravarRegistroNota, liberarRegistroNota, lerObraPrivada, mudarObraPrivada, obraPrivadaVazia, reservarChaveNfe,
} from './jornadaObraBanco';
import { aplicarDocumentoNaCompra, compraExistenteDoDocumento, jaLido, tipoDoDocumento, type ContextoMescla, type DocLido, type ResumoMescla } from './compraLeitura';

export const cotaDaCompra = (card: number): Cota => ({ caminho: `vendasolar/${card}.leitura-compra.json`, trava: `leitura-compra:${card}`, limite: MAX_LEITURAS_POR_HORA });

export interface EntradaArquivoCompra { base64: unknown; media_type: unknown; nome?: unknown }
export interface QuemLe { id: number; nome: string }
const novoId = (p: string): string => `${p}-${randomUUID().slice(0, 12)}`;
const hojeBr = (): string => diaDeBrasilia(Date.now());

export type SaidaCompra =
  | { http: 200; resultado: 'lido'; leitura: 'xml' | 'ia'; resumo: ResumoMescla; fornecedor: string; numero: string; data: string | null }
  | { http: 200; resultado: 'repetido' | 'nao_e_documento' | 'sem_itens' | 'cota' | 'falhou'; mensagem: string }
  | { http: number; resultado: 'erro'; error: string; mensagem: string; dono?: { card: number; id: string } };

const erro = (http: number, error: string, mensagem: string, extra: object = {}): SaidaCompra => ({ http, resultado: 'erro', error, mensagem, ...extra });
const nomeLimpo = (v: unknown): string => String(typeof v === 'string' ? v : 'arquivo').replace(/[\u0000-\u001f\u007f]/g, ' ').split(/[\\/]/).pop()!.trim().slice(0, 120) || 'arquivo';

/** O que a leitura achou, no formato da mescla. */
function docLido(lida: Record<string, unknown>, origem: 'xml' | 'ia'): DocLido {
  const itens = (Array.isArray(lida.itens) ? lida.itens : []) as Array<Record<string, unknown>>;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    tipo: tipoDoDocumento({ tipo: String(lida.tipo ?? ''), origem }), fornecedor: String(lida.emitente ?? '').trim(), numero: String(lida.numero ?? ''),
    chave: typeof lida.chave === 'string' && lida.chave ? lida.chave : null, data: typeof lida.data === 'string' ? lida.data : null,
    total_centavos: n(lida.valor_total_centavos), origem,
    itens: itens.map((i) => ({
      descricao: String(i.descricao ?? '').trim(), quantidade: n(i.quantidade) || null, unidade: String(i.unidade ?? ''),
      valor_unitario_centavos: n(i.valor_unitario_centavos), valor_total_centavos: n(i.valor_total_centavos),
    })),
  };
}

/**
 * Lê UM arquivo da Compra e grava o que achou. Nunca lança por causa da IA (falha vira `falhou`); erro de banco sobe (a rota responde 503).
 * `agora`: só para teste. `equip`: o kit da proposta; com a compra vazia a 1ª leitura parte dele.
 */
export async function lerEGravarArquivoDaCompra(g: QuemLe, entrada: EntradaArquivoCompra, agora: () => string = () => new Date().toISOString(), equip?: ContextoMescla['equip']): Promise<SaidaCompra> {
  if (!(await obraAbertaParaIa(g.id))) return erro(409, 'obra_fechada', 'Esta obra não aceita mais leitura.');
  const tipo = normalizarTipo(entrada.media_type);
  const ehXml = tipo === 'application/xml' || tipo === 'text/xml';
  let lidaXml: ReturnType<typeof leitorXml.lerNfeXml> | null = null;
  if (ehXml) {
    // O teto de 1 MB vale ANTES de decodificar e de ler (o mesmo limite do upload): XML enorme não gasta memória nem CPU.
    if (typeof entrada.base64 === 'string' && entrada.base64.length > Math.ceil((MAX_BYTES_XML * 4) / 3) + 1024) return erro(400, 'xml_grande', leitorXml.MENSAGEM_XML.grande);
    const bytes0 = decodificarBase64(entrada.base64);
    if (!bytes0) return erro(400, 'arquivo_invalido', 'Não consegui abrir este arquivo.');
    lidaXml = leitorXml.lerNfeXml(bytes0, hojeBr());
    if (!lidaXml.ok) return erro(400, `xml_${lidaXml.motivo}`, leitorXml.MENSAGEM_XML[lidaXml.motivo]);
  }
  const subida = await subirComprovante(g.id, { base64: entrada.base64, media_type: entrada.media_type, nome: entrada.nome, aceitaXml: true });
  if (!subida.ok) {
    const http = subida.erro === 'bucket_indisponivel' ? 503 : subida.erro === 'armazenamento_falhou' ? 502 : subida.erro === 'tipo_recusado_pelo_storage' ? 415 : 400;
    return erro(http, subida.erro, 'Não consegui guardar este arquivo. Mande a foto, o PDF ou o XML.');
  }
  const { bytes, ...arquivo } = subida.arquivo;
  const nome = nomeLimpo(entrada.nome ?? arquivo.nome);
  const sha = arquivo.sha256;

  // Já lido nesta obra: não lê, não grava, não gasta cota.
  if (jaLido((await lerObraPrivada(g.id)) ?? obraPrivadaVazia(), sha)) return { http: 200, resultado: 'repetido', mensagem: 'Este arquivo já foi lido nesta obra.' };

  let origem: 'xml' | 'ia' = 'ia';
  let lida: Record<string, unknown> | null = null;
  let reservado = false;
  if (lidaXml && lidaXml.ok) { origem = 'xml'; lida = { ...lidaXml.nota }; }
  else {
    const cota = cotaDaCompra(g.id);
    const r = await reservar(cota, g.nome, sha, false);
    if (r === 'cota') return { http: 200, resultado: 'cota', mensagem: 'Muitas leituras agora. Tente de novo em alguns minutos.' };
    reservado = true;
    try {
      const nota = await lerNota({ bytes, media_type: arquivo.tipo, hojeBr: hojeBr() });
      if (!nota.ok) { await devolver(cota, g.nome, sha); return { http: 200, resultado: 'falhou', mensagem: 'Não consegui ler agora. Anexe de novo mais tarde ou digite à mão.' }; }
      if (!nota.eh_documento) return { http: 200, resultado: 'nao_e_documento', mensagem: 'Este arquivo não parece orçamento, pedido nem nota fiscal.' };
      lida = { ...nota.nota };
    } catch { if (reservado) await devolver(cota, g.nome, sha); return { http: 200, resultado: 'falhou', mensagem: 'Não consegui ler agora. Anexe de novo mais tarde ou digite à mão.' }; }
  }
  const doc = docLido(lida!, origem);
  if (!doc.itens.some((i) => i.descricao)) return { http: 200, resultado: 'sem_itens', mensagem: 'Li o arquivo, mas não achei itens. Digite à mão.' };

  // A leitura fica guardada ao lado do arquivo (o mesmo formato do comprovante da nota), para o "Trocar a nota" e a conferência de sempre.
  await gravarLeituraDoArquivo(arquivo.path, {
    v: 1, card_id: g.id, path: arquivo.path, nome, tipo: arquivo.tipo, tamanho: arquivo.tamanho, sha256: sha, doc: 'nota', por: g.nome, em: agora(), leitura: 'ok', sugestao: null, nota: lida,
  });

  const ctxBase = { por: g.nome, agora: agora(), novoId, equip };
  const arq = { nome, sha256: sha, path: arquivo.path };
  let resumo: ResumoMescla | null = null;
  const gravar = (extra: { nfId?: string; compraId?: string }) => mudarObraPrivada(g.id, g.nome, 'compra', null, (p) => {
    const r = aplicarDocumentoNaCompra(p, doc, arq, { ...ctxBase, ...extra });
    if ('repetido' in r) return { recusa: 'repetido', http: 200 };
    resumo = r.resumo;
    return r.privada;
  });
  const lido = (): SaidaCompra => ({ http: 200, resultado: 'lido', leitura: origem, resumo: resumo as unknown as ResumoMescla, fornecedor: doc.fornecedor, numero: doc.numero, data: doc.data });
  const repetido = (): SaidaCompra => ({ http: 200, resultado: 'repetido', mensagem: 'Este arquivo já foi lido nesta obra.' });

  const feito = await comTrava(`fin_conta:${g.id}`, g.nome, async (): Promise<SaidaCompra> => {
    // O botão final fecha a conta DENTRO desta trava: a obra que fechou (ou foi cancelada) depois da conferência lá de cima não recebe mais nada.
    if (!(await obraAbertaParaIa(g.id))) return erro(409, 'obra_fechada', 'Esta obra não aceita mais leitura.');
    if (doc.tipo !== 'nota_fiscal') {
      return ehRecusa(await gravar({})) ? repetido() : lido();
    }
    return comTrava(`fin_nf:${sha.slice(0, 32)}`, g.nome, async (): Promise<SaidaCompra> => {
      const achada = await buscarNotaViva(sha, doc.chave);
      if (achada && achada.card !== g.id) return erro(409, 'nota_repetida', 'Esta nota já foi lançada em outra obra.', { dono: { card: achada.card, id: achada.id } });
      if (achada) return { http: 200, resultado: 'repetido', mensagem: 'Esta nota já foi lançada nesta obra.' };
      // A nota da MESMA compra (o pedido que já criou a compra) pendura nela: o registro global da nota aponta para a compra que de fato a guarda.
      const compraId = compraExistenteDoDocumento((await lerObraPrivada(g.id)) ?? obraPrivadaVazia(), doc) ?? novoId('c');
      const nfId = novoId('nf');
      if (!(await gravarRegistroNota(g.id, { id: nfId, compra_id: compraId, sha256: sha, chave: doc.chave, livre: false, em: agora(), por: g.nome }))) return erro(409, 'mudou', 'Outra pessoa anexou agora. Tente de novo.');
      let ficou = false;
      try {
        if (doc.chave) {
          const rv = await reservarChaveNfe(doc.chave, { card: g.id, compra_id: compraId, nf_id: nfId });
          if (!rv.ok) {
            if ('dono' in rv) return erro(409, 'nota_repetida', 'Esta nota já foi lançada em outra obra.', { dono: { card: rv.dono.card, id: rv.dono.id } });
            return erro(409, 'nota_reservada', 'Esta nota já está reservada. Se for engano, o Thiago libera.');
          }
        }
        if (ehRecusa(await gravar({ nfId, compraId }))) return repetido();
        ficou = true;
        return lido();
      } finally {
        if (!ficou) { try { await liberarRegistroNota(g.id, nfId); } catch { /* o registro órfão é raro e a rota de nota o solta depois */ } }
      }
    });
  });
  return feito;
}
