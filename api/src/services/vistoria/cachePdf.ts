import { createHash } from 'crypto';
import { hashMarca, type MarcaEmpresa } from '../relatorio/marca';
import type { DadosCliente } from './clienteRelatorio';

// Nome do PDF guardado no bucket: relatorio-<sha1 de 16 caracteres>.pdf.
// O hash sai do conteúdo CRU da vistoria, numa ordem fixa. NUNCA entra URL assinada (muda a cada abertura
// e o cache nunca acertaria). Mudou foto, observação, status, assinatura, nome, situação, local, a marca
// do integrador, o cadastro do cliente que o relatório mostra ou o desenho do relatório (VERSAO_PDF)? O nome
// muda e o PDF é gerado de novo. Mudar só o `ts` de uma foto, o `created_at` ou a URL assinada não regera.

/**
 * SOBE esta versão sempre que mudar htmlRelatorio.ts (HTML ou CSS) ou os textos do relatório (avaliacao.ts):
 * o nome do arquivo guardado só muda com o conteúdo da vistoria, então sem subir aqui o PDF antigo é reaproveitado.
 * v2: grade de fotos de 220 px, conteúdo de 880 px, etiquetas em peso 600.
 * v3: tema claro único com a marca do integrador, código do documento, cobertura do selo e placar, fotos inteiras
 *     com legenda numerada, documentos do titular (sem imagem do documento pessoal), próximos passos e rodapé
 *     com "Página X de Y".
 */
export const VERSAO_PDF = 'v3';

interface FotoCrua { url?: unknown; tipo?: unknown; nome?: unknown }
interface ItemCru { key?: unknown; obs?: unknown; fotos?: unknown }

export interface ConteudoPdf {
  itens: unknown;
  status_itens: unknown;
  assinaturas: unknown;
  cliente_nome: unknown;
  status: unknown;
  localizacao: unknown;
  /** Marca do integrador que o relatório mostra; o logo entra por hash, nunca como base64 cru. */
  marca?: MarcaEmpresa | null;
  /** Os 5 campos do cadastro que o relatório mostra. */
  cliente?: DadosCliente | null;
}

export function hashConteudoPdf(c: ConteudoPdf): string {
  const itens = (Array.isArray(c.itens) ? c.itens : []).map((i: ItemCru) => [
    i?.key ?? '',
    i?.obs ?? '',
    (Array.isArray(i?.fotos) ? (i.fotos as FotoCrua[]) : []).map((f) => [f?.url ?? '', f?.tipo ?? '', f?.nome ?? '']),
  ]);
  const ass = (c.assinaturas && typeof c.assinaturas === 'object' ? c.assinaturas : {}) as Record<string, { path?: unknown; nome?: unknown; registro?: unknown } | undefined>;
  const assinaturas = (['tecnico', 'cliente'] as const).map((q) => [q, ass[q]?.path ?? '', ass[q]?.nome ?? '', ass[q]?.registro ?? '']);
  const st = (c.status_itens && typeof c.status_itens === 'object' ? c.status_itens : {}) as Record<string, unknown>;
  const status_itens = Object.keys(st).sort().map((k) => [k, st[k]]);
  const marca = c.marca ? hashMarca(c.marca) : null;
  const cliente = c.cliente
    ? [c.cliente.endereco, c.cliente.cep, c.cliente.cidade, c.cliente.uf, c.cliente.concessionaria]
    : null;
  const bruto = JSON.stringify([itens, status_itens, assinaturas, c.cliente_nome ?? '', c.status ?? '', c.localizacao ?? null, marca, cliente, VERSAO_PDF]);
  return createHash('sha1').update(bruto).digest('hex').slice(0, 16);
}

export const nomeDoPdf = (hash: string): string => `relatorio-${hash}.pdf`;
